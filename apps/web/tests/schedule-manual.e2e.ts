/** Schedule creation, prompt prefill, and editing through the shipped Web composition. */
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { ScheduleTiming } from '@hackdevcode/dsh-schedule/client'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { writeComposerDraft } from './support.ts'

it.each([
  { locale: 'en', panel: 'Automation tasks', create: 'New', menu: 'Choose a creation method', chat: 'Create in a session',
    prompt: 'Please create an automation task based on the requirements.' },
  { locale: 'zh', panel: '\u81ea\u52a8\u5316\u4efb\u52a1', create: '\u65b0\u5efa', menu: '\u9009\u62e9\u521b\u5efa\u65b9\u5f0f', chat: '\u5728\u4f1a\u8bdd\u4e2d\u521b\u5efa',
    prompt: '\u8bf7\u6839\u636e\u9700\u6c42\u521b\u5efa\u4e00\u4e2a\u81ea\u52a8\u5316\u4efb\u52a1\u3002' },
])('prefills an unsent Schedule creation draft in $locale through both conversation entries', async (copy) => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: copy.locale })
    await page.addInitScript((locale) => { localStorage.setItem('dsh.locale', locale) }, copy.locale)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    for (const { entry, draft } of [
      { entry: 'primary', draft: '' },
      { entry: 'primary', draft: 'Existing unsent draft' },
      { entry: 'menu', draft: '' },
      { entry: 'menu', draft: 'Existing unsent draft' },
    ]) {
      await writeComposerDraft(page, input, draft)
      await page.getByRole('button', { name: copy.panel, exact: true }).click()
      const manager = page.getByTestId('task-manager-page')
      if (entry === 'primary') await manager.getByRole('button', { name: copy.create, exact: true }).click()
      else {
        await manager.getByRole('button', { name: copy.menu, exact: true }).click()
        await page.getByRole('menuitem', { name: copy.chat, exact: true }).click()
      }
      await manager.waitFor({ state: 'detached' })
      await input.getByText(copy.prompt, { exact: true }).waitFor()
      expect(await input.evaluate(element => [...element.children].map(paragraph => paragraph.textContent).join('\n')))
        .toBe(draft === '' ? copy.prompt : `${draft}\n${copy.prompt}`)
      const events = scaffold.ctx.agents.list().flatMap(agent => agent.session.snapshotEvents())
      expect(events.filter(event => event.type === 'user/message' || event.type === 'turn/start')).toEqual([])
      expect(await scaffold.ctx.schedule.catalog()).toEqual([])
    }
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})

it('opens stored timing fields immediately without selecting another repeat option', async () => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const clock = new Date(Date.now() + 4 * 60 * 60_000).toISOString().slice(11, 16)
    const choices = [
      { timing: { kind: 'after', after_seconds: 3600 }, repeat: '\u4ec5\u4e00\u6b21', field: '\u65e5\u671f' },
      { timing: { kind: 'at', at: '2099-01-05T09:00:00.000Z' }, repeat: '\u4ec5\u4e00\u6b21', field: '\u65e5\u671f' },
      { timing: { kind: 'every', every_seconds: 300 }, repeat: '\u6bcf N \u5206\u949f', field: '\u91cd\u590d\u95f4\u9694' },
      { timing: { kind: 'daily', daily: { time: `${clock}:00`, time_zone: 'UTC' } }, repeat: '\u6bcf\u5929', field: '\u65f6\u95f4' },
      { timing: { kind: 'weekly', weekly: { time: `${clock}:45`, time_zone: 'UTC', weekdays: [1, 5] } },
        repeat: '\u6bcf\u5468', field: '\u661f\u671f' },
    ] satisfies { timing: ScheduleTiming; repeat: string; field: string }[]
    const tasks = []
    for (const [index, choice] of choices.entries()) {
      const task = await scaffold.ctx.schedule.create({ title: `Stored task ${index}`, prompt: 'Review the project', timing: choice.timing })
      await scaffold.ctx.schedule.edit({ id: task.id, action: 'update', patch: { active: false } })
      tasks.push({ ...choice, task })
    }
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    await page.addInitScript(() => { localStorage.setItem('dsh.locale', 'zh') })
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '\u81ea\u52a8\u5316\u4efb\u52a1', exact: true }).click()
    const manager = page.getByTestId('task-manager-page')
    await manager.getByRole('button', { name: '\u5168\u90e8', exact: true }).click()
    for (const { task, repeat, field } of tasks) {
      await manager.getByRole('button', { name: task.title, exact: true }).click()
      const detail = manager.getByRole('complementary', { name: '\u4efb\u52a1\u8be6\u60c5', exact: true })
      expect(await detail.getByRole('button', { name: `\u91cd\u590d ${repeat}`, exact: true }).isVisible()).toBe(true)
      const role = field === '\u661f\u671f' ? 'group' : field === '\u91cd\u590d\u95f4\u9694' ? 'spinbutton' : 'button'
      expect(await detail.getByRole(role, { name: field, exact: true }).isVisible()).toBe(true)
      expect(await detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).isDisabled()).toBe(true)
      expect(await scaffold.ctx.schedule.view({ id: task.id })).toMatchObject({ kind: task.kind, scheduledAt: task.scheduledAt })
      if (field === '\u65e5\u671f') {
        await detail.getByRole('button', { name: '\u65e5\u671f', exact: true }).click()
        await page.getByRole('dialog', { name: '\u65e5\u671f', exact: true }).waitFor()
        await page.keyboard.press('Escape')
      }
    }
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})

