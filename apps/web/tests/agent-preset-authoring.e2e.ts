/** The preset settings page selects a preset and shows what it declares; creating one starts a Creator-mode task. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/agent-preset-authoring', import.meta.url))
const mode = webSnapshotMode()

describe('web e2e: preset roster guidance', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ profile: { packages: [] } })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openSettings(page, 'zh')
    await page.getByRole('dialog', { name: '\u8bbe\u7f6e' }).getByRole('button', { name: 'Agent \u9884\u8bbe' }).click()
    await page.getByRole('heading', { name: 'Agent \u9884\u8bbe' }).waitFor()
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('shows the shipped roster with mode help and a read-only view, and no editing actions', async () => {
    onTestFailed(() => saveFailureShot(page, 'preset-roster-section'))
    await expect.poll(() => page.locator('[data-agent-preset-id]').count()).toBe(4)
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(EXPECTED, 'section.expected.md'), snapshot, mode)
    expect(snapshot).toContain('\u8ba9 Agent \u5e2e\u6211\u521b\u5efa\u9884\u8bbe\u6a21\u5f0f')
    expect(snapshot).toContain('\u67e5\u770b\u914d\u7f6e: \u6807\u51c6\u6a21\u5f0f')
    expect(snapshot).not.toContain('\u590d\u5236\u9884\u8bbe')
    expect(snapshot).not.toContain('\u7f16\u8f91\u63d2\u4ef6')
    expect(snapshot).not.toContain('\u6253\u5f00\u76ee\u5f55')
    expect(snapshot).not.toContain('\u5220\u9664')
  })

  it('reads mode details and examples without changing the new-task default', async () => {
    onTestFailed(() => saveFailureShot(page, 'preset-roster-guide'))
    const settings = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    const trigger = settings.getByRole('button', { name: '\u6a21\u5f0f\u8bf4\u660e: PTC \u6a21\u5f0f', exact: true })
    await trigger.click()
    const guide = page.getByRole('dialog', { name: 'PTC \u6a21\u5f0f', exact: true })
    await guide.getByRole('heading', { name: '\u600e\u6837\u8c03\u7528\u5de5\u5177', exact: true }).waitFor()
    await guide.getByRole('tab', { name: '\u5982\u4f55\u4f7f\u7528', exact: true }).click()
    await guide.getByRole('heading', { name: '\u6279\u91cf\u68c0\u67e5\u914d\u7f6e\u6587\u4ef6', exact: true }).waitFor()
    await guide.getByRole('tab', { name: '\u5982\u4f55\u4f7f\u7528', exact: true }).press('Escape')
    await guide.waitFor({ state: 'detached' })
    expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await settings.getByRole('button', { name: '\u65b0\u4efb\u52a1\u9ed8\u8ba4: \u6807\u51c6\u6a21\u5f0f', exact: true }).getAttribute('aria-pressed')).toBe('true')
  })

  it('views a shipped composition read-only', async () => {
    onTestFailed(() => saveFailureShot(page, 'preset-roster-view'))
    const settings = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await settings.getByRole('button', { name: '\u67e5\u770b\u914d\u7f6e: PTC \u6a21\u5f0f', exact: true }).click()
    const viewer = page.getByRole('dialog', { name: '\u67e5\u770b\u914d\u7f6e · PTC \u6a21\u5f0f', exact: true })
    await viewer.waitFor({ timeout: 10_000 })
    // The real shipped declaration, not a golden: the viewer shows whatever
    // the deployment ships, and this lane only asserts it is shown read-only
    // in the Loader's own dialect.
    const shown = await viewer.locator('pre').textContent()
    expect(shown).toContain("- id: persona\n  name: '@hackdevcode/dsh-persona'\n")
    expect(shown).toContain('- id: workflow-ptc\n')
    expect(shown).toContain("disabled: !!js process.platform === 'win32'\n")
    expect(shown).not.toContain('__jsExpr')
    expect(await viewer.getByRole('textbox').count()).toBe(0)
    // The header X and the footer button share the \u5173\u95ed name; the footer one is last.
    await viewer.getByRole('button', { name: '\u5173\u95ed', exact: true }).last().click()
    await viewer.waitFor({ state: 'detached', timeout: 10_000 })
    expect(await settings.getByRole('button', { name: '\u65b0\u4efb\u52a1\u9ed8\u8ba4: \u6807\u51c6\u6a21\u5f0f', exact: true }).getAttribute('aria-pressed')).toBe('true')
  })

  it('starts a Creator-mode task from the section entry', async () => {
    onTestFailed(() => saveFailureShot(page, 'preset-roster-creator'))
    // The entry stages the self-referential preset and lands a new task on it,
    // so the flow needs a connected workspace to enter.
    await page.getByRole('dialog', { name: '\u8bbe\u7f6e' }).getByRole('button', { name: '\u5173\u95ed', exact: true }).last().click()
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    await openSettings(page, 'zh')
    const settings = page.getByRole('dialog', { name: '\u8bbe\u7f6e' })
    await settings.getByRole('button', { name: 'Agent \u9884\u8bbe' }).click()
    await settings.getByRole('button', { name: '\u8ba9 Agent \u5e2e\u6211\u521b\u5efa\u9884\u8bbe\u6a21\u5f0f', exact: true }).click()
    await settings.waitFor({ state: 'detached', timeout: 10_000 })
    await expect.poll(async () => {
      const response = await scaffold.hostFetch('/api/session/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request', rpcId: 'creator-draft-stage', method: 'session/list',
          payload: { args: { _request: {} } },
        }),
      })
      const body = await response.json() as {
        result: { value?: { items: { projections?: { values: { agentPreset?: string | null } } }[] } }
      }
      return body.result.value?.items
        .map(item => item.projections?.values.agentPreset)
        .filter(preset => typeof preset === 'string') ?? []
    }, { timeout: 15_000 }).toContain('cordis')
  })

  it('runs without page errors or model calls', () => { expect(tripwire.pageErrors).toEqual([]) })
})
