// A real Host/Remote/browser composition with a controllable package-manager process:
// pnpm fails without printing anything, and the dialog still shows what failed and where
// the complete log lives instead of a generic sentence over an empty details panel.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, captureStableAria, compareOrRefreshGolden, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

it('reports a failed install whose pnpm printed nothing with its command line, output, and log file', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-install-silent-'))
  const overlay = join(scratch, 'cordis.patch.yml')
  await writeFile(overlay, `- id: plugin-manager\n  config: ${JSON.stringify({ pnpmCommand: process.execPath })}\n`)
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold({ profile: { packages: [] }, extraOverlayPath: overlay })
    const browser = await chromium.launch()
    try {
      const profile = join(scaffold.harnessHome, 'profiles', 'scaffold')
      // Node stands in for pnpm: `view` answers the check, and `add` exits unsuccessfully without printing
      // anything, the way a silent or early-crashing package manager leaves a failed run with no terminal output.
      await writeFile(join(profile, 'view'), 'console.log(JSON.stringify({ name: "silent-package", version: "1.0.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } }))\n')
      await writeFile(join(profile, 'add'), 'process.exitCode = 1\n')
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await page.waitForSelector('[class*="frame"]')
      if (await page.getByRole('dialog', { name: '\u8bbe\u7f6e' }).count() > 0) await page.keyboard.press('Escape')
      await page.getByRole('navigation', { name: '\u5168\u5c40\u9762\u677f' }).getByRole('button', { name: '\u63d2\u4ef6', exact: true }).click()
      await page.getByRole('button', { name: '\u6dfb\u52a0\u63d2\u4ef6', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').fill('silent-package')
      await dialog.getByRole('button', { name: '\u5b89\u88c5', exact: true }).click()
      const failure = page.getByRole('dialog', { name: '\u63d2\u4ef6\u5b89\u88c5\u5931\u8d25', exact: true })
      await failure.waitFor({ timeout: 20_000 })
      // The sentence names the failed stage; the details carry the Host's own record of the run.
      await failure.getByText('\u5b89\u88c5\u547d\u4ee4\u5931\u8d25\uff0c\u539f\u56e0\u89c1\u5b89\u88c5\u8be6\u60c5', { exact: true }).waitFor()
      await failure.getByRole('button', { name: '\u67e5\u770b\u5b89\u88c5\u8be6\u60c5', exact: true }).click()
      await failure.getByText('pnpm add silent-package', { exact: true }).waitFor()
      await failure.getByText(/Command failed with exit code 1:/).waitFor()
      expect(await failure.getByText(/^\u5b8c\u6574\u65e5\u5fd7\uff1a.*pnpm\.log$/).count()).toBe(1)
      expect(await readFile(join(profile, 'package.json'), 'utf8')).not.toContain('silent-package')
      const snapshot = (await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd))
        .split(process.execPath).join('{{node}}')
        .split(scaffold.harnessHome).join('{{harnessHome}}')
        .replace(/operation-[A-Za-z0-9]+/g, 'operation-{{suffix}}')
      await compareOrRefreshGolden(
        fileURLToPath(new URL('./expected/plugin-install-silent-failure/failed.expected.md', import.meta.url)), snapshot, webSnapshotMode(),
      )
      expect(tripwire.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally {
    await scaffold?.close()
    await rm(scratch, { recursive: true, force: true })
  }
})
