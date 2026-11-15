// Web e2e scenario: the Models settings page end to end through the real
// wire — the one add card offers the dormant pi-ai catalog on its third-party
// mode and the create form on its custom-API mode, a blank key saves a
// reference-free profile for provider-native auth, and typing an API key later
// stores it write-only under the derived reference (`MINIMAX_CN_API_KEY`)
// while the settings document records only that reference. Each saved row
// appears after route topology invalidation without presenting liveness as
// provider status. The customized-settings fold writes its curated fields —
// the endpoint, the retry policy, a declared route's own name and protocol, and
// the reasoning levels of its models — as merge patches against the stored profile. Zero
// model calls: configuration is pure settings/credentials/llm-domain traffic,
// so there is no fixture and a stray stream would fail loud because the
// adapter registry is empty. The provider under test is
// minimax-cn so a developer's real ANTHROPIC/OPENAI environment keys can
// never shadow the derived reference. The deletion dialog distinguishes a
// reference-free profile from a page-managed key before the credential and
// settings unsets reach the wire.
import { assertModelInputLayout } from './model-input-layout.ts'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page, Request, Route } from 'playwright'
import { chromium, webkit } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { expectTooltipOnTop, openSettings, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/models-settings', import.meta.url))
const EMPTY_EXPECTED = join(SNAPSHOT_DIR, 'empty.expected.md')
const NATIVE_KEYLESS_EXPECTED = join(SNAPSHOT_DIR, 'native-keyless.expected.md')
const CONFIGURED_EXPECTED = join(SNAPSHOT_DIR, 'configured.expected.md')
const DECLARED_EXPECTED = join(SNAPSHOT_DIR, 'declared.expected.md')
const DECLARED_EDIT_EXPECTED = join(SNAPSHOT_DIR, 'declared-edit.expected.md')
const MODEL_PICKER_EXPECTED = join(SNAPSHOT_DIR, 'model-picker.expected.md')
const NATIVE_DELETE_EXPECTED = join(SNAPSHOT_DIR, 'native-delete.expected.md')
const DELETE_EXPECTED = join(SNAPSHOT_DIR, 'delete.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: Models settings page configures a dormant provider', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    vi.stubEnv('OPENAI_API_KEY', 'models-settings-test-key')
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    await page.addInitScript(() => {
      const events = { received: 0, handled: 0 }
      Reflect.set(window, '__DSH_MODELS_ADAPTER_EVENTS__', events)
      const NativeWebSocket = window.WebSocket
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          this.addEventListener('message', (event: MessageEvent<unknown>) => {
            if (typeof event.data !== 'string') return
            const frame: unknown = JSON.parse(event.data)
            if (typeof frame !== 'object' || frame === null || !('type' in frame) || frame.type !== 'item' || !('value' in frame)) return
            const value = frame.value
            if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'emit' || !('event' in value) || value.event !== 'llm/adapters-updated') return
            const received = ++events.received
            // The Gateway starts notification handlers before this acknowledgement task.
            const channel = new MessageChannel()
            channel.port1.onmessage = () => {
              events.handled = Math.max(events.handled, received)
              channel.port1.close()
              channel.port2.close()
            }
            channel.port2.postMessage(undefined)
          })
        }
      }
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    await browser?.close()
    await scaffold?.close()
  })

  it('rejects layout checks without an explicit viewport before resizing the page', async () => {
    const context = await browser.newContext({ viewport: null })
    try {
      const unsized = await context.newPage()
      await expect(assertModelInputLayout(unsized, unsized.locator('body')))
        .rejects.toThrow('Model input layout checks require an explicit viewport')
      expect(unsized.viewportSize()).toBeNull()
    } finally {
      await context.close()
    }
  })

  it('opens the add card over the dormant directory vocabulary', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-empty'))
    await openSettings(page, 'zh')
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
    await dialog.getByText('\u586b\u5165\u5404\u63d0\u4f9b\u5546\u7684 API \u5bc6\u94a5\u5373\u53ef\u4f7f\u7528\u5176\u6a21\u578b\u3002').waitFor({ timeout: 10_000 })
    // The dormant pi-ai adapter contributes its whole installed catalog; no
    // provider is configured yet, so the page is one add button.
    const add = dialog.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b\u63d0\u4f9b\u5546' })
    await add.waitFor({ timeout: 10_000 })
    // The button enables once the dormant catalog lands in the join.
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    // The card opens on the third-party mode, whose panel carries the select.
    const modes = dialog.getByRole('tablist', { name: '\u6dfb\u52a0\u65b9\u5f0f' })
    await modes.waitFor({ timeout: 10_000 })
    expect(await modes.getByRole('tab', { name: '\u7b2c\u4e09\u65b9\u6a21\u578b\u63d0\u4f9b\u5546' }).getAttribute('aria-selected')).toBe('true')
    const pick = dialog.getByLabel('\u63d0\u4f9b\u5546', { exact: true })
    await pick.waitFor({ timeout: 10_000 })
    await expect.poll(async () => pick.locator('option').count(), { timeout: 10_000 }).toBeGreaterThan(30)
    const options = await pick.locator('option').allTextContents()
    expect(options).toContain('anthropic')
    expect(options).toContain('minimax-cn')
    await pick.selectOption('openai-codex')
    await expect.poll(async () => dialog.getByRole('textbox', { name: 'API \u5bc6\u94a5', exact: true }).count(), { timeout: 10_000 }).toBe(0)
    expect(await dialog.getByRole('button', { name: '\u8ba4\u8bc1\u8bf4\u660e', exact: true }).count()).toBe(0)
    expect(await dialog.textContent()).not.toMatch(/oauth/i)
    const nativeSnapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(NATIVE_KEYLESS_EXPECTED, nativeSnapshot, MODE)
    await pick.selectOption('minimax-cn')
    await dialog.getByRole('textbox', { name: 'API \u5bc6\u94a5', exact: true }).waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EMPTY_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('refuses a key no HTTP header can carry before anything is written', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-illegal-key'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    const key = dialog.getByLabel('API \u5bc6\u94a5')
    const save = dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true })

    // A key no HTTP header can carry would save cleanly and fail the first
    // turn with a ByteString TypeError; the form names the offending field
    // instead.
    await key.fill('sk-\u{1F600}minimax')
    expect(await key.getAttribute('type')).toBe('password')
    await dialog.getByRole('button', { name: '\u663e\u793a\u5bc6\u94a5', exact: true }).click()
    expect(await key.getAttribute('type')).toBe('text')
    await dialog.getByRole('button', { name: '\u9690\u85cf\u5bc6\u94a5', exact: true }).click()
    expect(await key.getAttribute('type')).toBe('password')
    await dialog.getByText('\u8be5 API \u5bc6\u94a5\u683c\u5f0f\u9519\u8bef\uff0c\u8bf7\u68c0\u67e5\u3002').waitFor({ timeout: 10_000 })
    await expect.poll(async () => save.isEnabled(), { timeout: 10_000 }).toBe(false)

    // Clearing it restores submit: an empty field means "keep what is stored",
    // never a refusal, or editing any other setting would demand the key.
    await key.fill('')
    await expect.poll(async () => save.isEnabled(), { timeout: 10_000 }).toBe(true)
    expect(await dialog.getByText('\u8be5 API \u5bc6\u94a5\u683c\u5f0f\u9519\u8bef\uff0c\u8bf7\u68c0\u67e5\u3002').count()).toBe(0)
  }, 60_000)

  it('saves a blank key as a reference-free provider-native profile', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-native-auth'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    const row = dialog.getByText('minimax-cn', { exact: true }).first()
    await row.waitFor({ timeout: 10_000 })
    await dialog.getByText('\u5df2\u4fdd\u5b58 minimax-cn\u3002', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('img', { name: 'API \u5bc6\u94a5\u5df2\u914d\u7f6e' }).count()).toBe(0)
    expect(await dialog.getByRole('img', { name: 'API \u5bc6\u94a5\u7f3a\u5931' }).count()).toBe(0)
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain('minimax-cn: {}')
    expect(document).not.toContain('MINIMAX_CN_API_KEY')
  }, 60_000)

  it('describes reference-free deletion without claiming a credential exists', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-native-delete'))
    const settingsDialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await settingsDialog.getByRole('button', { name: '\u5220\u9664 minimax-cn', exact: true }).click()
    const deleteDialog = page.getByRole('dialog', { name: '\u5220\u9664 minimax-cn\uff1f' })
    await deleteDialog.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label="\u5220\u9664 minimax-cn\uff1f"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(NATIVE_DELETE_EXPECTED, snapshot, MODE)
    await deleteDialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
  }, 60_000)

  it('stores the key under the derived reference and keeps the route live', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-add'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await dialog.getByRole('button', { name: '\u7f16\u8f91 minimax-cn' }).click()
    await dialog.getByRole('textbox', { name: 'API \u5bc6\u94a5', exact: true }).fill('sk-e2e-minimax')
    await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    // The profile lands in cordis.patch.yml with only the derived reference, the
    // key value lands in the harness home's .credentials.yaml, the dormant route
    // registers, and the topology frame invalidates the page into the row.
    await expect.poll(
      async () => dialog.getByRole('textbox', { name: 'API \u5bc6\u94a5', exact: true }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    await dialog.getByRole('img', { name: 'API \u5bc6\u94a5\u5df2\u914d\u7f6e' }).waitFor({ timeout: 10_000 })
    await dialog.getByText('\u5df2\u4fdd\u5b58 minimax-cn\u3002', { exact: true }).waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain('minimax-cn:')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    expect(document).not.toContain('sk-e2e-minimax')
    const credentialFile = join(scaffold.harnessHome, '.credentials.yaml')
    await expect.poll(
      async () => readFile(credentialFile, 'utf8').catch(() => ''),
      { timeout: 10_000 },
    ).toContain('MINIMAX_CN_API_KEY: sk-e2e-minimax')
    expect(await page.content()).not.toContain('sk-e2e-minimax')
  }, 60_000)

  it('applies a customized-settings field as a merge patch', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-customized'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await dialog.getByRole('button', { name: '\u7f16\u8f91 minimax-cn' }).click()
    await dialog.getByPlaceholder('•'.repeat('sk-e2e-minimax'.length), { exact: true }).waitFor({ timeout: 10_000 })
    expect(await dialog.textContent()).not.toContain('API \u5bc6\u94a5\u6765\u6e90\uff1a')
    expect(await dialog.textContent()).not.toMatch(/oauth/i)
    await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
    const url = dialog.getByLabel('API \u5730\u5740')
    await url.waitFor({ timeout: 10_000 })
    await url.fill('https://gateway.minimax.example/v1')
    await dialog.getByRole('combobox', { name: '\u91cd\u8bd5\u7b56\u7565', exact: true }).selectOption('normal')
    await dialog.getByLabel('\u6700\u5927\u91cd\u8bd5\u6b21\u6570', { exact: true }).fill('3')
    await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    // The editor closes back to the row; the fold's write merged into the
    // stored profile beside the reference.
    await expect.poll(async () => dialog.getByLabel('API \u5730\u5740').count(), { timeout: 10_000 }).toBe(0)
    await dialog.getByText('\u5df2\u4fdd\u5b58 minimax-cn\u3002', { exact: true }).waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain('baseURL: https://gateway.minimax.example/v1')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    expect(document).toMatch(/retryPolicy:\n\s+mode: normal\n\s+maxRetries: 3\n/u)
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CONFIGURED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('filters the discovered model catalog and deselects only visible candidates', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-picker'))
    const settingsDialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await settingsDialog.getByRole('button', { name: '\u7f16\u8f91 minimax-cn' }).click()
    await settingsDialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
    await settingsDialog.getByRole('button', { name: '\u83b7\u53d6\u53ef\u7528\u6a21\u578b' }).click()

    const picker = page.getByRole('dialog', { name: '\u9009\u62e9\u6a21\u578b' })
    await picker.waitFor({ timeout: 10_000 })
    const boxes = picker.getByRole('checkbox')
    const count = await boxes.count()
    expect(count).toBeGreaterThan(0)
    expect(await boxes.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual(
      Array.from({ length: count }, () => true),
    )

    const search = picker.getByRole('searchbox', { name: '\u641c\u7d22\u6a21\u578b' })
    await search.fill('highspeed')
    await expect.poll(async () => boxes.count()).toBe(1)
    await picker.getByRole('button', { name: '\u53d6\u6d88\u5168\u9009' }).click()
    expect(await boxes.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual(
      [false],
    )

    await search.fill('')
    await expect.poll(async () => boxes.count()).toBe(count)
    const restored = await boxes.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))
    expect(restored.filter(checked => !checked)).toHaveLength(1)
    expect(await picker.getByRole('checkbox', { name: 'MiniMax-M2.7-highspeed', exact: true }).isChecked()).toBe(false)
    await picker.getByRole('button', { name: '\u5168\u9009' }).waitFor()
    await picker.getByRole('button', { name: '\u5168\u9009' }).click()
    const snapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label="\u9009\u62e9\u6a21\u578b"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(MODEL_PICKER_EXPECTED, snapshot, MODE)

    expect(await boxes.evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).checked))).toEqual(
      Array.from({ length: count }, () => true),
    )
    await picker.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
    await settingsDialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
  }, 60_000)

  it('declares a route the adapter does not ship', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-declare'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    const add = dialog.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b\u63d0\u4f9b\u5546' })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    // The custom-API mode is the second segment of the one add card; its
    // purpose line replaces the catalog one.
    await dialog.getByRole('tab', { name: '\u81ea\u5b9a\u4e49\u6a21\u578b API' }).click()
    await dialog.getByText('\u8fde\u63a5\u4e2d\u8f6c\u7ad9\u3001\u81ea\u90e8\u7f72\u670d\u52a1\u6216\u5176\u4ed6\u517c\u5bb9 OpenAI / Anthropic / Gemini \u534f\u8bae\u7684\u63a5\u53e3\uff0c\u9700\u586b\u5199 API \u5730\u5740\u3001\u534f\u8bae\u548c\u6a21\u578b\u3002').waitFor({ timeout: 10_000 })
    // The third-party panel stays mounted, hidden, beside this one, so the
    // form is addressed through its own panel.
    const custom = dialog.getByRole('tabpanel', { name: '\u81ea\u5b9a\u4e49\u6a21\u578b API' })
    await custom.getByLabel('Provider ID').fill('acme-gateway')
    await custom.getByLabel('\u663e\u793a\u540d\u79f0').fill('Acme Gateway')
    await custom.getByLabel('API \u5730\u5740').fill('https://gateway.acme.example/v1')
    // No provider-scoped reasoning control: effort is a per-model capability
    // and the models under one provider disagree about it, so each model row
    // declares its own levels instead.
    expect(await dialog.getByLabel('\u63a8\u7406\u5f3a\u5ea6').count()).toBe(0)
    await custom.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b', exact: true }).click()
    await custom.getByLabel('\u6a21\u578b ID 1').fill('acme-large')
    await custom.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
    expect(await custom.getByLabel('\u4e0a\u4e0b\u6587\u7a97\u53e3 1').getAttribute('placeholder')).toBe('1M')
    expect(await custom.getByLabel('\u6700\u5927\u8f93\u51fa token \u6570 1').getAttribute('placeholder')).toBe('128K')
    expect(await custom.getByRole('group', { name: '\u8f93\u5165\u7c7b\u578b 1' }).getByRole('checkbox', { name: '\u56fe\u7247' }).isChecked()).toBe(false)
    await custom.getByRole('group', { name: '\u8f93\u5165\u7c7b\u578b 1' }).getByRole('checkbox', { name: '\u56fe\u7247' }).check()
    // The switch seeds off, low, medium, and high rows; this route serves no medium.
    const reasoning = custom.getByRole('group', { name: '\u63a8\u7406\u7b49\u7ea7 1' })
    await reasoning.getByRole('switch', { name: '\u63a8\u7406\u7b49\u7ea7 1' }).click()
    await reasoning.getByRole('button', { name: '\u5220\u9664\u6863\u4f4d medium', exact: true }).click()
    await custom.getByRole('button', { name: '\u521b\u5efa\u63d0\u4f9b\u5546', exact: true }).click()

    const row = dialog.getByText('Acme Gateway', { exact: true }).first()
    await row.waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain('acme-gateway:')
    expect(document).toContain('reasoningEfforts:')
    await expect(scaffold.ctx.llm.resolveModelInfo('acme-gateway', 'acme-large')).resolves.toMatchObject({
      context: { contextWindow: 1_000_000 },
      inputModalities: ['text', 'image'],
      reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
    })

    // The tag follows the adapter's installed catalog: this route is in no
    // catalog, while minimax-cn is — even though both now have profiles.
    const rowCard = (name: string) => dialog.locator('li').filter({ hasText: name }).first()
    await expect.poll(async () => rowCard('Acme Gateway').getByText('\u81ea\u5b9a\u4e49').count(), { timeout: 10_000 }).toBe(1)
    expect(await rowCard('minimax-cn').getByText('\u81ea\u5b9a\u4e49').count()).toBe(0)

    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DECLARED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('reopens the name and protocol a declared route was created with', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-declared-identity'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await dialog.getByRole('button', { name: '\u7f16\u8f91 Acme Gateway (acme-gateway)' }).click()
    await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
    // The create card asked this route for a name and a protocol because
    // nothing can default them; the editor reaches the same two fields rather
    // than sending the user to cordis.patch.yml for what only this route names.
    const protocol = dialog.getByLabel('API \u534f\u8bae')
    await protocol.waitFor({ timeout: 10_000 })
    expect(await protocol.inputValue()).toBe('openai-completions')
    const name = dialog.getByLabel('\u663e\u793a\u540d\u79f0', { exact: true })
    expect(await name.inputValue()).toBe('Acme Gateway')
    await dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
    expect(await dialog.getByRole('group', { name: '\u8f93\u5165\u7c7b\u578b 1' }).getByRole('checkbox', { name: '\u56fe\u7247' }).isChecked()).toBe(true)
    // The stored levels come back as rows beside the values they send.
    const reasoning = dialog.getByRole('group', { name: '\u63a8\u7406\u7b49\u7ea7 1' })
    expect(await reasoning.getByRole('combobox').evaluateAll(selects => selects.map(select => (select as HTMLSelectElement).value)))
      .toEqual(['off', 'low', 'high'])
    expect(await reasoning.getByLabel('high API \u53c2\u6570\u503c').inputValue()).toBe('high')
    await assertModelInputLayout(page, dialog)
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(DECLARED_EDIT_EXPECTED, snapshot, MODE)

    await protocol.selectOption('anthropic-messages')
    await name.fill('Acme \u7f51\u5173')
    await dialog.getByRole('group', { name: '\u8f93\u5165\u7c7b\u578b 1' }).getByRole('checkbox', { name: '\u56fe\u7247' }).uncheck()
    // A gateway with its own spelling for the top level.
    await reasoning.getByLabel('high API \u53c2\u6570\u503c').fill('deep')
    await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    await expect.poll(async () => dialog.getByLabel('API \u534f\u8bae').count(), { timeout: 10_000 }).toBe(0)
    // The adapter re-resolved the route under the new protocol and re-registered
    // it under the new name: an unserviceable profile would have been refused
    // at the write instead, and a rename that did not re-register would leave
    // the old label on the row.
    await dialog.getByText('Acme \u7f51\u5173', { exact: true }).first().waitFor({ timeout: 10_000 })
    // The status line names the route as the refreshed directory reports it;
    // the target captured when the card opened still carries the old name.
    await dialog.getByText('\u5df2\u4fdd\u5b58 Acme \u7f51\u5173 (acme-gateway)\u3002', { exact: true }).waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    expect(document).toContain('api: anthropic-messages')
    expect(document).toContain('displayName: Acme \u7f51\u5173')
    expect(document).toContain('high: deep')
    // The level keeps its id and name; only its wire spelling changed.
    await expect(scaffold.ctx.llm.resolveModelInfo('acme-gateway', 'acme-large')).resolves.toMatchObject({
      inputModalities: ['text'],
      reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high', name: 'High' }] },
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('saves image-only input and reopens the same selection', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-input-types'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await dialog.getByRole('button', { name: '\u7f16\u8f91 Acme \u7f51\u5173 (acme-gateway)' }).click()
    await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
    await dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
    expect(await dialog.getByRole('group', { name: '\u8f93\u5165\u7c7b\u578b 1' }).getByRole('checkbox', { name: '\u56fe\u7247' }).isChecked()).toBe(false)
    const inputs = dialog.getByRole('group', { name: '\u8f93\u5165\u7c7b\u578b 1' })
    expect(await inputs.getByRole('checkbox', { name: '\u6587\u672c' }).isChecked()).toBe(true)
    expect(await inputs.getByRole('checkbox', { name: '\u6587\u672c' }).isDisabled()).toBe(true)
    await inputs.getByRole('checkbox', { name: '\u56fe\u7247' }).check()
    await inputs.getByRole('checkbox', { name: '\u6587\u672c' }).uncheck()
    const reads: { request: Request; release: () => void }[] = []
    const firstStarted = Promise.withResolvers<undefined>()
    let nextStarted: PromiseWithResolvers<undefined> | undefined
    let released = false
    const releaseAll = (): void => { released = true; for (const read of reads) read.release() }
    const intercept = async (route: Route): Promise<void> => {
      const body: unknown = route.request().postDataJSON()
      const payload = typeof body === 'object' && body !== null && 'payload' in body ? body.payload : undefined
      const args = typeof payload === 'object' && payload !== null && 'args' in payload ? payload.args : undefined
      const refs = typeof args === 'object' && args !== null ? Object.values(args).find(Array.isArray) : undefined
      // The page joins multiple references; the editor previews only its own reference.
      if (Array.isArray(refs) && refs.length > 1 && !released) {
        const gate = Promise.withResolvers<undefined>()
        reads.push({ request: route.request(), release: () => { gate.resolve(undefined) } })
        firstStarted.resolve(undefined)
        nextStarted?.resolve(undefined)
        await gate.promise
      }
      await route.continue()
    }
    await page.route('**/api/credentials/describe', intercept)
    try {
      await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
      await dialog.getByLabel('\u6a21\u578b ID 1').waitFor({ state: 'detached', timeout: 10_000 })
      await expect(scaffold.ctx.llm.resolveModelInfo('acme-gateway', 'acme-large')).resolves.toMatchObject({
        inputModalities: ['image'],
      })
      await firstStarted.promise
      const obsolete = [...reads]
      const receivedBefore = await page.evaluate(() => {
        const events: unknown = Reflect.get(window, '__DSH_MODELS_ADAPTER_EVENTS__')
        if (typeof events !== 'object' || events === null || !('received' in events) || typeof events.received !== 'number') throw new Error('Missing adapter event observer')
        return events.received
      })
      nextStarted = Promise.withResolvers<undefined>()
      const successorHandled = page.waitForFunction((received) => {
        const events: unknown = Reflect.get(window, '__DSH_MODELS_ADAPTER_EVENTS__')
        return typeof events === 'object' && events !== null && 'handled' in events && typeof events.handled === 'number' && events.handled > received
      }, receivedBefore)
      scaffold.ctx.emit('llm/adapters-updated')
      await successorHandled
      await nextStarted.promise
      const oldResponses = obsolete.map(read => page.waitForResponse(response => response.request() === read.request))
      for (const read of obsolete) read.release()
      await Promise.all(oldResponses.map(async (response) => { await (await response).finished() }))
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })))
      const saved = dialog.getByText('\u5df2\u4fdd\u5b58 Acme \u7f51\u5173 (acme-gateway)\u3002', { exact: true })
      const edit = dialog.getByRole('button', { name: '\u7f16\u8f91 Acme \u7f51\u5173 (acme-gateway)' })
      expect(await saved.count()).toBe(0)
      expect(await edit.isDisabled()).toBe(true)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'refreshing.expected.md'),
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
      releaseAll()
      // The saved notice confirms the current joined snapshot after the editor closes.
      await saved.waitFor({ timeout: 10_000 })
      await edit.click()
      await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
      await dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
      expect(await inputs.getByRole('checkbox', { name: '\u56fe\u7247' }).isChecked()).toBe(true)
      expect(await inputs.getByRole('checkbox', { name: '\u6587\u672c' }).isChecked()).toBe(false)
      expect(await inputs.getByRole('checkbox', { name: '\u56fe\u7247' }).isDisabled()).toBe(true)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'image-only.expected.md'),
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
      await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
    } finally {
      releaseAll()
      await page.unrouteAll({ behavior: 'wait' })
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('inherits installed vision input and retains it when adopting a discovered model', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-catalog-inputs'))
    await scaffold.ctx.settings.mutate('llm-pi-ai', [{
      op: 'set', path: ['providers', 'openai'],
      value: { models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 272000, maxTokens: 128000 }] },
    }])
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    const edit = dialog.getByRole('button', { name: '\u7f16\u8f91 openai', exact: true })
    try {
      await edit.click()
      await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
      await dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
      const types = dialog.getByRole('group', { name: '\u8f93\u5165\u7c7b\u578b 1' })
      const image = types.getByRole('checkbox', { name: '\u56fe\u7247', exact: true })
      await expect.poll(() => image.isChecked()).toBe(true)
      expect(await types.getByRole('checkbox', { name: '\u6587\u672c', exact: true }).isChecked()).toBe(true)
      const before = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'catalog-inputs.expected.md'),
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)
      await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
      await types.waitFor({ state: 'detached' })
      expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).toBe(before)

      await edit.click()
      await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
      await dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
      await expect.poll(() => image.isEnabled()).toBe(true)
      await image.uncheck()
      await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
      await types.waitFor({ state: 'detached' })
      await expect(scaffold.ctx.llm.resolveModelInfo('openai', 'gpt-6-astra')).resolves.toMatchObject({ inputModalities: ['text'] })
      // The saved notice confirms the browser directory refresh after the editor closes.
      // Reopening before it copies the previous selection into a new draft, which
      // checkbox polling cannot correct.
      await dialog.getByText('\u5df2\u4fdd\u5b58 openai\u3002', { exact: true }).waitFor({ timeout: 10_000 })
      await edit.click()
      await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
      await dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
      await expect.poll(() => image.isEnabled()).toBe(true)
      expect(await image.isChecked()).toBe(false)

      await dialog.getByRole('button', { name: '\u5220\u9664\u6a21\u578b 1' }).click()
      await dialog.getByRole('button', { name: '\u83b7\u53d6\u53ef\u7528\u6a21\u578b' }).click()
      const picker = page.getByRole('dialog', { name: '\u9009\u62e9\u6a21\u578b' })
      await picker.getByRole('button', { name: '\u53d6\u6d88\u5168\u9009' }).click()
      await picker.getByRole('searchbox', { name: '\u641c\u7d22\u6a21\u578b' }).fill('gpt-6-astra')
      await picker.getByRole('checkbox', { name: 'gpt-6-astra', exact: true }).check()
      await picker.getByRole('button', { name: '\u66f4\u65b0\u5217\u8868' }).click()
      await dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1' }).click()
      expect(await image.isChecked()).toBe(true)
      await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
      await types.waitFor({ state: 'detached' })
      await expect(scaffold.ctx.llm.resolveModelInfo('openai', 'gpt-6-astra')).resolves.toMatchObject({ inputModalities: ['text', 'image'] })
    } finally {
      await scaffold.ctx.settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', 'openai'] }])
      await edit.waitFor({ state: 'detached' })
      await page.getByRole('dialog', { name: '\u9009\u62e9\u6a21\u578b' }).waitFor({ state: 'detached' })
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('saves model drag order, discards canceled moves, and preserves the other provider', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-order'))
    const dialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    const edit = dialog.getByRole('button', { name: '\u7f16\u8f91 Acme \u7f51\u5173 (acme-gateway)' })
    const settings = () => scaffold.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'llm-pi-ai')?.value
    await edit.click()
    await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
    for (const [position, id] of [[2, 'order-second'], [3, 'order-third']] as const) {
      await dialog.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b', exact: true }).click()
      await dialog.getByLabel(`\u6a21\u578b ID ${String(position)}`, { exact: true }).fill(id)
      await dialog.getByLabel(`\u663e\u793a\u540d\u79f0 ${String(position)}`, { exact: true }).fill(id)
    }
    await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    await dialog.getByText('\u5df2\u4fdd\u5b58 Acme \u7f51\u5173 (acme-gateway)\u3002', { exact: true }).waitFor()
    const before = structuredClone(settings())
    const path = join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml')
    const document = await readFile(path, 'utf8')

    for (const save of [false, true]) {
      await edit.click()
      await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
      // Keep the last insertion gap inside the scrollport before native dragging starts.
      await dialog.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b', exact: true }).scrollIntoViewIfNeeded()
      const source = dialog.getByRole('button', { name: '\u8c03\u6574\u6a21\u578b\u987a\u5e8f 1', exact: true })
      const target = dialog.getByRole('button', { name: `\u8c03\u6574\u6a21\u578b\u987a\u5e8f ${save ? '3' : '2'}`, exact: true })
      await source.hover()
      const from = await source.boundingBox()
      if (from === null) throw new Error('Model drag handle is not visible')
      await page.mouse.down()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, { steps: 3 })
      // Native dragging needs an initial motion; the second hover follows any scroll at the dialog edge.
      await target.hover()
      const targetBox = await target.boundingBox()
      if (targetBox === null) throw new Error('Model drop target is not visible')
      await target.hover({ position: { x: targetBox.width / 2, y: targetBox.height * 0.75 } })
      const insertion = await target.evaluate((button) => {
        const rect = button.closest('[data-row-key]')!.getBoundingClientRect()
        return { x: rect.left + 20, y: rect.bottom + 4 }
      })
      await page.mouse.move(insertion.x, insertion.y, { steps: 3 })
      expect(await dialog.locator('[data-drop-target]').evaluate(element => getComputedStyle(element).zIndex)).toBe('1')
      await page.mouse.up()
      await page.locator('body > div[inert][aria-hidden="true"]:has(button[aria-label^="\u8c03\u6574\u6a21\u578b\u987a\u5e8f "])').waitFor({ state: 'detached' })
      await expect.poll(() => dialog.getByLabel(`\u6a21\u578b ID ${save ? '3' : '2'}`, { exact: true }).inputValue()).toBe('acme-large')
      await expect.poll(() => dialog.locator('[data-row-key]').evaluateAll(rows => rows.flatMap(row => row.getAnimations()).length)).toBe(0)
      expect(await readFile(path, 'utf8')).toBe(document)
      await dialog.getByRole('button', { name: save ? '\u4fdd\u5b58' : '\u53d6\u6d88', exact: true }).click()
      await dialog.getByLabel('\u6a21\u578b ID 1', { exact: true }).waitFor({ state: 'detached' })
      if (!save) expect(settings()).toEqual(before)
    }

    await dialog.getByText('\u5df2\u4fdd\u5b58 Acme \u7f51\u5173 (acme-gateway)\u3002', { exact: true }).waitFor()
    expect(settings()).toMatchObject({ providers: {
      'acme-gateway': { models: [
        { id: 'order-second', name: 'order-second' },
        { id: 'order-third', name: 'order-third' },
        { id: 'acme-large', input: ['image'], reasoningEfforts: { off: null, low: 'low', high: 'deep' } },
      ] },
      'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY', baseURL: 'https://gateway.minimax.example/v1' },
    } })
    await edit.click()
    await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
    expect(await Promise.all([1, 2, 3].map(position =>
      dialog.getByLabel(`\u6a21\u578b ID ${String(position)}`, { exact: true }).inputValue(),
    ))).toEqual(['order-second', 'order-third', 'acme-large'])
    const viewport = page.viewportSize()
    if (viewport === null) throw new Error('Model ordering checks require an explicit viewport')
    try {
      const id = dialog.getByRole('textbox', { name: '\u6a21\u578b ID 1', exact: true })
      const name = dialog.getByRole('textbox', { name: '\u663e\u793a\u540d\u79f0 1', exact: true })
      const toggle = dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1', exact: true })
      const desktopId = await id.boundingBox()
      const desktopName = await name.boundingBox()
      if (desktopId === null || desktopName === null) throw new Error('Wide model identity fields are not visible')
      expect(Math.abs(desktopId.y - desktopName.y)).toBeLessThan(1)
      await name.focus()
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await name.evaluate(input => input.ownerDocument.activeElement === input)).toBe(true)
      expect(await name.isVisible()).toBe(true)
      await toggle.click()
      await name.waitFor({ state: 'hidden' })
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'mobile-collapsed.expected.md'),
        await captureStableAria(page, '[data-shortcut-modal="settings"]', scaffold.workspaceCwd), MODE)
      for (const name of ['\u8c03\u6574\u6a21\u578b\u987a\u5e8f 1', '\u6a21\u578b\u9009\u9879 1', '\u5220\u9664\u6a21\u578b 1']) {
        const box = await dialog.getByRole('button', { name, exact: true }).boundingBox()
        expect(box).not.toBeNull()
        if (box === null) throw new Error(`Model control is not visible: ${name}`)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(390)
      }
      const compactId = await id.boundingBox()
      if (compactId === null) throw new Error('Narrow model ID is not visible')
      await toggle.click()
      await name.waitFor({ state: 'visible' })
      await name.fill('\u624b\u673a\u4e0a\u7684\u5b8c\u6574\u663e\u793a\u540d\u79f0')
      await toggle.click()
      await name.waitFor({ state: 'hidden' })
      expect(await id.inputValue()).toBe('order-second')
      await toggle.click()
      expect(await name.inputValue()).toBe('\u624b\u673a\u4e0a\u7684\u5b8c\u6574\u663e\u793a\u540d\u79f0')
      const expandedName = await name.boundingBox()
      // Expanding can scroll the dialog, so the ID is measured again in the same frame.
      const expandedId = await id.boundingBox()
      if (expandedName === null || expandedId === null) throw new Error('Expanded model fields are not visible')
      expect(expandedName.y).toBeGreaterThanOrEqual(expandedId.y + expandedId.height)
      expect(expandedName.width).toBeGreaterThan(compactId.width)
      expect(await dialog.getByRole('region', { name: '\u6a21\u578b\u76ee\u5f55', exact: true })
        .evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'mobile-expanded.expected.md'),
        await captureStableAria(page, '[data-shortcut-modal="settings"]', scaffold.workspaceCwd), MODE)
    } finally {
      await page.setViewportSize(viewport)
    }
    await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
    expect(tripwire.pageErrors).toEqual([])
  })

  it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }])(
    'keeps mobile model actions, focus and keyboard order in $name', async ({ name: engineName, engine }) => {
      const provider = `review-${engineName.toLowerCase()}`
      let mobileBrowser: Browser | undefined
      try {
        await scaffold.ctx.settings.mutate('llm-pi-ai', [{
          op: 'set', path: ['providers', provider], value: {
            api: 'anthropic-messages', baseURL: 'https://layout.example',
            models: [{ id: 'layout-model', name: '\u5b8c\u6574\u663e\u793a\u540d\u79f0' }, { id: 'next-model', name: '\u4e0b\u4e00\u6a21\u578b' }],
          },
        }])
        mobileBrowser = await engine.launch()
        const mobilePage = await mobileBrowser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
        const errors = watchConsole(mobilePage)
        onTestFailed(() => saveFailureShot(mobilePage, `web-e2e-models-mobile-${engineName.toLowerCase()}`))
        await mobilePage.goto(scaffold.authenticatedUrl)
        await openSettings(mobilePage, 'zh')
        const dialog = mobilePage.getByRole('dialog', { name: '\u8bbe\u7f6e' })
        await dialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
        const edit = dialog.getByRole('button', { name: `\u7f16\u8f91 ${provider}`, exact: true })
        await edit.click()
        await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
        const id = dialog.getByRole('textbox', { name: '\u6a21\u578b ID 1', exact: true })
        const name = dialog.getByRole('textbox', { name: '\u663e\u793a\u540d\u79f0 1', exact: true })
        const toggle = dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1', exact: true })
        const nextToggle = dialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 2', exact: true })
        await toggle.click()
        await assertModelInputLayout(mobilePage, dialog)
        await dialog.getByRole('button', { name: '\u8c03\u6574\u6a21\u578b\u987a\u5e8f 1', exact: true }).hover()
        const tooltip = mobilePage.getByRole('tooltip')
        await tooltip.waitFor()
        expect(await tooltip.evaluate(element => element.parentElement === element.ownerDocument.body)).toBe(true)
        await expectTooltipOnTop(tooltip)
        await id.hover()
        await tooltip.waitFor({ state: 'hidden' })
        await toggle.click()
        await name.fill('\u7f29\u7a84\u540e\u7ee7\u7eed\u7f16\u8f91')
        const input = await name.elementHandle()
        if (input === null) throw new Error('Model name input is missing')
        await mobilePage.setViewportSize({ width: 390, height: 844 })
        expect(await input.evaluate(element => element.isConnected && element.ownerDocument.activeElement === element)).toBe(true)
        await nextToggle.click()
        expect(await nextToggle.getAttribute('aria-expanded')).toBe('true')
        expect(await toggle.getAttribute('aria-expanded')).toBe('true')
        await nextToggle.click()
        await name.fill('\u624b\u673a\u4fdd\u5b58\u540e\u7684\u540d\u79f0')
        await dialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
        await id.waitFor({ state: 'detached' })
        expect(scaffold.ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')?.value).toMatchObject({
          providers: { [provider]: { models: [{ id: 'layout-model', name: '\u624b\u673a\u4fdd\u5b58\u540e\u7684\u540d\u79f0' }, { id: 'next-model', name: '\u4e0b\u4e00\u6a21\u578b' }] } },
        })
        await dialog.getByText(`\u5df2\u4fdd\u5b58 ${provider}\u3002`, { exact: true }).waitFor()
        await edit.click()
        await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
        await name.waitFor({ state: 'hidden' })
        await toggle.focus()
        await mobilePage.keyboard.press('Enter')
        const tab = engine === webkit ? 'Alt+Tab' : 'Tab'
        await mobilePage.keyboard.press(tab)
        expect(await dialog.getByRole('button', { name: '\u5220\u9664\u6a21\u578b 1', exact: true })
          .evaluate(button => button.ownerDocument.activeElement === button)).toBe(true)
        await mobilePage.keyboard.press(tab)
        expect(await name.evaluate(element => element.ownerDocument.activeElement === element)).toBe(true)
        await name.fill('\u76f4\u63a5\u70b9\u51fb\u6536\u8d77\u540e\u4fdd\u7559')
        await toggle.click()
        await name.waitFor({ state: 'hidden' })
        expect(await toggle.getAttribute('aria-expanded')).toBe('false')
        expect(await toggle.evaluate(button => button.ownerDocument.activeElement === button)).toBe(true)
        await toggle.click()
        expect(await name.inputValue()).toBe('\u76f4\u63a5\u70b9\u51fb\u6536\u8d77\u540e\u4fdd\u7559')
        const region = dialog.getByRole('region', { name: '\u6a21\u578b\u76ee\u5f55', exact: true })
        expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
        expect(errors.pageErrors).toEqual([])

        const touchPage = await mobileBrowser.newPage({
          viewport: { width: 390, height: 844 }, locale: ZH_BROWSER_LOCALE, isMobile: true, hasTouch: true,
        })
        const touchErrors = watchConsole(touchPage)
        await touchPage.goto(scaffold.authenticatedUrl)
        await openSettings(touchPage, 'zh')
        const touchDialog = touchPage.getByRole('dialog', { name: '\u8bbe\u7f6e' })
        await touchDialog.getByRole('button', { name: '\u6a21\u578b', exact: true }).tap()
        await touchDialog.getByRole('button', { name: `\u7f16\u8f91 ${provider}`, exact: true }).tap()
        await touchDialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').tap()
        const touchToggle = touchDialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 1', exact: true })
        const touchName = touchDialog.getByRole('textbox', { name: '\u663e\u793a\u540d\u79f0 1', exact: true })
        await touchToggle.tap()
        expect(await touchName.evaluate(element => element.ownerDocument.activeElement === element)).toBe(false)
        await touchName.fill('\u89e6\u5c4f\u7f16\u8f91\u540e\u7684\u540d\u79f0')
        await touchToggle.tap()
        await touchName.waitFor({ state: 'hidden' })
        expect(await touchToggle.getAttribute('aria-expanded')).toBe('false')
        await touchToggle.tap()
        expect(await touchName.inputValue()).toBe('\u89e6\u5c4f\u7f16\u8f91\u540e\u7684\u540d\u79f0')
        await touchName.fill('\u89e6\u5c4f\u4fdd\u5b58\u540e\u7684\u540d\u79f0')
        const touchNext = touchDialog.getByRole('button', { name: '\u6a21\u578b\u9009\u9879 2', exact: true })
        await touchNext.tap()
        expect(await touchNext.getAttribute('aria-expanded')).toBe('true')
        await touchDialog.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).tap()
        await touchName.waitFor({ state: 'detached' })
        expect(scaffold.ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')?.value).toMatchObject({
          providers: { [provider]: { models: [{ id: 'layout-model', name: '\u89e6\u5c4f\u4fdd\u5b58\u540e\u7684\u540d\u79f0' }, { id: 'next-model', name: '\u4e0b\u4e00\u6a21\u578b' }] } },
        })
        expect(touchErrors.pageErrors).toEqual([])
      } finally {
        await mobileBrowser?.close()
        await scaffold.ctx.settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', provider] }])
      }
    }, 60_000,
  )

  it.each([{ name: 'Chromium', engine: chromium }, { name: 'WebKit', engine: webkit }])(
    'keeps keyboard reorder focus and visibility in $name', async ({ engine }) => {
      const keyboardBrowser = await engine.launch()
      try {
        const keyboardPage = await keyboardBrowser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
        await keyboardPage.goto(scaffold.authenticatedUrl)
        await openSettings(keyboardPage, 'zh')
        await keyboardPage.getByRole('button', { name: '\u6a21\u578b', exact: true }).click()
        const dialog = keyboardPage.getByRole('dialog', { name: '\u8bbe\u7f6e' })
        await dialog.getByRole('button', { name: '\u7f16\u8f91 Acme \u7f51\u5173 (acme-gateway)' }).click()
        await dialog.getByText('\u81ea\u5b9a\u4e49\u8bbe\u7f6e').click()
        const initialFirst = await dialog.getByLabel('\u6a21\u578b ID 1', { exact: true }).inputValue()
        for (let position = 4; position <= 9; position++) {
          await dialog.getByRole('button', { name: '\u6dfb\u52a0\u6a21\u578b', exact: true }).click()
          await dialog.getByLabel(`\u6a21\u578b ID ${String(position)}`, { exact: true }).fill(`keyboard-${String(position)}`)
        }
        const source = await dialog.getByRole('button', { name: '\u8c03\u6574\u6a21\u578b\u987a\u5e8f 1', exact: true }).elementHandle()
        if (source === null) throw new Error('Keyboard reorder handle is missing')
        await source.focus()
        for (let position = 2; position <= 9; position++) {
          await keyboardPage.keyboard.press('ArrowDown')
          await expect.poll(() => source.evaluate(button => document.activeElement === button)).toBe(true)
          expect(await source.getAttribute('aria-label')).toBe(`\u8c03\u6574\u6a21\u578b\u987a\u5e8f ${String(position)}`)
          await expect.poll(() => source.evaluate(button => button.closest('[data-row-key]')!.getAnimations().length)).toBe(0)
          expect(await source.evaluate((button) => {
            const rect = button.getBoundingClientRect()
            let top = 0
            let bottom = innerHeight
            for (let parent = button.parentElement; parent !== null; parent = parent.parentElement) {
              if (getComputedStyle(parent).overflowY === 'visible') continue
              const clip = parent.getBoundingClientRect()
              top = Math.max(top, clip.top)
              bottom = Math.min(bottom, clip.bottom)
            }
            return rect.top >= top && rect.bottom <= bottom
          })).toBe(true)
        }
        expect(await dialog.getByLabel('\u6a21\u578b ID 9', { exact: true }).inputValue()).toBe(initialFirst)
        await keyboardPage.keyboard.press('ArrowUp')
        await expect.poll(() => source.evaluate(button => document.activeElement === button)).toBe(true)
        expect(await source.getAttribute('aria-label')).toBe('\u8c03\u6574\u6a21\u578b\u987a\u5e8f 8')
        await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
      } finally {
        await keyboardBrowser.close()
      }
    }, 60_000,
  )

  it('confirms an identified provider deletion before removing its profile and key', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-delete'))
    expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).not.toContain('openai:')
    const settingsDialog = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await settingsDialog.getByRole('button', { name: '\u5220\u9664 minimax-cn', exact: true }).click()
    const deleteDialog = page.getByRole('dialog', { name: '\u5220\u9664 minimax-cn\uff1f' })
    await deleteDialog.waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label="\u5220\u9664 minimax-cn\uff1f"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(DELETE_EXPECTED, snapshot, MODE)

    await deleteDialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
    expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).toContain('minimax-cn:')
    await settingsDialog.getByRole('button', { name: '\u5220\u9664 minimax-cn', exact: true }).click()
    await page.getByRole('dialog', { name: '\u5220\u9664 minimax-cn\uff1f' })
      .getByRole('button', { name: '\u5220\u9664 minimax-cn', exact: true }).click()
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'),
      { timeout: 10_000 },
    ).not.toContain('minimax-cn:')
    expect(await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8'))
      .not.toContain('MINIMAX_CN_API_KEY')
    await expect.poll(
      async () => page.getByRole('dialog', { name: '\u5220\u9664 minimax-cn\uff1f' }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'configured.expected.md', 'declared-edit.expected.md', 'declared.expected.md',
      'delete.expected.md', 'empty.expected.md', 'model-picker.expected.md',
      'native-delete.expected.md', 'native-keyless.expected.md', 'catalog-inputs.expected.md',
      'mobile-collapsed.expected.md', 'mobile-expanded.expected.md',
      'refreshing.expected.md', 'image-only.expected.md',
    ])
  })
})
