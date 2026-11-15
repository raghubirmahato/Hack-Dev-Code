/** Web provider credentials, environment fallback, and DeepSeek model selection. */
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { BlockAssembler, createUserMessage, type StreamChunk } from '@hackdevcode/dsh-llm'
import { credentialRef } from '@hackdevcode/dsh-credentials'
import { createLaunchEnvironmentSnapshot } from '@hackdevcode/dsh-launch-environment'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { openSettings, connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/deepseek-messages-settings/', import.meta.url))

it.skipIf(webSnapshotMode() === 'record').each(['deepseek-official', 'google', 'openai', 'acme-gateway'])(
  'clears the saved %s key and sends the next request with environment authentication', async (provider) => {
    const messages = provider === 'deepseek-official'
    const google = provider === 'google'
    const ref = credentialRef(messages ? 'DEEPSEEK_API_KEY' : `${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`)
    const envRef = google ? 'GEMINI_API_KEY' : ref
    const calls: { path: string; key: string | undefined }[] = []
    const server = createServer((request, response) => {
      request.on('end', () => {
        const key = request.headers[messages ? 'x-api-key' : google ? 'x-goog-api-key' : 'authorization']
        calls.push({ path: request.url ?? '', key: typeof key === 'string' ? key : undefined })
        const events = messages ? [
          { type: 'message_start', message: { id: 'clear', type: 'message', role: 'assistant', model: 'clear-model', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'connection-ok' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ] : google ? [{ candidates: [{ content: { role: 'model', parts: [{ text: 'connection-ok' }] }, finishReason: 'STOP' }] }]
          : [{ id: 'clear', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'connection-ok' }, finish_reason: null }] },
            { id: 'clear', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
      })
      request.resume()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing credential test listener')
      const baseURL = `http://127.0.0.1:${String(address.port)}/configured`
      scaffold = await launchWebScaffold({
        deepSeekMissingCredential: true,
        openInAppEnvironment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { [envRef]: 'fixture-environment-key' } }]),
      })
      const profile = { apiKeyEnv: ref, baseURL, models: [{ id: 'clear-model' }],
        ...messages || google ? {} : { api: 'openai-completions' } }
      await scaffold.ctx.settings.mutate(messages ? 'llm-deepseek' : 'llm-pi-ai', [{
        op: 'set', path: messages ? [] : ['providers', provider], value: profile,
      }])
      await scaffold.ctx.credentials.set(ref, 'fixture-saved-key')
      const runtime = scaffold.ctx
      const generate = async (): Promise<void> => {
        const assembler = new BlockAssembler()
        const chunks: StreamChunk[] = []
        for await (const chunk of runtime.llm.stream({ provider, model: 'clear-model',
          messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply connection-ok' }], source: { kind: 'user' } })] })) {
          chunks.push(chunk)
          assembler.push(chunk)
        }
        expect(assembler.message({ provider, model: 'clear-model' }).content, JSON.stringify(chunks))
          .toContainEqual({ type: 'text', text: 'connection-ok' })
      }
      await generate()
      browser = await chromium.launch()
      const page = await browser.newPage({ locale: ZH_BROWSER_LOCALE })
      await page.goto(scaffold.authenticatedUrl)
      await openSettings(page, 'zh')
      const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
      await dialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
      const edit = dialog.getByRole('button', { name: `\u7f16\u8f91 ${messages ? 'DeepSeek (deepseek-official)' : provider}`, exact: true })
      await edit.click()
      const key = dialog.getByLabel('API \u5bc6\u94a5', { exact: true })
      await key.press('Delete')
      expect(await key.getAttribute('placeholder')).toBe(`\u7559\u7a7a\u4f7f\u7528\u73af\u5883\u8ba4\u8bc1\uff08${envRef}\uff09`)
      await dialog.getByText(`\u4fdd\u5b58\u4ee5\u6e05\u9664\u5df2\u4fdd\u5b58\u7684 API key\u3002\u4e4b\u540e\u4f7f\u7528\u73af\u5883\u8ba4\u8bc1\uff08${envRef}\uff09\u3002`, { exact: true }).waitFor()
      expect((await runtime.credentials.resolve(ref))?.source).toBe('file')
      if (messages) await compareOrRefreshGolden(join(EXPECTED, 'clear-key.expected.md'),
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
      await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
      expect((await runtime.credentials.resolve(ref))?.source).toBe('file')
      await edit.click()
      await key.press('Delete')
      await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
      await expect.poll(() => key.count()).toBe(0)
      await generate()
      expect(calls).toHaveLength(2)
      expect(calls[0]?.key).toBe(messages || google ? 'fixture-saved-key' : 'Bearer fixture-saved-key')
      expect(calls[1]).toEqual({ path: calls[0]?.path,
        key: messages || google ? 'fixture-environment-key' : 'Bearer fixture-environment-key' })
      expect(calls[1]?.path).toContain('/configured/')
      expect(await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')).not.toContain('fixture-saved-key')
      await edit.click()
      await dialog.getByText(`\u5df2\u68c0\u6d4b\u5230\u73af\u5883\u53d8\u91cf\uff08${envRef}\uff09`, { exact: true }).waitFor()
      await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e', { exact: true }).click()
      expect(await dialog.getByLabel('API \u5730\u5740', { exact: true }).inputValue()).toBe(baseURL)
      expect(await dialog.getByRole('button', { name: '\u6e05\u9664\u5df2\u4fdd\u5b58\u5bc6\u94a5', exact: true }).count()).toBe(0)
    } finally {
      try { await browser?.close() } finally {
        try { await scaffold?.close() } finally {
          await new Promise<void>((resolve, reject) => server.close((error) => {
            if (error === undefined) resolve()
            else reject(error)
          }))
        }
      }
    }
  },
)

it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }])(
  'protects saved keys and reveals only unsaved replacements in $name', async ({ engine }) => {
    const scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    let browser: Browser | undefined
    try {
      await scaffold.ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'fixture-protected-old-key')
      browser = await engine.launch()
      const page = await browser.newPage({ locale: ZH_BROWSER_LOCALE })
      await page.goto(scaffold.authenticatedUrl)
      await openSettings(page, 'zh')
      const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
      await dialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
      const edit = dialog.getByRole('button', { name: '\u7f16\u8f91 DeepSeek (deepseek-official)', exact: true })
      await edit.click()
      const key = dialog.getByLabel('API \u5bc6\u94a5', { exact: true })
      expect(await key.getAttribute('placeholder')).toBe(`fixture-prote${'•'.repeat(8)}-key`)
      expect(await key.inputValue()).toBe('')
      expect(await dialog.getByRole('button', { name: '\u663e\u793a\u5bc6\u94a5' }).count()).toBe(0)
      expect(await page.locator('body').innerHTML()).not.toContain('fixture-protected-old-key')
      await key.press('Backspace')
      await dialog.getByText('\u4fdd\u5b58\u4ee5\u6e05\u9664\u5df2\u4fdd\u5b58\u7684 API key\u3002\u4e4b\u540e\u4f7f\u7528\u73af\u5883\u8ba4\u8bc1\uff08DEEPSEEK_API_KEY\uff09\u3002', { exact: true }).waitFor()
      expect(await key.getAttribute('placeholder')).toBe('\u7559\u7a7a\u4f7f\u7528\u73af\u5883\u8ba4\u8bc1\uff08DEEPSEEK_API_KEY\uff09')
      await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
      await edit.click()
      expect(await key.getAttribute('placeholder')).toBe(`fixture-prote${'•'.repeat(8)}-key`)
      await key.fill('fixture-new-key')
      await dialog.getByText('\u4fdd\u5b58\u4ee5\u66ff\u6362\u5df2\u4fdd\u5b58\u7684 API key\u3002', { exact: true }).waitFor()
      await dialog.getByRole('button', { name: '\u663e\u793a\u5bc6\u94a5', exact: true }).click()
      expect(await key.getAttribute('type')).toBe('text')
      expect(await key.inputValue()).toBe('fixture-new-key')
      await key.press('ControlOrMeta+A')
      await key.press('ControlOrMeta+X')
      await expect.poll(() => key.inputValue()).toBe('')
      await key.fill('fixture-new-key')
      await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
      await expect.poll(() => key.count()).toBe(0)
      await edit.click()
      expect(await key.getAttribute('placeholder')).toBe('•'.repeat('fixture-new-key'.length))
      expect(await key.inputValue()).toBe('')
      expect(await key.getAttribute('type')).toBe('password')
      expect(await dialog.getByRole('button', { name: '\u663e\u793a\u5bc6\u94a5' }).count()).toBe(0)
      expect(await page.locator('body').innerHTML()).not.toContain('fixture-new-key')
    } finally {
      try { await browser?.close() } finally { await scaffold.close() }
    }
  },
)