it.each(['2026-03-07T16:00:00.000Z', '2026-03-08T16:00:00.000Z'])(
  'saves a stored weekly task on %s without a false timing error', async (now) => {
    const scaffold = await launchWebScaffold({ firstUse: true })
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    try {
      const task = await scaffold.ctx.schedule.create({ title: 'Weekly review', prompt: 'Review the project',
        timing: { kind: 'weekly', weekly: { time: '02:30:00', time_zone: 'America/New_York', weekdays: [5] } } })
      await scaffold.ctx.schedule.edit({ id: task.id, action: 'update', patch: { active: false } })
      browser = await chromium.launch()
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', timezoneId: 'America/New_York' })
      await page.addInitScript((now) => {
        localStorage.setItem('dsh.locale', 'zh')
        Date.now = () => Date.parse(now)
      }, now)
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '\u81ea\u52a8\u5316\u4efb\u52a1', exact: true }).click()
      const manager = page.getByTestId('task-manager-page')
      await manager.getByRole('button', { name: '\u5168\u90e8', exact: true }).click()
      await manager.getByRole('button', { name: task.title, exact: true }).click()
      const detail = manager.getByRole('complementary', { name: '\u4efb\u52a1\u8be6\u60c5', exact: true })
      await detail.getByRole('group', { name: '\u661f\u671f', exact: true }).getByRole('button').nth(0).click()
      expect(await detail.getByRole('status').count()).toBe(0)
      const save = detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true })
      expect(await save.isEnabled()).toBe(true)
      await save.click()
      await expect.poll(async () => {
        const record = await scaffold.ctx.schedule.view({ id: task.id })
        return 'code' in record ? undefined : record.kind
      }).toBe('rrule')
      const updated = await scaffold.ctx.schedule.view({ id: task.id })
      expect(updated).toMatchObject({ kind: 'rrule', status: 'paused', target: task.target })
      if ('code' in updated || updated.kind !== 'rrule') throw new Error('expected an edited weekly rule')
      expect(updated.rrule).toContain('BYDAY=MO,FR')

      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: '\u81ea\u52a8\u5316\u4efb\u52a1', exact: true }).click()
      await manager.getByRole('button', { name: '\u5168\u90e8', exact: true }).click()
      await manager.getByRole('button', { name: task.title, exact: true }).click()
      await detail.getByRole('button', { name: '\u91cd\u590d \u6bcf\u5468', exact: true }).waitFor()
      expect(await detail.getByRole('group', { name: '\u661f\u671f', exact: true }).getByRole('button')
        .evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-pressed'))))
        .toEqual(['true', 'false', 'false', 'false', 'true', 'false', 'false'])
      expect(await detail.getByRole('status').count()).toBe(0)
      expect(await save.isDisabled()).toBe(true)
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      try { await browser?.close() } finally { await scaffold.close() }
    }
  },
)

