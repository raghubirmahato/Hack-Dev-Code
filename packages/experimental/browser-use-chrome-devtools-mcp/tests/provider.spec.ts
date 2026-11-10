import { existsSync } from 'node:fs'
import { Context } from '@hackdevcode/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { mountSessionMcp } from '@hackdevcode/dsh-experimental-browser-use-runtime/mcp'
import * as Provider from '../src/index.ts'

vi.mock('@hackdevcode/dsh-experimental-browser-use-runtime/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@hackdevcode/dsh-experimental-browser-use-runtime/mcp')>(),
  mountSessionMcp: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

it('resolves the installed DevTools CLI and explicitly selects isolated headed or headless launch', () => {
  void Provider.apply(new Context(), Provider.Config({ mode: 'launch', executablePath: '/custom/chrome', toolCallTimeoutMs: 456 }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(existsSync(options.args[0]!)).toBe(true)
  expect(options).toMatchObject({ name: 'chrome-devtools-mcp', exclusive: false, command: process.execPath, toolCallTimeoutMs: 456 })
  expect(options.args.slice(1)).toEqual(['--no-usage-statistics', '--isolated', '--headless=true', '--executable-path', '/custom/chrome', '--category-performance=false', '--category-emulation=false'])
  void Provider.apply(new Context(), Provider.Config({ mode: 'launch', headless: false }))
  expect(vi.mocked(mountSessionMcp).mock.calls[1]![1].args.slice(1)).toEqual(['--no-usage-statistics', '--isolated', '--headless=false', '--category-performance=false', '--category-emulation=false'])
  expect('default' in Provider).toBe(false)
})

it.each([
  ['http://127.0.0.1:9222', '--browser-url'],
  ['wss://browser.example/devtools/browser/id', '--ws-endpoint'],
])('attaches to %s without passing launch flags', (endpoint, flag) => {
  void Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.exclusive).toBe(true)
  expect(options.args.slice(1)).toEqual(['--no-usage-statistics', flag, endpoint, '--category-performance=false', '--category-emulation=false'])
})

it('rejects trailing endpoint garbage before mounting any browser resources', () => {
  expect(() => { void Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://localhost trailing-junk' })) }).toThrow('browser endpoint')
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

it('keeps one persistent profile with a chosen channel, size and vision tools when isolation is off', () => {
  void Provider.apply(new Context(), Provider.Config({
    mode: 'launch', headless: false, isolated: false, userDataDir: 'C:/profiles/agent', channel: 'beta', viewport: '1440x900',
    vision: true, screenshotMaxWidth: 1280,
  }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.exclusive).toBe(false)
  expect(options.args.slice(1)).toEqual([
    '--no-usage-statistics', '--headless=false', '--user-data-dir', 'C:/profiles/agent', '--channel', 'beta',
    '--viewport', '1440x900', '--experimental-vision', '--screenshot-max-width', '1280', '--category-performance=false', '--category-emulation=false',
  ])
})

it('connects exclusively to the running Chrome profile through one shared relay connection', async () => {
  const ctx = new Context()
  await Provider.apply(ctx, Provider.Config({ mode: 'connect', channel: 'stable', vision: true }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(options.exclusive).toBe(true)
  expect(options.args.slice(1, 3)).toEqual(['--no-usage-statistics', '--ws-endpoint'])
  expect(options.args[3]).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f]{48}$/u)
  expect(options.args.slice(4)).toEqual(['--experimental-vision', '--category-performance=false', '--category-emulation=false'])
  // Without a relay the server connects on its own, as before.
  expect(Provider.chromeArgs(Provider.Config({ mode: 'connect', channel: 'beta' }))).toEqual(
    ['--no-usage-statistics', '--auto-connect', '--channel', 'beta', '--category-performance=false', '--category-emulation=false'])
  await ctx.fiber.dispose()
})

it('rejects an unknown channel and a malformed viewport', () => {
  expect(() => Provider.Config({ mode: 'connect', channel: 'nightly' } as never)).toThrow()
  expect(() => Provider.Config({ mode: 'launch', viewport: 'wide' } as never)).toThrow()
})

it('exposes performance and emulation tools only on request', () => {
  void Provider.apply(new Context(), Provider.Config({ mode: 'launch', performanceTools: true, emulationTools: true }))
  const args = vi.mocked(mountSessionMcp).mock.calls[0]![1].args
  expect(args).not.toContain('--category-performance=false')
  expect(args).not.toContain('--category-emulation=false')
})