it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }])(
  'keeps a foreign model drag from editing another provider input in $name', async ({ engine }) => {
    const scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    let browser: Browser | undefined
    try {
      browser = await engine.launch()
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('dialog', { name: '\u5f00\u59cb\u4f7f\u7528', exact: true }).getByRole('button', { name: '\u6dfb\u52a0 API Key', exact: true }).click()
      await page.getByRole('dialog', { name: '\u6dfb\u52a0\u4e00\u4e2a API Key \u5f00\u59cb\u4f7f\u7528' }).getByRole('button', { name: '\u7a0d\u540e\u914d\u7f6e' }).click()
      await openSettings(page, 'zh')
      const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e', exact: true })
      await dialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
      const setup = dialog.getByText('DeepSeek', { exact: true }).locator('xpath=ancestor::li')
      await setup.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e', { exact: true }).click()
      await dialog.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b\u63d0\u4f9b\u5546' }).click()
      await dialog.getByRole('tab', { name: '\u81ea\u5b9a\u4e49\u6a21\u578b API' }).click()
      const custom = dialog.getByRole('tabpanel', { name: '\u81ea\u5b9a\u4e49\u6a21\u578b API' })
      await custom.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b', exact: true }).click()
      const target = custom.getByLabel('\u6a21\u578b ID 1', { exact: true })
      await target.fill('foreign-model')
      const before = scaffold.ctx.settings.describe({ redactSecrets: true }).map(row => ({ ns: row.ns, value: row.value }))
      const source = setup.getByRole('button', { name: '\u8c03\u6574\u6a21\u578b\u987a\u5e8f 1', exact: true })
      await source.dragTo(target)
      expect(await target.inputValue()).toBe('foreign-model')
      expect(await setup.getByLabel('\u6a21\u578b ID 1', { exact: true }).inputValue()).toBe('deepseek-flash')
      expect(scaffold.ctx.settings.describe({ redactSecrets: true }).map(row => ({ ns: row.ns, value: row.value }))).toEqual(before)
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      try {
        await browser?.close()
      } finally {
        await scaffold.close()
      }
    }
  }, 60_000,
)

