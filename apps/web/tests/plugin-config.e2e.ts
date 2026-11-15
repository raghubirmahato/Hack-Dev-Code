// Web e2e scenario: the configuration pages on the Plugins page — the official
// pages a deployment's exposed host-plane namespaces produce, one field edited
// through the real wire down to `$DSH_HOME/cordis.patch.yml`, the override badge
// and reset that layering produces, and a community bundle's row configuration
// registered by its own browser half. Zero model calls: everything is client
// state plus the settings document and the profile on a blank frame, so there
// is no fixture and a stray stream would fail loud on the open llm seam.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { HIDDEN_BUNDLES } from '@hackdevcode/dsh-official-bundles'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { join } from 'node:path'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/plugin-config', import.meta.url))
const OFFICIAL_EXPECTED = join(SNAPSHOT_DIR, 'official.expected.md')
const ROW_EXPECTED = join(SNAPSHOT_DIR, 'row.expected.md')
const BUNDLE_EXPECTED = join(SNAPSHOT_DIR, 'bundle.expected.md')
const FIXTURE_PLUGINS = fileURLToPath(new URL('./fixtures/plugins', import.meta.url))
const MODE = webSnapshotMode()
const UNUSED_KEY_ENV = 'DSH_PLUGIN_CONFIG_E2E_UNUSED_KEY'