it('creates from a paused empty state, selects the task, and saves an inline edit without starting an Agent', async () => {
  // First use registers the default Workspace, which a new task's directory starts with.
  const scaffold = await launchWebScaffold({ firstUse: true })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    await page.addInitScript(() => { localStorage.setItem('dsh.locale', 'zh') })
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '\u81ea\u52a8\u5316\u4efb\u52a1', exact: true }).click()
    const manager = page.getByTestId('task-manager-page')
    const createStyles = await manager.getByRole('group', { name: '\u521b\u5efa', exact: true }).getByRole('button').evaluateAll(buttons => buttons.map((button) => {
      const style = getComputedStyle(button)
      return { height: style.height, topLeft: style.borderTopLeftRadius, bottomLeft: style.borderBottomLeftRadius,
        topRight: style.borderTopRightRadius, bottomRight: style.borderBottomRightRadius }
    }))
    expect(createStyles).toEqual([
      { height: '32px', topLeft: '16px', bottomLeft: '16px', topRight: '0px', bottomRight: '0px' },
      { height: '32px', topLeft: '0px', bottomLeft: '0px', topRight: '16px', bottomRight: '16px' },
    ])
    await manager.getByRole('button', { name: '\u5df2\u6682\u505c', exact: true }).click()
    await manager.getByRole('heading', { name: '\u6ca1\u6709\u5df2\u6682\u505c\u7684\u81ea\u52a8\u5316\u4efb\u52a1', exact: true }).waitFor()
    await manager.getByRole('button', { name: '\u9009\u62e9\u521b\u5efa\u65b9\u5f0f', exact: true }).click()
    await page.getByRole('menuitem', { name: '\u624b\u52a8\u521b\u5efa', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await manager.getByRole('button', { name: '\u65b0\u5efa\u81ea\u52a8\u5316\u4efb\u52a1', exact: true }).click()
    const dialog = manager.getByRole('complementary', { name: '\u624b\u52a8\u521b\u5efa', exact: true })
    await dialog.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u540d\u79f0', exact: true }).fill('AI \u65b0\u95fb\u7b80\u62a5')
    expect(await dialog.getByRole('status').count()).toBe(0)
    expect(await dialog.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u540d\u79f0', exact: true }).getAttribute('aria-required')).toBe('true')
    await dialog.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).fill('\u6574\u7406\u8fc7\u53bb 24 \u5c0f\u65f6\u7684 AI \u65b0\u95fb\uff0c\u9644\u539f\u6587\u94fe\u63a5\u3002')
    await dialog.getByRole('button', { name: /^\u91cd\u590d / }).click()
    await page.getByRole('menuitem', { name: '\u5468\u4e00\u81f3\u5468\u4e94', exact: true }).click()
    await dialog.getByRole('button', { name: '\u65f6\u95f4', exact: true }).click()
    await page.getByRole('listbox', { name: '\u65f6', exact: true }).getByRole('option', { name: '09', exact: true }).click()
    await page.getByRole('listbox', { name: '\u5206', exact: true }).getByRole('option', { name: '00', exact: true }).click()
    await page.getByRole('listbox', { name: '\u79d2', exact: true }).getByRole('option', { name: '00', exact: true }).click()
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: /^\u6267\u884c\u4f4d\u7f6e / }).click()
    await page.getByRole('menuitem', { name: '\u65b0\u5efa\u4f1a\u8bdd\u5e76\u590d\u7528 \u9996\u6b21\u8fd0\u884c\u65f6\u521b\u5efa\uff0c\u4e4b\u540e\u6cbf\u7528\u8fd9\u4e2a\u4f1a\u8bdd', exact: true }).waitFor()
    expect(await page.getByRole('menuitem').count()).toBe(2)
    const workspace = dialog.getByRole('button', { name: /^\u5173\u8054\u5de5\u4f5c\u533a / })
    await expect.poll(() => workspace.textContent()).toContain('\u9ed8\u8ba4\u5de5\u4f5c\u533a')
    await page.keyboard.press('Escape')
    // The workspace menu states each directory, so the default workspace names its folder.
    const defaultPath = scaffold.ctx.workspaceRegistry.list()[0]?.path
    if (defaultPath === undefined) throw new Error('first use did not register the default workspace')
    await workspace.click()
    await page.getByRole('menuitem').getByTitle(defaultPath, { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    expect(await dialog.count()).toBe(1)
    await dialog.getByRole('button', { name: '\u521b\u5efa', exact: true }).click()
    const detail = manager.getByRole('complementary', { name: '\u4efb\u52a1\u8be6\u60c5', exact: true })
    await detail.getByRole('heading', { name: 'AI \u65b0\u95fb\u7b80\u62a5', exact: true }).waitFor()
    expect(await manager.getByRole('button', { name: '\u5168\u90e8', exact: true }).getAttribute('aria-pressed')).toBe('true')
    expect(await manager.getByRole('list', { name: '\u4efb\u52a1\u5217\u8868', exact: true }).getByRole('button', { name: 'AI \u65b0\u95fb\u7b80\u62a5', exact: true }).count()).toBe(1)
    await detail.getByText('\u5f85\u521b\u5efa', { exact: true }).waitFor()
    const task = (await scaffold.ctx.schedule.catalog()).find(task => task.title === 'AI \u65b0\u95fb\u7b80\u62a5')
    if (task === undefined || task.target.kind !== 'new_once') throw new Error('manual task was not created with the reusable target')
    expect(task.target.create.cwd).toBe(defaultPath)
    expect(await detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).isDisabled()).toBe(true)
    await detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).fill('\u6574\u7406\u8fc7\u53bb 24 \u5c0f\u65f6\u7684 AI \u65b0\u95fb\uff0c\u9644\u539f\u6587\u94fe\u63a5\uff0c\u6309\u91cd\u8981\u6027\u6392\u5e8f\u3002')
    expect(await detail.getByRole('button', { name: '\u6682\u505c\u4efb\u52a1', exact: true }).isDisabled()).toBe(true)
    await manager.getByRole('button', { name: '\u5173\u95ed\u8be6\u60c5', exact: true }).click()
    await manager.getByRole('list', { name: '\u4efb\u52a1\u5217\u8868', exact: true }).getByRole('button', { name: task.title, exact: true }).click()
    expect(await detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).inputValue())
      .toBe('\u6574\u7406\u8fc7\u53bb 24 \u5c0f\u65f6\u7684 AI \u65b0\u95fb\uff0c\u9644\u539f\u6587\u94fe\u63a5\uff0c\u6309\u91cd\u8981\u6027\u6392\u5e8f\u3002')
    await detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).click()
    await expect.poll(() => detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).isDisabled()).toBe(true)
    expect(await detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).inputValue())
      .toBe('\u6574\u7406\u8fc7\u53bb 24 \u5c0f\u65f6\u7684 AI \u65b0\u95fb\uff0c\u9644\u539f\u6587\u94fe\u63a5\uff0c\u6309\u91cd\u8981\u6027\u6392\u5e8f\u3002')
    const saved = await scaffold.ctx.schedule.view({ id: task.id })
    if ('code' in saved) throw new Error('edited task was not retained')
    expect(saved.prompt).toBe('\u6574\u7406\u8fc7\u53bb 24 \u5c0f\u65f6\u7684 AI \u65b0\u95fb\uff0c\u9644\u539f\u6587\u94fe\u63a5\uff0c\u6309\u91cd\u8981\u6027\u6392\u5e8f\u3002')
    await detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u540d\u79f0', exact: true }).fill('\u672c\u5730\u7b80\u62a5\u8349\u7a3f')
    const remote = await scaffold.ctx.schedule.edit({ id: task.id, action: 'update',
      expectedUpdatedAt: saved.updatedAt ?? null, patch: { prompt: '\u6765\u81ea\u5176\u4ed6\u7a97\u53e3\u7684\u65b0\u6307\u4ee4' } })
    expect(remote).toMatchObject({ prompt: '\u6765\u81ea\u5176\u4ed6\u7a97\u53e3\u7684\u65b0\u6307\u4ee4' })
    const recovery = detail.getByRole('button', { name: '\u4fdd\u7559\u4fee\u6539\u5e76\u590d\u6838', exact: true })
    await recovery.waitFor()
    const notice = detail.getByRole('alert').locator('..')
    const palettes = []
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
      const [box, field, message, action] = await Promise.all([
        notice.boundingBox(), detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u540d\u79f0', exact: true }).locator('..').boundingBox(),
        detail.getByRole('alert').boundingBox(), recovery.boundingBox(),
      ])
      expect(box).not.toBeNull()
      expect(field).not.toBeNull()
      expect(message).not.toBeNull()
      expect(action).not.toBeNull()
      expect(Math.abs(box!.x - field!.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(box!.x + box!.width - field!.x - field!.width)).toBeLessThanOrEqual(1)
      expect(action!.y).toBeLessThan(message!.y + message!.height)
      expect(action!.y + action!.height).toBeGreaterThan(message!.y)
      expect(box!.y + box!.height).toBeLessThan(field!.y)
      palettes.push(await notice.evaluate((element) => {
        const style = getComputedStyle(element)
        return { color: style.color, background: style.backgroundColor }
      }))
    }
    expect(palettes[0]).not.toEqual(palettes[1])
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    expect(await detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).isDisabled()).toBe(true)
    expect(await detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).inputValue()).toBe(saved.prompt)
    await detail.getByRole('button', { name: '\u4fdd\u7559\u4fee\u6539\u5e76\u590d\u6838', exact: true }).click()
    expect(await detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u540d\u79f0', exact: true }).inputValue()).toBe('\u672c\u5730\u7b80\u62a5\u8349\u7a3f')
    expect(await detail.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).inputValue()).toBe('\u6765\u81ea\u5176\u4ed6\u7a97\u53e3\u7684\u65b0\u6307\u4ee4')
    expect(await scaffold.ctx.schedule.view({ id: task.id })).toMatchObject({ title: task.title })
    await detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).click()
    await detail.getByRole('heading', { name: '\u672c\u5730\u7b80\u62a5\u8349\u7a3f', exact: true }).waitFor()
    expect(await scaffold.ctx.schedule.view({ id: task.id })).toMatchObject({ title: '\u672c\u5730\u7b80\u62a5\u8349\u7a3f', prompt: '\u6765\u81ea\u5176\u4ed6\u7a97\u53e3\u7684\u65b0\u6307\u4ee4' })
    expect(await detail.evaluate(element => element === document.activeElement)).toBe(true)
    await manager.getByRole('button', { name: '\u9009\u62e9\u521b\u5efa\u65b9\u5f0f', exact: true }).click()
    await page.getByRole('menuitem', { name: '\u624b\u52a8\u521b\u5efa', exact: true }).click()
    await dialog.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u540d\u79f0', exact: true }).fill('\u68c0\u67e5\u6700\u65b0\u8fdb\u5c55')
    await dialog.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).fill('\u6c47\u603b\u6700\u8fd1\u7684\u66f4\u65b0')
    await dialog.getByRole('button', { name: /^\u91cd\u590d / }).click()
    await page.getByRole('menuitem', { name: '\u6bcf N \u5206\u949f', exact: true }).click()
    await dialog.getByRole('spinbutton', { name: '\u91cd\u590d\u95f4\u9694', exact: true }).fill('5')
    await dialog.getByRole('button', { name: /^\u6267\u884c\u4f4d\u7f6e / }).click()
    await page.getByRole('menuitem', { name: '\u6bcf\u6b21\u65b0\u5efa\u4f1a\u8bdd \u6bcf\u6b21\u8fd0\u884c\u90fd\u521b\u5efa\u72ec\u7acb\u4f1a\u8bdd', exact: true }).click()
    await dialog.getByText('\u8fd0\u884c\u95f4\u9694\u81f3\u5c11 1\u5206\u949f', { exact: true }).waitFor()
    const beforeCreate = Date.now()
    await dialog.getByRole('button', { name: '\u521b\u5efa', exact: true }).click()
    await detail.getByRole('heading', { name: '\u68c0\u67e5\u6700\u65b0\u8fdb\u5c55', exact: true }).waitFor()
    const afterCreate = Date.now()
    const intervalTask = (await scaffold.ctx.schedule.catalog()).find(item => item.title === '\u68c0\u67e5\u6700\u65b0\u8fdb\u5c55')
    if (intervalTask === undefined) throw new Error('interval task was not created')
    expect(intervalTask.target.kind).toBe('new')
    expect(Date.parse(intervalTask.scheduledAt) - beforeCreate).toBeGreaterThan(240_000)
    expect(Date.parse(intervalTask.scheduledAt) - afterCreate).toBeLessThanOrEqual(300_000)
    await detail.getByRole('button', { name: '\u6682\u505c\u4efb\u52a1', exact: true }).click()
    await detail.getByRole('button', { name: '\u6062\u590d\u4efb\u52a1', exact: true }).waitFor()
    expect(await detail.getByText('\u5f85\u521b\u5efa', { exact: true }).count()).toBe(0)
    expect(await detail.getByText('\u6700\u8fd1\u8fd0\u884c\u4f1a\u8bdd', { exact: true }).count()).toBe(0)
    expect(await detail.getByText('\u8fd0\u884c\u95f4\u9694\u81f3\u5c11', { exact: false }).count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(scaffold.ctx.agents.get(task.target.sessionId)).toBeUndefined()
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})

