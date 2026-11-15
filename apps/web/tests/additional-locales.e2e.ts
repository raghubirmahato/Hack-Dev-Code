/** Shipped language selection, metadata and narrow settings through the assembled Web profile. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const languages = [
  ['es', 'es-MX', 'Menú de cuenta', 'Configuración', 'Complementos', 'Idioma', 'Español'],
  ['fr', 'fr-CA', 'Menu du compte', 'Paramètres', 'Plugins', 'Langue', 'Français'],
  ['de', 'de-DE', 'Kontomenü', 'Einstellungen', 'Plugins', 'Sprache', 'Deutsch'],
  ['ru', 'ru-RU', '\u041c\u0435\u043d\u044e \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430', '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438', '\u041f\u043b\u0430\u0433\u0438\u043d\u044b', '\u042f\u0437\u044b\u043a', '\u0420\u0443\u0441\u0441\u043a\u0438\u0439'],
  ['pt', 'pt-BR', 'Menu da conta', 'Configurações', 'Plug-ins', 'Idioma', 'Português'],
] as const

it.each(languages)('selects %s from the browser, localizes metadata and persists an explicit choice', async (id, tag, accountMenu, settings, plugins, language, label) => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
  })
  const scaffold = await launchWebScaffold()
  resources.scaffold = scaffold
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await browser.newPage({ locale: tag, viewport: { width: 1440, height: 960 } })
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, `additional-locale-${id}`))
  await page.goto(scaffold.authenticatedUrl)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(id)
  await page.getByRole('button', { name: plugins, exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  const metadata = JSON.parse(await readFile(new URL(`../../../packages/experimental/auto-review/locale/${id}.json`, import.meta.url), 'utf8')) as { meta: { title: string; description: string } }
  await panel.getByText(metadata.meta.title, { exact: true }).waitFor()
  await panel.getByText(metadata.meta.description, { exact: true }).waitFor()
  await compareOrRefreshGolden(fileURLToPath(new URL(`./expected/additional-locales/${id}.expected.md`, import.meta.url)),
    await captureStableAria(page, `[data-plugin-panel] li:has-text(${JSON.stringify(metadata.meta.title)})`, scaffold.workspaceCwd), webSnapshotMode())
  await page.getByRole('button', { name: accountMenu, exact: true }).click()
  await page.getByRole('menuitem', { name: settings, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: settings, exact: true })
  await dialog.getByText(language, { exact: true }).waitFor()
  await dialog.getByRole('button', { name: label, exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => dialog.evaluate((element) => {
    const content = element.lastElementChild!
    return { panel: element.scrollWidth <= element.clientWidth + 1, content: content.scrollWidth <= content.clientWidth + 1 }
  })).toEqual({ panel: true, content: true })
  await dialog.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  await expect.poll(() => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).toContain(`preference: ${id}`)
  await dialog.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await expect.poll(() => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).toContain('preference: en')
  const warningsBeforeReload = tripwire.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(tripwire, warningsBeforeReload)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en')
  expect(tripwire.warnings).toEqual([])
  expect(tripwire.pageErrors).toEqual([])
})

const forgePreviews = [
  ['de', 'de-DE', 'Plugins', 'Eine Unterhaltung mit verknüpftem GitHub-Pull-Request, Prüfungen, Reviews, Codeunterschieden und einem separaten Arbeitsbaum'],
  ['es', 'es-MX', 'Complementos', 'Una conversación vinculada a un pull request de GitHub, con comprobaciones, revisiones, diferencias de código y un árbol de trabajo aislado'],
  ['fr', 'fr-CA', 'Plugins', 'Une conversation liée à une pull request GitHub, avec vérifications, revues, différences de code et un arbre de travail isolé'],
  ['ja', 'ja-JP', '\u30d7\u30e9\u30b0\u30a4\u30f3', 'GitHub \u306e\u30d7\u30eb\u30ea\u30af\u30a8\u30b9\u30c8\u306b\u95a2\u9023\u4ed8\u3051\u3089\u308c\u305f\u4f1a\u8a71\u3001\u30c1\u30a7\u30c3\u30af\u3068\u30ec\u30d3\u30e5ー\u306e\u72b6\u6cc1\u3001\u30b3ー\u30c9\u306e\u5dee\u5206\u3001\u72ec\u7acb\u3057\u305f\u30efー\u30af\u30c4\u30eaー'],
  ['pt', 'pt-BR', 'Plug-ins', 'Uma conversa vinculada a um pull request do GitHub, com verificações, revisões, diferenças de código e uma árvore de trabalho isolada'],
  ['ru', 'ru-RU', '\u041f\u043b\u0430\u0433\u0438\u043d\u044b', '\u0411\u0435\u0441\u0435\u0434\u0430, \u0441\u0432\u044f\u0437\u0430\u043d\u043d\u0430\u044f \u0441 pull request GitHub: \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438, \u0440\u0435\u0446\u0435\u043d\u0437\u0438\u0438, \u0440\u0430\u0437\u043b\u0438\u0447\u0438\u044f \u0432 \u043a\u043e\u0434\u0435 \u0438 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e\u0435 \u0440\u0430\u0431\u043e\u0447\u0435\u0435 \u0434\u0435\u0440\u0435\u0432\u043e'],
] as const

it.each(forgePreviews)('reads the Forge preview in %s before activation', async (id, tag, plugins, alt) => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
  })
  const scaffold = await launchWebScaffold()
  resources.scaffold = scaffold
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await browser.newPage({ locale: tag, viewport: { width: 1440, height: 960 } })
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, `forge-preview-${id}`))
  await page.goto(scaffold.authenticatedUrl)
  await expect.poll(() => page.locator('html').getAttribute('lang')).toBe(id)
  await page.getByRole('button', { name: plugins, exact: true }).click()
  const card = page.locator('[data-plugin-package="@hackdevcode/dsh-experimental-forge-bundle"]')
  expect(await card.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  await card.getByRole('button').click()
  const image = page.locator('[data-detail-document]').getByRole('img', { name: alt, exact: true })
  await image.waitFor()
  await image.evaluate(async (node: HTMLImageElement) => { await node.decode() })
  expect(await image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([640, 300])
  expect(tripwire.pageErrors).toEqual([])
})
