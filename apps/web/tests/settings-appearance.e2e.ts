/** Built settings controls share materials and adapt their geometry to the viewport and pointer. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Locator } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { AccountView } from '@hackdevcode/dsh-deepseek-account/types'
import type {} from '@hackdevcode/dsh-deepseek-account'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode,
} from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/settings-appearance', import.meta.url))

/** @param element - Rendered control or card. @returns Its visible geometry and material. */
function appearance(element: Locator) {
  return element.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      radius: style.borderRadius, border: style.borderTopWidth, stroke: style.borderTopColor,
      fill: style.backgroundColor, height: Math.round(node.getBoundingClientRect().height),
    }
  })
}

function rowGeometry(control: Locator) {
  return control.evaluate((node) => {
    const row = node.parentElement!
    const text = row.firstElementChild!
    const description = text.lastElementChild!.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const textBox = text.getBoundingClientRect()
    const controlBox = node.getBoundingClientRect()
    return {
      widthDifference: rowBox.width - controlBox.width,
      leftDifference: controlBox.left - textBox.left,
      rightGap: rowBox.right - controlBox.right,
      afterText: controlBox.left - textBox.right,
      belowDescription: controlBox.top - description.bottom,
      centerDifference: (controlBox.top + controlBox.bottom - textBox.top - textBox.bottom) / 2,
      height: controlBox.height,
    }
  })
}

it('stacks font fields at narrow widths while keeping font-size controls on the right', async () => {
  const scaffold = await launchWebScaffold({ developerTools: false })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())

  for (const platform of ['web', 'darwin', 'win32'] as const) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, locale: ZH_BROWSER_LOCALE, hasTouch: platform === 'web',
    })
    try {
      const page = await context.newPage()
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await openSettings(page, 'zh')
      const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e', exact: true })
      await dialog.getByRole('button', { name: '\u66f4\u591a\u5b57\u4f53\u8bbe\u7f6e', exact: true }).click()
      await page.evaluate((platform) => {
        document.documentElement.toggleAttribute('data-windows-titlebar', platform === 'win32')
        if (platform === 'darwin') document.documentElement.setAttribute('data-platform', platform)
      }, platform)

      for (const width of platform === 'web' ? [390, 767, 768] : [520, 767, 768]) {
        await page.setViewportSize({ width, height: 844 })
        for (const name of ['\u6b63\u6587\u5b57\u4f53', '\u4ee3\u7801\u5b57\u4f53', '\u7ec8\u7aef\u5b57\u4f53']) {
          const geometry = await rowGeometry(dialog.getByRole('textbox', { name, exact: true }).locator('..'))
          if (width <= 767) {
            expect(Math.abs(geometry.widthDifference), `${platform} ${width}px ${name} width`).toBeLessThan(1)
            expect(Math.abs(geometry.leftDifference), `${platform} ${width}px ${name} alignment`).toBeLessThan(1)
            expect(geometry.belowDescription, `${platform} ${width}px ${name} placement`).toBeGreaterThanOrEqual(0)
            expect(geometry.height, `${platform} ${width}px ${name} height`).toBeLessThan(60)
          } else {
            expect(geometry.afterText, `${platform} ${width}px ${name} placement`).toBeGreaterThanOrEqual(0)
          }
        }
        for (const name of ['\u589e\u5927\u5b57\u53f7', '\u589e\u5927\u4ee3\u7801\u5b57\u53f7', '\u589e\u5927\u7ec8\u7aef\u5b57\u53f7']) {
          const geometry = await rowGeometry(dialog.getByRole('button', { name, exact: true }).locator('../../..'))
          expect(geometry.afterText, `${platform} ${width}px ${name} placement`).toBeGreaterThanOrEqual(0)
          expect(Math.abs(geometry.rightGap), `${platform} ${width}px ${name} alignment`).toBeLessThan(1)
          expect(Math.abs(geometry.centerDifference), `${platform} ${width}px ${name} centering`).toBeLessThan(1)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      }

      const field = dialog.getByRole('textbox', { name: '\u6b63\u6587\u5b57\u4f53', exact: true })
      await field.fill('Uncommitted font draft')
      const original = await field.elementHandle()
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 })
        expect(await original!.evaluate(input => input === document.activeElement && input.isConnected)).toBe(true)
        expect(await field.inputValue()).toBe('Uncommitted font draft')
      }
    } finally {
      await context.close()
    }
  }
})

it('uses 16px text for coarse-pointer font fields and preserves compact fine-pointer fields', async () => {
  const scaffold = await launchWebScaffold({ developerTools: false })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())

  for (const hasTouch of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: ZH_BROWSER_LOCALE, hasTouch })
    try {
      const page = await context.newPage()
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await openSettings(page, 'zh')
      const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e', exact: true })
      await dialog.getByRole('button', { name: '\u66f4\u591a\u5b57\u4f53\u8bbe\u7f6e', exact: true }).click()
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(hasTouch)
      for (const name of ['\u6b63\u6587\u5b57\u4f53', '\u4ee3\u7801\u5b57\u4f53', '\u7ec8\u7aef\u5b57\u4f53']) {
        const fontSize = await dialog.getByRole('textbox', { name, exact: true })
          .evaluate(input => getComputedStyle(input).fontSize)
        expect(fontSize, name).toBe(hasTouch ? '16px' : '14px')
      }
    } finally {
      await context.close()
    }
  }
})