it('creates and edits Custom Cron through the built UI while retaining its explicit zone and record kind', async () => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    await page.addInitScript(() => { localStorage.setItem('dsh.locale', 'zh') })
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '\u81ea\u52a8\u5316\u4efb\u52a1', exact: true }).click()
    const manager = page.getByTestId('task-manager-page')
    await manager.getByRole('button', { name: '\u9009\u62e9\u521b\u5efa\u65b9\u5f0f', exact: true }).click()
    await page.getByRole('menuitem', { name: '\u624b\u52a8\u521b\u5efa', exact: true }).click()
    const dialog = manager.getByRole('complementary', { name: '\u624b\u52a8\u521b\u5efa', exact: true })
    await dialog.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u540d\u79f0', exact: true }).fill('Cron deployment check')
    await dialog.getByRole('textbox', { name: '\u81ea\u52a8\u5316\u4efb\u52a1\u5185\u5bb9', exact: true }).fill('Check the deployment status.')
    await dialog.getByRole('button', { name: /^\u91cd\u590d / }).click()
    await page.getByRole('menuitem', { name: '\u81ea\u5b9a\u4e49', exact: true }).click()
    await dialog.getByRole('textbox', { name: '\u81ea\u5b9a\u4e49', exact: true }).fill('0 9 * * 1-5')
    await dialog.getByRole('button', { name: /^\u65f6\u533a / }).waitFor()
    await dialog.getByRole('button', { name: '\u521b\u5efa', exact: true }).click()
    const detail = manager.getByRole('complementary', { name: '\u4efb\u52a1\u8be6\u60c5', exact: true })
    await detail.getByRole('heading', { name: 'Cron deployment check', exact: true }).waitFor()
    const created = (await scaffold.ctx.schedule.catalog()).find(task => task.title === 'Cron deployment check')
    if (created === undefined) throw new Error('Custom Cron creation did not store a task')
    expect(created).toMatchObject({ kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' })
    expect(created).not.toHaveProperty('rrule')

    await detail.getByRole('textbox', { name: '\u81ea\u5b9a\u4e49', exact: true }).fill(' ')
    expect(await detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).isDisabled()).toBe(true)
    await detail.getByRole('status').getByText('\u8bf7\u4fee\u6539\u81ea\u5b9a\u4e49\u89c4\u5219\u3001\u9009\u62e9\u5176\u4ed6\u91cd\u590d\u65b9\u5f0f\uff0c\u6216\u8ba9\u667a\u80fd\u4f53\u534f\u52a9\u4fee\u6539', { exact: true }).waitFor()
    expect(await scaffold.ctx.schedule.view({ id: created.id })).toEqual(created)
    await detail.getByRole('textbox', { name: '\u81ea\u5b9a\u4e49', exact: true }).fill('0 10 * * 1-5')
    await detail.getByRole('button', { name: /^\u65f6\u533a / }).waitFor()
    await detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).click()
    await expect.poll(() => detail.getByRole('button', { name: '\u4fdd\u5b58\u4fee\u6539', exact: true }).isDisabled()).toBe(true)
    const edited = await scaffold.ctx.schedule.view({ id: created.id })
    expect(edited).toMatchObject({ id: created.id, kind: 'cron', expression: '0 10 * * 1-5', timeZone: 'Asia/Shanghai' })
    expect(edited).not.toHaveProperty('rrule')
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})
