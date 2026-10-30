import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { readDesktopLocaleCache, writeDesktopLocaleCache } from '../src/locale-cache.ts'
import { resolveDesktopLocale, resolveDesktopStartupLocale } from '../src/locale.ts'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-locale-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  return directory
}

it('uses the confirmed English language for recovery before Host settings are available', () => {
  const directory = fixture()
  expect(readDesktopLocaleCache(directory)).toBeUndefined()
  writeDesktopLocaleCache(directory, 'en')
  const cached = readDesktopLocaleCache(directory)
  const locale = cached === undefined ? resolveDesktopStartupLocale(null, ['en-US']) : resolveDesktopLocale(cached)
  expect(locale.id).toBe('en')
  expect(locale.messages.fatalSummary).toBe('The application could not start or stopped unexpectedly.')
  expect(readDesktopLocaleCache(directory)).toBe('en')
})

it('ignores a cache that names a language the shell no longer ships', () => {
  const directory = fixture()
  writeDesktopLocaleCache(directory, 'en')
  writeFileSync(join(directory, 'desktop', 'locale-cache'), 'ja\n')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => { warn.mockRestore() })
  expect(readDesktopLocaleCache(directory)).toBeUndefined()
  expect(warn).toHaveBeenCalled()
})

it.each(['', 'it', '{invalid'])('falls back to system language for an invalid cache: %s', (value) => {
  const directory = fixture()
  writeDesktopLocaleCache(directory, 'en')
  writeFileSync(join(directory, 'desktop', 'locale-cache'), value)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => { warn.mockRestore() })
  expect(readDesktopLocaleCache(directory)).toBeUndefined()
  expect(warn).toHaveBeenCalled()
})

it('keeps read and write failures from blocking recovery', () => {
  const directory = fixture()
  writeFileSync(join(directory, 'desktop'), 'not a directory')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => { warn.mockRestore() })
  expect(() => { writeDesktopLocaleCache(directory, 'en') }).not.toThrow()
  expect(readDesktopLocaleCache(directory)).toBeUndefined()
  expect(warn).toHaveBeenCalled()
})
