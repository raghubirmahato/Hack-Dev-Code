// Real Git reaches a controlled proxy failure or stall; the browser
// offers a mirror for a replacement spec, or another way once the install
// already asks the mirror, without retrying the failed address. Without a
// configured fallback registry the same failure keeps the plain failed
// screen, whose details name the check's own Git run and complete log.
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, captureStableAria, compareOrRefreshGolden, webSnapshotMode, watchConsole } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

it.each(['network', 'timeout'] as const)('offers a mirror after a GitHub %s, then another way on the mirror, and waits for replacement input', async (failure) => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-install-github-'))
  onTestFinished(() => rm(scratch, { recursive: true, force: true }))
  const sockets = new Set<Socket>()
  let connections = 0
  const proxy = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { sockets.delete(socket) })
    socket.once('data', () => { connections++; if (failure === 'network') socket.destroy() })
  })
  onTestFinished(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => { proxy.close((error) => { if (error) reject(error); else resolve() }) })
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const address = proxy.address()
  if (address === null || typeof address === 'string') throw new Error('proxy did not bind a TCP port')
  const gitConfig = join(scratch, 'git.config')
  await writeFile(gitConfig, `[http "https://github.com/"]\n proxy = http://127.0.0.1:${String(address.port)}\n`)
  const overlay = join(scratch, 'cordis.patch.yml')
  await writeFile(overlay, '- id: ui-plugin-manager\n  config: { registryProbeEnabled: false }\n')
  const scaffold = await launchWebScaffold({
    profile: { packages: [], packageManager: { command: process.execPath, args: [], env: { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' } } },
    extraOverlayPath: overlay,
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const profile = join(scaffold.harnessHome, 'profiles', 'scaffold')
  const manifestPath = join(profile, 'package.json')
  const manifestBefore = await readFile(manifestPath, 'utf8')
  await writeFile(join(profile, 'config'), 'console.log("https://registry.npmjs.org/")\n')
  await writeFile(join(profile, '.attempts'), '')
  await writeFile(join(profile, 'add'), `
    const fs = require('node:fs');
    fs.appendFileSync('.attempts', JSON.stringify(process.argv) + '\\n');
    console.error('pnpm must not start after the GitHub connection check fails');
    process.exitCode = 1;
  `)
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await page.waitForSelector('[class*="frame"]')
  if (await page.getByRole('dialog', { name: '\u8bbe\u7f6e' }).count() > 0) await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: '\u5168\u5c40\u9762\u677f' }).getByRole('button', { name: '\u63d2\u4ef6', exact: true }).click()
  await page.getByRole('button', { name: '\u6dfb\u52a0\u63d2\u4ef6', exact: true }).click()
  const spec = 'https://github.com/example/dsh-plugin.git'
  const title = failure === 'timeout' ? '\u8fde\u63a5 GitHub \u8d85\u65f6' : '\u65e0\u6cd5\u8bbf\u95ee GitHub'
  let dialog = page.getByRole('dialog', { name: '\u6dfb\u52a0\u63d2\u4ef6', exact: true })
  await dialog.getByRole('button', { name: '\u5b89\u88c5\u6e90 npm \u5b98\u65b9\u6e90', exact: true }).waitFor()
  await dialog.getByRole('textbox', { name: '\u5305\u540d\u6216\u5730\u5740' }).fill(spec)
  expect(await page.getByText(title, { exact: true }).count()).toBe(0)
  await dialog.getByRole('button', { name: '\u5b89\u88c5', exact: true }).click()
  dialog = page.getByRole('dialog', { name: title, exact: true })
  await dialog.waitFor()
  expect(await page.getByRole('dialog').count()).toBe(1)
  expect(await dialog.getByText('\u8bf7\u5c1d\u8bd5\u5176\u4ed6\u5b89\u88c5\u6765\u6e90\u3002', { exact: true }).count()).toBe(1)
  await compareOrRefreshGolden(
    fileURLToPath(new URL(`./expected/plugin-install-github/${failure === 'timeout' ? 'timeout' : 'failed'}.expected.md`, import.meta.url)),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode(),
  )
  const attempts = await readFile(join(profile, '.attempts'), 'utf8')
  expect(attempts).toBe('')
  expect(connections).toBeGreaterThan(0)
  await expect.poll(() => sockets.size).toBe(0)
  const checked = connections
  await dialog.getByRole('button', { name: '\u6539\u7528\u56fd\u5185\u955c\u50cf', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '\u6dfb\u52a0\u63d2\u4ef6', exact: true })
  const input = dialog.getByRole('textbox', { name: '\u63d2\u4ef6\u5305\u540d', exact: true })
  await input.waitFor()
  expect(await input.inputValue()).toBe('')
  expect(await input.evaluate(element => element === document.activeElement)).toBe(true)
  expect(await dialog.getByRole('button', { name: '\u5b89\u88c5', exact: true }).isDisabled()).toBe(true)
  await dialog.getByRole('button', { name: '\u5b89\u88c5\u6e90 \u4e2d\u56fd\u5927\u9646\u955c\u50cf\u6e90', exact: true }).waitFor()
  await compareOrRefreshGolden(
    fileURLToPath(new URL('./expected/plugin-install-github/mirror.expected.md', import.meta.url)),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode(),
  )
  expect(await readFile(join(profile, '.attempts'), 'utf8')).toBe(attempts)
  expect(connections).toBe(checked)
  expect(await readFile(manifestPath, 'utf8')).toBe(manifestBefore)
  await input.fill(spec)
  await dialog.getByRole('button', { name: '\u5b89\u88c5', exact: true }).click()
  dialog = page.getByRole('dialog', { name: title, exact: true })
  await dialog.waitFor()
  await compareOrRefreshGolden(
    fileURLToPath(new URL(`./expected/plugin-install-github/${failure === 'timeout' ? 'timeout' : 'failed'}-on-mirror.expected.md`, import.meta.url)),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode(),
  )
  await dialog.getByRole('button', { name: '\u8bd5\u8bd5\u5176\u4ed6\u65b9\u5f0f', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '\u6dfb\u52a0\u63d2\u4ef6', exact: true })
  await dialog.getByRole('button', { name: '\u6536\u8d77\u5f15\u5bfc', exact: true }).waitFor()
  expect(await input.inputValue()).toBe('')
  expect(await input.evaluate(element => element === document.activeElement)).toBe(true)
  await compareOrRefreshGolden(
    fileURLToPath(new URL('./expected/plugin-install-github/another-way.expected.md', import.meta.url)),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode(),
  )
  await input.fill(spec)
  await dialog.getByRole('button', { name: '\u5b89\u88c5', exact: true }).click()
  dialog = page.getByRole('dialog', { name: title, exact: true })
  await dialog.getByRole('button', { name: '\u53d6\u6d88', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  expect(await readFile(join(profile, '.attempts'), 'utf8')).toBe('')
  expect(connections).toBeGreaterThan(checked)
  expect(tripwire.pageErrors).toEqual([])
})

it("shows the failed check's Git run and complete log in the installation details when no mirror is offered", async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-install-github-details-'))
  onTestFinished(() => rm(scratch, { recursive: true, force: true }))
  const sockets = new Set<Socket>()
  const proxy = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { sockets.delete(socket) })
    socket.once('data', () => socket.destroy())
  })
  onTestFinished(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => { proxy.close((error) => { if (error) reject(error); else resolve() }) })
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const address = proxy.address()
  if (address === null || typeof address === 'string') throw new Error('proxy did not bind a TCP port')
  const gitConfig = join(scratch, 'git.config')
  await writeFile(gitConfig, `[http "https://github.com/"]\n proxy = http://127.0.0.1:${String(address.port)}\n`)
  // Without a configured fallback registry the Host has no mirror to offer, so the failure keeps the
  // plain failed screen whose details name the check's own run.
  const overlay = join(scratch, 'cordis.patch.yml')
  await writeFile(overlay, '- id: ui-plugin-manager\n  config: { registryProbeEnabled: false }\n- id: plugin-manager\n  config: { fallbackRegistries: [] }\n')
  const scaffold = await launchWebScaffold({
    profile: { packages: [], packageManager: { command: process.execPath, args: [], env: { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' } } },
    extraOverlayPath: overlay,
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const profile = join(scaffold.harnessHome, 'profiles', 'scaffold')
  const attempts = join(profile, '.attempts')
  await writeFile(join(profile, 'config'), 'console.log("https://registry.npmjs.org/")\n')
  await writeFile(attempts, '')
  await writeFile(join(profile, 'add'), `
    const fs = require('node:fs');
    fs.appendFileSync('.attempts', JSON.stringify(process.argv) + '\\n');
    process.exitCode = 1;
  `)
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: ZH_BROWSER_LOCALE })
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await page.waitForSelector('[class*="frame"]')
  if (await page.getByRole('dialog', { name: '\u8bbe\u7f6e' }).count() > 0) await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: '\u5168\u5c40\u9762\u677f' }).getByRole('button', { name: '\u63d2\u4ef6', exact: true }).click()
  await page.getByRole('button', { name: '\u6dfb\u52a0\u63d2\u4ef6', exact: true }).click()
  const spec = 'https://github.com/example/dsh-plugin.git'
  let dialog = page.getByRole('dialog', { name: '\u6dfb\u52a0\u63d2\u4ef6', exact: true })
  await dialog.getByRole('textbox', { name: '\u5305\u540d\u6216\u5730\u5740' }).fill(spec)
  await dialog.getByRole('button', { name: '\u5b89\u88c5', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '\u63d2\u4ef6\u5b89\u88c5\u5931\u8d25', exact: true })
  await dialog.waitFor()
  expect(await dialog.getByText('\u65e0\u6cd5\u8fde\u63a5 github.com', { exact: false }).count()).toBe(1)
  // The details carry the failed check's own Git run and the complete log, not an empty terminal.
  await dialog.getByRole('button', { name: '\u67e5\u770b\u5b89\u88c5\u8be6\u60c5', exact: true }).click()
  await dialog.getByText(/git -c credential\.helper= ls-remote -- https:\/\/github\.com\/example\/dsh-plugin\.git HEAD/).waitFor()
  await dialog.getByText(/fatal: unable to access/).waitFor()
  expect(await dialog.getByText(/^\u5b8c\u6574\u65e5\u5fd7\uff1a.*github-connection-.*git\.log$/).count()).toBe(1)
  expect(await readFile(attempts, 'utf8')).toBe('')
  expect(tripwire.pageErrors).toEqual([])
})