describe.skipIf(webSnapshotMode() === 'record')('web e2e: DeepSeek Messages settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('offers one DeepSeek card and saves Messages settings using the existing credential reference', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-deepseek-messages-settings'))
    expect(scaffold.ctx.llm.listProviders()).toContainEqual({ id: 'deepseek-official', name: 'DeepSeek' })
    expect(scaffold.ctx.llm.listProviders().filter(provider => provider.id === 'deepseek-official')).toHaveLength(1)
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    await page.getByRole('dialog', { name: '\u5f00\u59cb\u4f7f\u7528', exact: true }).getByRole('button', { name: '\u6dfb\u52a0 API Key', exact: true }).click()
    const onboarding = page.getByRole('dialog', { name: '\u6dfb\u52a0\u4e00\u4e2a API Key \u5f00\u59cb\u4f7f\u7528' })
    await onboarding.getByLabel('API \u5bc6\u94a5', { exact: true }).fill('sk-messages-onboarding')
    await onboarding.getByRole('button', { name: '\u4fdd\u5b58\u5e76\u7ee7\u7eed' }).click()
    await onboarding.waitFor({ state: 'detached' })
    await openSettings(page, 'zh')
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e', exact: true })
    await dialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
    await dialog.getByText('DeepSeek', { exact: true }).waitFor()
    expect(await dialog.getByText('DeepSeek', { exact: true }).count()).toBe(1)
    await dialog.getByText('DeepSeek', { exact: true }).locator('xpath=ancestor::li').getByRole('button', { name: '\u7f16\u8f91' }).click()
    const messages = dialog
    const key = messages.getByLabel('API \u5bc6\u94a5', { exact: true })
    expect(await key.inputValue()).toBe('')
    expect(await key.getAttribute('placeholder')).toBe(`sk-messa${'•'.repeat(10)}ding`)
    await messages.getByText('\u4f7f\u7528\u5df2\u4fdd\u5b58\u7684 API key\u3002', { exact: true }).waitFor()
    await messages.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e', { exact: true }).click()
    expect(await messages.getByLabel('API \u5730\u5740', { exact: true }).getAttribute('placeholder'))
      .toBe('https://api.deepseek.com/anthropic\uff08\u9ed8\u8ba4\u4f7f\u7528\u73af\u5883 DEEPSEEK_BASE_URL\uff09')
    await compareOrRefreshGolden(join(EXPECTED, 'cards.expected.md'),
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
    await messages.getByLabel('API \u5bc6\u94a5', { exact: true }).fill('sk-e2e-messages')
    await messages.getByLabel('API \u5730\u5740', { exact: true }).fill('https://messages.example/anthropic')
    expect(await messages.getByLabel('\u6a21\u578b ID 1').inputValue()).toBe('deepseek-flash')
    await messages.getByLabel('\u663e\u793a\u540d\u79f0 1', { exact: true }).fill('Messages Flash')
    await messages.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    await dialog.getByText('\u5df2\u4fdd\u5b58 DeepSeek (deepseek-official)\u3002', { exact: true }).waitFor()

    const settings = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(settings).toContain('https://messages.example/anthropic')
    expect(settings).toContain('id: llm-deepseek')
    await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'deepseek-flash')).resolves.toMatchObject({
      name: 'Messages Flash', inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history',
    })
    expect(scaffold.ctx.settings.describe().find(row => row.ns === 'llm-deepseek')?.value).not.toHaveProperty('protocol')
    expect(settings).not.toContain('sk-e2e-')
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentials).toContain('DEEPSEEK_API_KEY: sk-e2e-messages')
    expect(credentials).not.toContain('DEEPSEEK_MESSAGES_API_KEY')
    expect(await page.locator('body').innerText()).not.toContain('sk-e2e-')
    await dialog.getByRole('button', { name: '\u7f16\u8f91 DeepSeek (deepseek-official)', exact: true }).click()
    expect(await key.inputValue()).toBe('')
    await messages.getByText('\u4f7f\u7528\u5df2\u4fdd\u5b58\u7684 API key\u3002', { exact: true }).waitFor()
    expect(await key.getAttribute('type')).toBe('password')
    await key.fill('sk-cancelled-replacement')
    await messages.getByText('\u4fdd\u5b58\u4ee5\u66ff\u6362\u5df2\u4fdd\u5b58\u7684 API key\u3002', { exact: true }).waitFor()
    expect(await messages.getByText('\u4f7f\u7528\u5df2\u4fdd\u5b58\u7684 API key\u3002', { exact: true }).count()).toBe(0)
    await key.fill('')
    await messages.getByText('\u4fdd\u5b58\u4ee5\u6e05\u9664\u5df2\u4fdd\u5b58\u7684 API key\u3002\u4e4b\u540e\u4f7f\u7528\u73af\u5883\u8ba4\u8bc1\uff08DEEPSEEK_API_KEY\uff09\u3002', { exact: true }).waitFor()
    await messages.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
    expect(await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')).toBe(credentials)
    await page.keyboard.press('Escape')
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'messages-settings-e2e')
    await page.getByRole('button', { name: /^\u9009\u62e9\u6a21\u578b/ }).click()
    await page.getByRole('menuitem', { name: /\u6a21\u578b/ }).click()
    await page.getByRole('menuitemradio', { name: 'Messages Flash', exact: true }).waitFor()
    await compareOrRefreshGolden(join(EXPECTED, 'picker.expected.md'),
      await captureStableAria(page, '[role="group"][aria-label="\u6a21\u578b\u4e0e\u63a8\u7406\u7b49\u7ea7"]', scaffold.workspaceCwd), webSnapshotMode())
    await page.keyboard.press('Escape')
    await page.getByRole('menuitem', { name: /\u63a8\u7406\u7b49\u7ea7/ }).click()
    const effortWeights = await page.getByRole('menuitemradio').evaluateAll(rows => rows.map(row =>
      getComputedStyle(row.querySelector('span span')!).fontWeight,
    ))
    expect(new Set(effortWeights)).toEqual(new Set(['400']))
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('selects an available DeepSeek model after provider settings remove the default', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-deepseek-messages-default'))
    await page.keyboard.press('Escape')
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    const patchPath = join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml')
    expect(await readFile(patchPath, 'utf8')).toContain('model: deepseek-v4-flash')
    await page.reload({ waitUntil: 'load' })
    const input = page.locator('[data-composer-input]').first()
    const trigger = page.getByRole('button', { name: '\u8bf7\u9009\u62e9\u6a21\u578b', exact: true })
    await trigger.waitFor()
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await trigger.click()
    await page.getByRole('menuitemradio', { name: 'Messages Flash', exact: true }).click()
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await expect.poll(() => scaffold.ctx.agentDefaultModel.currentSelection()).toMatchObject({
      provider: 'deepseek-official', model: 'deepseek-flash',
    })
    const settings = await readFile(patchPath, 'utf8')
    expect(settings).not.toContain('id: agent-default-model')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
