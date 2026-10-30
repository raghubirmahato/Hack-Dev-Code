/** A non-English browser locale still renders the shipped English UI and English plugin metadata. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

it('uses the shipped English UI and metadata for a non-English browser locale', async () => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
  })
  const scaffold = await launchWebScaffold()
  resources.scaffold = scaffold
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await browser.newPage({ locale: 'ru-RU', viewport: { width: 1440, height: 960 } })
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'english-fallback'))
  await page.goto(scaffold.authenticatedUrl)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en')
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const panel = page.locator('[data-plugin-panel]')
  const metadata = JSON.parse(await readFile(
    new URL('../../../packages/experimental/auto-review/locale/en.json', import.meta.url), 'utf8',
  )) as { meta: { title: string; description: string } }
  await panel.getByText(metadata.meta.title, { exact: true }).waitFor()
  await panel.getByText(metadata.meta.description, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByText('Language', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'English', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => dialog.evaluate((element) => {
    const content = element.lastElementChild!
    return { panel: element.scrollWidth <= element.clientWidth + 1, content: content.scrollWidth <= content.clientWidth + 1 }
  })).toEqual({ panel: true, content: true })
  await dialog.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await expect.poll(async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
    .toContain('preference: en')
  const warningsBeforeReload = tripwire.warnings.length
  await page.reload()
  acknowledgeReloadConnectionLoss(tripwire, warningsBeforeReload)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en')
  expect(tripwire.warnings).toEqual([])
  expect(tripwire.pageErrors).toEqual([])
})