it('shares settings card materials and control sizes in both palettes', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  await scaffold.ctx.settings.mutate('ui-settings-account', [
    { op: 'set', path: ['step'], value: 'done' },
    { op: 'set', path: ['completion'], value: 'completed' },
  ])
  const account = scaffold.ctx.deepseekAccount
  const state: AccountView = {
    status: 'credential-stored', attempt: null,
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  }
  // The Platform provider supplies synthetic identity and wallets; renderer, RPC, and settings remain real.
  const mocks = [
    vi.spyOn(account, 'getState').mockResolvedValue(state),
    vi.spyOn(account, 'getProfile').mockResolvedValue({
      status: 'ready', value: { id: null, name: 'Radius example', contact: 'r***@example.com', avatarUrl: null },
    }),
    vi.spyOn(account, 'getBalance').mockResolvedValue({
      status: 'ready', value: [{ currency: 'CNY', balance: '128.50' }],
      bonusWallets: [{ currency: 'CNY', balance: '12.00' }],
    }),
    vi.spyOn(account, 'watch').mockImplementation(async function* (signal) {
      yield { type: 'snapshot', state }
      if (signal.aborted) return
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }),
  ]
  onTestFinished(() => { mocks.forEach((mock) => { mock.mockRestore() }) })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  await page.addInitScript(() => { Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } }) })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await openSettings(page, 'zh')
  const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e', exact: true })

  for (const [palette, label] of [['light', '\u6d45\u8272'], ['dark', '\u6df1\u8272']] as const) {
    await dialog.getByRole('button', { name: '\u901a\u7528\u8bbe\u7f6e', exact: true }).click()
    await dialog.getByRole('button', { name: label, exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(palette === 'dark')
    const selector = await appearance(dialog.getByRole('button', { name: '\u5de5\u4f5c\u533a\u5185\u4fee\u6539', exact: true }))
    expect(selector.radius).toBe('12px')
    expect((await appearance(dialog)).radius).toBe('28px')

    await dialog.getByRole('button', { name: '\u8d26\u53f7\u4e0e\u4f59\u989d', exact: true }).click()
    const section = dialog.getByRole('region', { name: '\u8d26\u53f7\u4e0e\u4f59\u989d', exact: true })
    await expect.poll(() => section.innerText()).toContain('¥128.50')
    const cards = section.locator(':scope > div')
    expect(await cards.count()).toBe(2)
    const profile = await appearance(cards.nth(0))
    const balance = await appearance(cards.nth(1))
    const material = { radius: profile.radius, border: profile.border, stroke: profile.stroke, fill: profile.fill }
    expect(material.radius).toBe('20px')
    expect(material.fill).not.toBe('rgba(0, 0, 0, 0)')
    expect(balance).toMatchObject(material)
    const usage = await appearance(section.getByRole('link', { name: '\u67e5\u8be2\u7528\u91cf', exact: true }))
    const topUp = await appearance(section.getByRole('link', { name: '\u5145\u503c', exact: true }))
    expect(usage).toMatchObject({ radius: '12px', height: 36 })
    expect(topUp).toMatchObject({ radius: '12px', height: 36 })
    await compareOrRefreshGolden(join(EXPECTED, 'account.expected.md'),
      await captureStableAria(page, 'section[aria-label="\u8d26\u53f7\u4e0e\u4f59\u989d"]', scaffold.workspaceCwd), webSnapshotMode())

    await dialog.getByRole('button', { name: '\u5185\u7f6e\u63d2\u4ef6', exact: true }).click()
    await dialog.getByRole('button', { name: /^\u5168\u5c40/ }).click()
    const plugin = dialog.locator('[data-plugin-scope="global"] [data-plugin-entry]').first()
    await plugin.waitFor()
    expect(await appearance(plugin)).toMatchObject(material)

    await dialog.getByRole('button', { name: 'Agent \u9884\u8bbe', exact: true }).click()
    const preset = dialog.locator('li').first()
    await preset.waitFor()
    expect((await appearance(preset)).radius).toBe('20px')

    await dialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
    await dialog.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b\u63d0\u4f9b\u5546', exact: true }).click()
    const field = dialog.getByLabel('\u63d0\u4f9b\u5546', { exact: true })
    await field.waitFor()
    expect(await appearance(field)).toMatchObject({ radius: '12px', height: 32 })
    const save = await appearance(dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }))
    expect(save).toMatchObject({ radius: '12px', height: 36 })
    await compareOrRefreshGolden(join(EXPECTED, `${palette}.expected.md`),
      JSON.stringify({ card: material, selector, usage, topUp, save }, null, 2), webSnapshotMode())
    await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
  }
})