describe('web e2e: plugin configuration pages', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    // The live-client fixture is a bundle with a browser half; switched on
    // below, that half registers its row's configuration into the page.
    // Legacy Messages search names an unset credential so the goldens show the
    // unconfigured key whatever keys the host environment carries.
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
      deepSeekSearch: { apiKeyEnv: UNUSED_KEY_ENV },
      profile: { packages: [{ dir: join(FIXTURE_PLUGINS, 'fixture-live-client') }] },
    })
    browser = await chromium.launch()
    // Chinese browser: the pages assert the localized copy the client derives
    // from it, as the rest of the settings surface does.
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Show the Plugins page's cards. The scenarios share one page so the
   * settings document accumulates across them, so this closes any settings
   * dialog a previous scenario left open and leaves whatever page it opened.
   */
  async function openPlugins(): Promise<Locator> {
    if (await page.getByRole('dialog', { name: '\u8bbe\u7f6e' }).count() > 0) {
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('dialog', { name: '\u8bbe\u7f6e' }).count(), { timeout: 5_000 }).toBe(0)
    }
    await page.getByRole('navigation', { name: '\u5168\u5c40\u9762\u677f' }).getByRole('button', { name: '\u63d2\u4ef6', exact: true }).click()
    const panel = page.locator('[data-plugin-panel]')
    await panel.waitFor({ timeout: 10_000 })
    while (await panel.getByRole('button', { name: /^\u8fd4\u56de/ }).count() > 0) {
      await panel.getByRole('button', { name: /^\u8fd4\u56de/ }).first().click()
    }
    await panel.getByRole('heading', { name: '\u5185\u7f6e\u63d2\u4ef6\u914d\u7f6e', exact: true }).waitFor({ timeout: 20_000 })
    return panel
  }

  /** Open one official plugin's page from its card and wait for its form. */
  async function openPage(panel: Locator, title: string): Promise<void> {
    await panel.getByRole('button', { name: `\u67e5\u770b ${title}`, exact: true }).click()
    await panel.locator('[data-plugin-config]').waitFor({ timeout: 10_000 })
  }

  /** The settings document as the Host has written it so far. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8').catch(() => '')
  }

  it('keeps configuration pages first and opens the full experimental plugin list separately', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-config-cards'))
    const panel = await openPlugins()

    // Every page the shipped web composition exposes: the shell executor, the
    // agent loop, subagent selection, and the DeepSeek search provider.
    await panel.getByRole('button', { name: '\u67e5\u770b \u7f51\u9875\u641c\u7d22\u4e0e\u83b7\u53d6', exact: true }).waitFor({ timeout: 20_000 })
    const basic = panel.locator('[data-plugin-group="basic"]')
    expect(await basic.locator('[data-plugin-item]').count()).toBe(4)
    expect(await basic.locator(':scope > ul > li').evaluateAll(cards => cards.map(card => card.getAttribute('data-plugin-item'))))
      .toEqual(['subagent', 'web-search', 'agent-loop', 'shell'])
    for (const title of ['\u5b50\u667a\u80fd\u4f53', '\u7f51\u9875\u641c\u7d22\u4e0e\u83b7\u53d6', 'Agent \u5faa\u73af', '\u7ec8\u7aef']) {
      expect(await basic.getByRole('button', { name: `\u67e5\u770b ${title}`, exact: true }).count()).toBe(1)
    }
    // A card carries the one-liner; the fields wait for the page.
    expect(await basic.getByText('\u9650\u5236\u6bcf\u6761\u547d\u4ee4\u6700\u591a\u80fd\u8dd1\u591a\u4e45\u3001\u6700\u591a\u8f93\u51fa\u591a\u5c11\u5185\u5bb9\u3002', { exact: true }).count()).toBe(1)
    expect(await panel.getByLabel('\u547d\u4ee4\u8d85\u65f6\uff08\u6beb\u79d2\uff09').count()).toBe(0)

    const extensions = panel.locator('[data-plugin-group="extensions"]')
    const more = panel.getByRole('button', { name: '\u66f4\u591a', exact: true })
    expect(await extensions.getByRole('heading', { name: '\u5b9e\u9a8c\u6027\u63d2\u4ef6', exact: true }).count()).toBe(1)
    expect(await extensions.getByRole('button', { name: '\u66f4\u591a', exact: true }).textContent()).toBe('\u66f4\u591a')
    expect(await extensions.getByRole('list').isVisible()).toBe(true)
    expect(await panel.locator('[data-plugin-group="more"]').count()).toBe(0)
    await more.focus()
    await page.keyboard.press('Enter')
    await panel.getByRole('heading', { name: '\u5b9e\u9a8c\u6027\u63d2\u4ef6', exact: true, level: 1 }).waitFor()
    // The More list omits the shipped bundles whose own rows do not run (the visibility rule lives in
    // ui-plugin-manager), so it holds fewer cards than the installed optional-bundle list.
    const bundles = await scaffold.ctx.pluginManager.listBundles()
    expect(await panel.locator('[data-plugin-group="more"] [data-plugin-package]').count())
      .toBe(bundles.filter(bundle => !HIDDEN_BUNDLES.has(bundle.name)
        && bundle.name !== '@hackdevcode/dsh-experimental-liveshare'
        && bundle.official && (bundle.listedByDefault !== false || bundle.enabled || bundle.installed)).length)
    expect(await basic.count()).toBe(0)
    expect(await extensions.count()).toBe(0)
    expect(await panel.locator('[data-plugin-group="bundles"]').count()).toBe(0)
    await panel.getByRole('button', { name: '\u67e5\u770b \u5f00\u53d1\u8005\u5de5\u5177', exact: true }).click()
    await panel.locator('[data-plugin-detail]').waitFor()
    await panel.getByRole('button', { name: '\u8fd4\u56de \u5b9e\u9a8c\u6027\u63d2\u4ef6', exact: true }).click()
    await panel.getByRole('heading', { name: '\u5b9e\u9a8c\u6027\u63d2\u4ef6', exact: true, level: 1 }).waitFor()
    await panel.getByRole('button', { name: '\u8fd4\u56de\u63d2\u4ef6', exact: true }).focus()
    await page.keyboard.press('Space')
    expect(await extensions.getByRole('list').isVisible()).toBe(true)
    expect(await panel.locator('[data-plugin-group="more"]').count()).toBe(0)
    await more.click()
    await page.reload({ waitUntil: 'load' })
    await openPlugins()
    expect(await extensions.getByRole('list').isVisible()).toBe(true)
    expect(await panel.locator('[data-plugin-group="more"]').count()).toBe(0)

    const snapshot = await captureStableAria(page, '[data-plugin-panel]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(OFFICIAL_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('selects search and fetch providers independently and keeps each provider’s settings', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-search-api-settings'))
    const panel = await openPlugins()
    await openPage(panel, '\u7f51\u9875\u641c\u7d22\u4e0e\u83b7\u53d6')
    // A menu's accessible name is its label followed by the selected entry, so the menus are found by id.
    const searchMenu = panel.locator('#plugin-config-web-search-provider')
    const fetchMenu = panel.locator('#plugin-config-web-fetch-provider')
    const searchSection = panel.getByRole('region', { name: '\u7f51\u9875\u641c\u7d22\u63d0\u4f9b\u65b9', exact: true })
    const fetchSection = panel.getByRole('region', { name: '\u7f51\u9875\u83b7\u53d6\u63d0\u4f9b\u65b9', exact: true })
    const count = panel.getByLabel('\u6bcf\u6b21\u641c\u7d22\u7ed3\u679c\u6570', { exact: true })
    const save = panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true })
    /** Pick one entry from a menu. */
    async function choose(menu: Locator, label: string): Promise<void> {
      await menu.click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    }
    /** Open a menu and read its entries in order, then close it. */
    async function entries(menu: Locator): Promise<string[]> {
      await menu.click()
      const items = await page.getByRole('menuitem').allTextContents()
      await page.keyboard.press('Escape')
      await expect.poll(() => page.getByRole('menuitem').count()).toBe(0)
      return items
    }
    // The shipped composition selects the DeepSeek Search API and local fetch, and the page writes nothing on mount.
    expect(await searchMenu.textContent()).toBe('DeepSeek Search API')
    expect(await fetchMenu.textContent()).toBe('\u672c\u673a\u76f4\u63a5\u83b7\u53d6')
    expect(await panel.getByRole('button', { name: '\u7f51\u9875\u641c\u7d22\u63d0\u4f9b\u65b9 DeepSeek Search API', exact: true }).count()).toBe(1)
    expect(await panel.getByRole('button', { name: '\u7f51\u9875\u83b7\u53d6\u63d0\u4f9b\u65b9 \u672c\u673a\u76f4\u63a5\u83b7\u53d6', exact: true }).count()).toBe(1)
    expect(await entries(searchMenu)).toEqual(['DeepSeek Search API', 'DeepSeek\uff08\u65e7\u7248\uff09'])
    expect(await entries(fetchMenu)).toEqual(['\u672c\u673a\u76f4\u63a5\u83b7\u53d6', 'DeepSeek Fetch API'])
    expect(await settingsDocument()).not.toContain('searchProvider:')
    // The page fixes the menu order itself; the Loader imports plugins concurrently, so the
    // Host's registration order is not the YAML row order and only its membership is checked here.
    const hostWeb = scaffold.ctx.get('web') as { listProviders(): Record<'search' | 'fetch', { id: string }[]> } | undefined
    expect(hostWeb?.listProviders().search.map(provider => provider.id).sort()).toEqual(['deepseek-official', 'deepseek-search-api'])
    expect(await panel.getByRole('link', { name: '\u7f51\u9875\u641c\u7d22\u4e0e\u83b7\u53d6\u6307\u5357', exact: true }).getAttribute('href'))
      .toBe('https://api-docs.deepseek.com/zh-cn/guides/search')
    // Each section shows the description its selected provider registered with the Host, in the active language.
    expect(await searchSection.getByText('\u4f1a\u4ea7\u751f\u8d39\u7528\uff0c\u7531\u300c\u8ba1\u8d39\u65b9\u5f0f\u300d\u9009\u5b9a\u7684\u8d26\u53f7\u6216 API Key \u652f\u4ed8\u3002', { exact: true }).count()).toBe(1)
    expect(await fetchSection.getByText('\u514d\u8d39\uff0c\u53ef\u8bbf\u95ee\u5185\u7f51\u548c\u672c\u673a\u3002\u4e0d\u652f\u6301\u9700\u8981 JavaScript \u6216\u767b\u5f55\u7684\u9875\u9762\uff0c\u4e5f\u4e0d\u652f\u6301 PDF\u3002', { exact: true }).count()).toBe(1)
    // The Fetch API suggestion is text, not an action.
    expect(await fetchSection.getByRole('button').count()).toBe(1)
    expect(await save.isDisabled()).toBe(true)

    // The Search panel holds the result count and the billing menu, automatic by default.
    expect(await searchSection.getByRole('textbox').count()).toBe(1)
    expect(await panel.locator('#plugin-config-web-search-billing').textContent()).toBe('\u81ea\u52a8')
    expect(await count.inputValue()).toBe('10')
    await count.fill('51')
    await panel.getByText('\u8bf7\u586b 1–50 \u7684\u6574\u6570\uff1b\u7559\u7a7a\u8868\u793a\u4f7f\u7528\u9ed8\u8ba4\u503c\u3002', { exact: true }).waitFor()
    expect(await save.isDisabled()).toBe(true)
    for (const menu of [searchMenu, fetchMenu]) expect(await menu.isDisabled()).toBe(true)
    await count.fill('10')
    expect(await save.isDisabled()).toBe(true)

    // The Fetch API shows only its billing menu, and the page saves the billing with the selection.
    await choose(fetchMenu, 'DeepSeek Fetch API')
    expect(await fetchSection.getByText('\u65e0\u6cd5\u8bbf\u95ee\u5185\u7f51\u548c\u672c\u673a\u3002\u4f1a\u4ea7\u751f\u8d39\u7528\uff0c\u7531\u300c\u8ba1\u8d39\u65b9\u5f0f\u300d\u9009\u5b9a\u7684\u8d26\u53f7\u6216 API Key \u652f\u4ed8\u3002', { exact: true }).count()).toBe(1)
    expect(await fetchSection.getByRole('textbox').count()).toBe(0)
    expect(await fetchSection.getByRole('button').count()).toBe(2)
    const fetchBilling = panel.locator('#plugin-config-web-fetch-billing')
    await choose(fetchBilling, 'DeepSeek API Key')
    await fetchSection.getByText('\u4f7f\u7528\u300c\u6a21\u578b\u300d\u9875\u914d\u7f6e\u7684 API Key\uff0c\u9700\u8981\u5148\u914d\u7f6e\u3002', { exact: true }).waitFor()
    await save.click()
    await expect.poll(() => save.isDisabled()).toBe(true)
    await expect.poll(settingsDocument).toContain('fetchProvider: deepseek-fetch-api')
    await expect.poll(settingsDocument).toContain('fetchBilling: api-key')
    await choose(fetchBilling, '\u81ea\u52a8')
    await save.click()
    await expect.poll(() => save.isDisabled()).toBe(true)
    await expect.poll(settingsDocument).not.toContain('fetchBilling:')

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openPlugins()
    await openPage(panel, '\u7f51\u9875\u641c\u7d22\u4e0e\u83b7\u53d6')
    expect(await searchMenu.textContent()).toBe('DeepSeek Search API')
    expect(await fetchMenu.textContent()).toBe('DeepSeek Fetch API')
    const snapshot = await captureStableAria(page, '[data-plugin-panel]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'web-search.expected.md'), snapshot, MODE)

    await choose(fetchMenu, '\u672c\u673a\u76f4\u63a5\u83b7\u53d6')
    await save.click()
    await expect.poll(() => save.isDisabled()).toBe(true)
    await expect.poll(settingsDocument).not.toContain('fetchProvider: deepseek-fetch-api')

    await choose(searchMenu, 'DeepSeek\uff08\u65e7\u7248\uff09')
    const messagesEndpoint = panel.locator('#plugin-config-web-search-endpoint')
    expect(await panel.getByLabel('\u5355\u6b21\u8bf7\u6c42\u6700\u591a\u641c\u7d22\u6b21\u6570', { exact: true }).inputValue()).toBe('5')
    await messagesEndpoint.fill('https://messages.test/anthropic/v1')
    await save.click()
    await expect.poll(() => save.isDisabled()).toBe(true)
    await expect.poll(settingsDocument).toContain('searchProvider: deepseek-official')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openPlugins()
    await openPage(panel, '\u7f51\u9875\u641c\u7d22\u4e0e\u83b7\u53d6')
    expect(await searchMenu.textContent()).toBe('DeepSeek\uff08\u65e7\u7248\uff09')
    expect(await messagesEndpoint.inputValue()).toBe('https://messages.test/anthropic/v1')
    expect(await entries(searchMenu)).toEqual(['DeepSeek Search API', 'DeepSeek\uff08\u65e7\u7248\uff09'])
    expect(await save.isDisabled()).toBe(true)
    expect(await settingsDocument()).toContain('searchProvider: deepseek-official')
    await choose(searchMenu, 'DeepSeek Search API')
    await count.fill('20')
    await save.click()
    await expect.poll(() => save.isDisabled()).toBe(true)
    await expect.poll(settingsDocument).not.toContain('searchProvider:')
    expect(await settingsDocument()).toContain('count: 20')
    expect(await settingsDocument()).not.toMatch(/ApiKeyEnv:|searchBaseURL:|fetchBaseURL:/)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('saves subagent limits and resets them to the deployment defaults', async () => {
    const panel = await openPlugins()
    await openPage(panel, '\u5b50\u667a\u80fd\u4f53')
    const depth = panel.getByLabel('\u6700\u5927\u9012\u5f52\u6df1\u5ea6', { exact: true })
    const capacity = panel.getByLabel('\u5b50\u667a\u80fd\u4f53\u5e76\u884c\u6570\u91cf\u4e0a\u9650', { exact: true })
    expect(await depth.inputValue()).toBe('1')
    expect(await capacity.inputValue()).toBe('8')
    await depth.fill('2')
    await capacity.fill('12')
    await panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    await expect.poll(() => panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).isDisabled()).toBe(true)
    await expect.poll(settingsDocument).toContain('maxActiveSubagents: 12')
    await expect.poll(settingsDocument).toContain('maxDepth: 2')
    await openPlugins()
    await openPage(panel, '\u5b50\u667a\u80fd\u4f53')
    const snapshot = await captureStableAria(page, '[data-plugin-panel]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'subagent.expected.md'), snapshot, MODE)
    const controlHeight = await depth.evaluate(element => element.getBoundingClientRect().height)
    await depth.fill('1.5')
    expect(await depth.evaluate(element => element.getBoundingClientRect().height)).toBe(controlHeight)
    expect(await panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).isDisabled()).toBe(true)
    await depth.fill('2')
    await panel.getByRole('button', { name: '\u6062\u590d\u9ed8\u8ba4', exact: true }).first().click()
    await panel.getByRole('button', { name: '\u6062\u590d\u9ed8\u8ba4', exact: true }).first().click()
    await panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()
    await expect.poll(() => panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).isDisabled()).toBe(true)
    await openPlugins()
    await openPage(panel, '\u5b50\u667a\u80fd\u4f53')
    expect(await depth.inputValue()).toBe('1')
    expect(await capacity.inputValue()).toBe('8')
    await panel.getByRole('button', { name: '\u8fd4\u56de\u63d2\u4ef6', exact: true }).click()
  })

  it('opens field explanations with the keyboard and retains unsaved edits', async () => {
    const panel = await openPlugins()
    await openPage(panel, '\u5b50\u667a\u80fd\u4f53')
    const depth = panel.getByLabel('\u6700\u5927\u9012\u5f52\u6df1\u5ea6', { exact: true })
    await depth.fill('2')
    const depthHelp = panel.getByRole('button', { name: '\u6700\u5927\u9012\u5f52\u6df1\u5ea6\u8bf4\u660e', exact: true })
    expect(await panel.getByRole('region', { name: '\u6700\u5927\u9012\u5f52\u6df1\u5ea6\u8bf4\u660e', exact: true }).count()).toBe(0)
    await depthHelp.press('Enter')
    const depthRules = panel.getByRole('region', { name: '\u6700\u5927\u9012\u5f52\u6df1\u5ea6\u8bf4\u660e', exact: true })
    await depthRules.waitFor()
    expect(await depthRules.getByText('\u9650\u5236 Agent \u521b\u5efa\u5b50\u667a\u80fd\u4f53\u7684\u9012\u5f52\u5c42\u7ea7\u3002', { exact: true }).count()).toBe(1)
    const depthTable = depthRules.getByRole('table', { name: '\u6700\u5927\u9012\u5f52\u6df1\u5ea6\u8bf4\u660e', exact: true })
    expect(await depthTable.getByRole('row', { name: '0 \u7981\u7528\u5b50\u667a\u80fd\u4f53', exact: true }).count()).toBe(1)
    expect(await depthTable.getByRole('row', { name: '1 \u4ec5\u5141\u8bb8\u4e3b Agent \u521b\u5efa\u5b50\u667a\u80fd\u4f53', exact: true }).count()).toBe(1)
    expect(await depthRules.getByText('\u5982\u679c\u67d0\u4e2a\u5de5\u5177\u5355\u72ec\u8bbe\u7f6e\u4e86\u6700\u5927\u9012\u5f52\u6df1\u5ea6\uff0c\u4ee5\u8be5\u5de5\u5177\u7684\u8bbe\u7f6e\u4e3a\u51c6\u3002', { exact: true }).count()).toBe(1)
    await depthHelp.press('Enter')
    expect(await depthRules.count()).toBe(0)
    expect(await depth.inputValue()).toBe('2')
    await panel.getByRole('button', { name: '\u5b50\u667a\u80fd\u4f53\u5e76\u884c\u6570\u91cf\u4e0a\u9650\u8bf4\u660e', exact: true }).click()
    const capacityRules = panel.getByRole('region', { name: '\u5b50\u667a\u80fd\u4f53\u5e76\u884c\u6570\u91cf\u4e0a\u9650\u8bf4\u660e', exact: true })
    expect(await capacityRules.getByText('\u540c\u4e00\u4e3b Agent \u4e0b\uff0c\u6240\u6709\u9012\u5f52\u5c42\u7ea7\u540c\u65f6\u5b58\u6d3b\u7684\u5b50\u667a\u80fd\u4f53\u603b\u6570\uff0c\u4e3b Agent \u4e0d\u8ba1\u5165\u3002\u8fbe\u5230\u4e0a\u9650\u65f6\uff0c\u65b0\u7684\u542f\u52a8\u8bf7\u6c42\u4f1a\u88ab\u62d2\u7edd\u3002', { exact: true }).count()).toBe(1)
    await panel.getByRole('button', { name: '\u8fd4\u56de\u63d2\u4ef6', exact: true }).click()
    await openPage(panel, '\u5b50\u667a\u80fd\u4f53')
    expect(await depth.inputValue()).toBe('1')
  })

  it('saves limits and the model allowlist together from the shared card', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-config-subagent-model-selection'))
    const panel = await openPlugins()
    await openPage(panel, '\u5b50\u667a\u80fd\u4f53')
    const toggle = panel.getByRole('switch', { name: '\u5141\u8bb8 Agent \u4e3a\u5b50\u667a\u80fd\u4f53\u9009\u62e9\u6a21\u578b' })

    await panel.getByLabel('\u6700\u5927\u9012\u5f52\u6df1\u5ea6', { exact: true }).fill('2')
    await toggle.click()
    const models = panel.getByRole('group', { name: 'Agent \u53ef\u9009\u62e9\u7684\u6a21\u578b' })
    await models.waitFor({ timeout: 10_000 })
    const firstModel = models.getByRole('checkbox').first()
    await firstModel.check()
    const save = panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true })
    await save.click()

    // The Save label returns only after both namespace controllers settle.
    await expect.poll(() => save.isDisabled(), { timeout: 10_000 }).toBe(true)
    const saved = await settingsDocument()
    expect(saved).toContain('id: subagent-model-selection-settings')
    expect(saved).toContain('maxDepth: 2')
    expect(saved).toContain('enabled: true')
    expect(saved).toContain('allowedModels:')
    expect(saved).toContain('provider:')
    expect(saved).toContain('model:')
    await expect.poll(() => toggle.getAttribute('aria-checked'), { timeout: 5_000 }).toBe('true')

    await toggle.click()
    await save.click()
    await expect.poll(async () => (await settingsDocument()).includes('enabled: false'), { timeout: 10_000 })
      .toBe(true)
    await expect.poll(() => toggle.getAttribute('aria-checked'), { timeout: 5_000 }).toBe('false')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('stages an edit and writes it only when saved', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-config-write'))
    const panel = await openPlugins()
    await openPage(panel, '\u7ec8\u7aef')
    const entry = [...scaffold.ctx.loader.entries()].find(row => row.options.id === 'bash-sandbox')!
    const fiber = entry.fiber

    const timeout = panel.getByLabel('\u547d\u4ee4\u8d85\u65f6\uff08\u6beb\u79d2\uff09')
    await timeout.waitFor({ timeout: 10_000 })
    // The composed default this deployment ships, before any user layer.
    expect(await timeout.inputValue()).toBe('60000')
    await timeout.fill('12000')
    await timeout.blur()

    // Nothing crosses the wire until the user saves: leaving the control is
    // not a decision to store the value.
    expect(await settingsDocument()).not.toContain('timeoutMs')
    const save = panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true })
    await expect.poll(() => save.isEnabled(), { timeout: 5_000 }).toBe(true)
    await save.click()

    await expect.poll(async () => (await settingsDocument()).includes('timeoutMs: 12000'), { timeout: 10_000 })
      .toBe(true)
    expect(scaffold.ctx.shell.resolve({ command: 'true' }).timeoutMs).toBe(12000)
    expect(entry.fiber === fiber).toBe(true)
    // Presence in the user layer is what the badge reports, and the reset is
    // offered only for a field that has one.
    await expect.poll(() => panel.getByText('\u5df2\u8986\u76d6').count(), { timeout: 5_000 }).toBe(1)
    expect(await panel.getByRole('button', { name: '\u6062\u590d\u9ed8\u8ba4' }).count()).toBe(1)
    // A settled form offers no save to repeat.
    await expect.poll(() => save.isDisabled(), { timeout: 5_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('drops a staged edit when the page is left, without touching the document', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-config-leave'))
    const panel = await openPlugins()
    await openPage(panel, '\u7ec8\u7aef')
    const timeout = panel.getByLabel('\u547d\u4ee4\u8d85\u65f6\uff08\u6beb\u79d2\uff09')
    await timeout.waitFor({ timeout: 10_000 })

    await timeout.fill('7000')
    await panel.getByRole('button', { name: '\u8fd4\u56de\u63d2\u4ef6' }).click()
    await panel.getByRole('heading', { name: '\u5185\u7f6e\u63d2\u4ef6\u914d\u7f6e', exact: true }).waitFor({ timeout: 10_000 })
    await openPage(panel, '\u7ec8\u7aef')

    await expect.poll(() => panel.getByLabel('\u547d\u4ee4\u8d85\u65f6\uff08\u6beb\u79d2\uff09').inputValue(), { timeout: 5_000 }).toBe('12000')
    expect(await settingsDocument()).toContain('timeoutMs: 12000')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('refuses to save a draft that is not a number', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-config-invalid'))
    const panel = await openPlugins()
    await openPage(panel, '\u7ec8\u7aef')
    const timeout = panel.getByLabel('\u547d\u4ee4\u8d85\u65f6\uff08\u6beb\u79d2\uff09')
    await timeout.waitFor({ timeout: 10_000 })

    await timeout.fill('soon')

    const save = panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true })
    await expect.poll(() => save.isDisabled(), { timeout: 5_000 }).toBe(true)
    expect(await panel.getByText('\u8bf7\u586b\u6570\u5b57\uff1b\u7559\u7a7a\u8868\u793a\u4f7f\u7528\u9ed8\u8ba4\u503c\u3002').count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('clears the field back to the composed default on reset', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-config-reset'))
    const panel = await openPlugins()
    await openPage(panel, '\u7ec8\u7aef')
    const timeout = panel.getByLabel('\u547d\u4ee4\u8d85\u65f6\uff08\u6beb\u79d2\uff09')
    await timeout.waitFor({ timeout: 10_000 })
    expect(await timeout.inputValue()).toBe('12000')

    // The reset stages the composed default; the document still carries the
    // override until the save lands.
    await panel.getByRole('button', { name: '\u6062\u590d\u9ed8\u8ba4' }).click()
    await expect.poll(() => timeout.inputValue(), { timeout: 5_000 }).toBe('60000')
    expect(await settingsDocument()).toContain('timeoutMs: 12000')

    await panel.getByRole('button', { name: '\u4fdd\u5b58', exact: true }).click()

    await expect.poll(async () => (await settingsDocument()).includes('timeoutMs'), { timeout: 10_000 })
      .toBe(false)
    expect(await timeout.inputValue()).toBe('60000')
    expect(await panel.getByText('\u5df2\u8986\u76d6').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('renders a community bundle\'s row configuration, registered by its browser half, on the row\'s page', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plugin-config-row'))
    const panel = await openPlugins()

    // Off, the bundle's browser half is not loaded and the row has no configuration to open.
    await panel.getByRole('button', { name: '\u67e5\u770b @fixture/live-client', exact: true }).click()
    const row = panel.locator('[data-plugin-row]', { hasText: 'fixture-live-client' })
    await row.waitFor({ timeout: 10_000 })
    expect(await panel.getByRole('button', { name: '\u914d\u7f6e @fixture/live-client' }).count()).toBe(0)

    // Off, the bundle's page carries no contribution either: the browser half
    // that would make them is not loaded.
    const bundlePage = panel.locator('[data-plugin-detail="@fixture/live-client"]')
    expect(await bundlePage.locator('[data-live-action]').count()).toBe(0)

    // Switched on, the Host recomposes and the browser half mounts without a
    // reload; its registration puts the configure control on the row, and
    // its detail contributions on the bundle's page: the action before the
    // page's own switch, the badge beside the title, the section after the rows.
    await panel.getByRole('switch', { name: '\u542f\u7528 @fixture/live-client' }).click()
    const configure = panel.getByRole('button', { name: '\u914d\u7f6e @fixture/live-client' })
    await configure.waitFor({ timeout: 30_000 })
    await bundlePage.locator('[data-live-section="bundle"]').waitFor({ timeout: 10_000 })
    // The page's own view of the row follows the Host's change event, which
    // can land after the browser half mounted; the golden holds the settled page.
    await row.getByText('\u8fd0\u884c\u4e2d', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await bundlePage.getByRole('button', { name: '\u5939\u5177\u64cd\u4f5c' }).count()).toBe(1)
    expect(await bundlePage.locator('[data-live-badge="bundle"]').textContent()).toBe('\u5939\u5177\u6807\u7b7e')
    expect(await bundlePage.getByRole('region', { name: '\u5939\u5177\u533a\u5757' }).getByText('\u6765\u81ea\u5939\u5177\u7684\u533a\u5757\u5185\u5bb9').count()).toBe(1)
    const bundleSnapshot = await captureStableAria(page, '[data-plugin-panel]', scaffold.workspaceCwd, {
      replacements: [[FIXTURE_PLUGINS, '{{fixtures}}']],
    })
    await compareOrRefreshGolden(BUNDLE_EXPECTED, bundleSnapshot, MODE)
    await configure.click()

    const rowPage = panel.locator('[data-plugin-row-detail="@fixture/live-client#fixture-live-client"]')
    await rowPage.waitFor({ timeout: 10_000 })
    expect(await rowPage.getByRole('heading', { level: 3 }).textContent()).toBe('@fixture/live-client')
    expect(await rowPage.getByText('\u793a\u4f8b\u914d\u7f6e\u9879', { exact: true }).count()).toBe(1)
    // The same entries render for the row's page, told it is about the row.
    expect(await rowPage.locator('[data-live-action="row"]').count()).toBe(1)
    expect(await rowPage.locator('[data-live-badge="row"]').count()).toBe(1)
    expect(await rowPage.locator('[data-live-section="row"]').count()).toBe(1)
    const form = rowPage.getByRole('form', { name: '\u52a8\u6001\u63d2\u4ef6\u914d\u7f6e' })
    await form.getByLabel('\u95ee\u5019\u8bed').fill('\u4f60\u597d')
    await form.getByRole('button', { name: '\u4fdd\u5b58' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.liveSaves), { timeout: 5_000 }).toBe('1')

    const snapshot = await captureStableAria(page, '[data-plugin-panel]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ROW_EXPECTED, snapshot, MODE)
    await rowPage.getByRole('button', { name: '\u8fd4\u56de @fixture/live-client' }).click()
    await bundlePage.waitFor({ timeout: 10_000 })

    // An official plugin's page is another subject; the fixture's entries render nothing for it.
    await panel.getByRole('button', { name: '\u8fd4\u56de\u63d2\u4ef6' }).click()
    await openPage(panel, '\u7ec8\u7aef')
    const itemPage = panel.locator('[data-plugin-item-detail]')
    expect(await itemPage.locator('[data-live-action], [data-live-badge], [data-live-section]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['bundle.expected.md', 'official.expected.md', 'row.expected.md', 'subagent.expected.md', 'web-search.expected.md'])
  })


})
