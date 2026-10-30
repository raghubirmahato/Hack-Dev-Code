import { createRequire } from 'node:module'
/** The English installer resource feeds both the packaging language list and the NSIS compiler. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { readInstallerLocales, renderInstallerStrings } from '../scripts/installer-locales.mjs'

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-installer-locales-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  writeFileSync(join(directory, 'en_US.json'), readFileSync(new URL('../installer/locales/en_US.json', import.meta.url)))
  return directory
}

it('generates English NSIS strings from the packaged language resource', () => {
  const locales = readInstallerLocales()
  expect(locales.map(locale => locale.id)).toEqual(['en_US'])
  const source = renderInstallerStrings(locales)
  expect(source).toContain('LangString INSTALLER_INSTALL ${LANG_ENGLISH} "Install now"')
  expect(source).toContain('LangString INSTALLER_NATIVE_PROGRESS ${LANG_ENGLISH} "Preparing installation… %d%%"')
  expect(source).toContain('!ifdef LANG_ENGLISH\n')
  expect(source.match(/^LangString /gmu)).toHaveLength(31)
})

it('rejects a missing en_US configuration', () => {
  const directory = fixture()
  rmSync(join(directory, 'en_US.json'))
  expect(() => readInstallerLocales(directory)).toThrow('missing en_US.json')
})

it('rejects a second installer language', () => {
  const directory = fixture()
  writeFileSync(join(directory, 'de_DE.json'), readFileSync(new URL('../installer/locales/en_US.json', import.meta.url)))
  expect(() => readInstallerLocales(directory)).toThrow('English is the only shipped installer language')
})

it.each([
  ['empty text', (resource: ReturnType<typeof readInstallerLocales>[number]) => { resource.strings.INSTALLER_INSTALL = '' }, 'nonempty text'],
  ['invisible character', (resource: ReturnType<typeof readInstallerLocales>[number]) => { resource.strings.INSTALLER_INSTALL = 'Install\u200b' }, 'invisible'],
  ['byte-order mark', (resource: ReturnType<typeof readInstallerLocales>[number]) => { resource.strings.INSTALLER_INSTALL = 'Install\ufeff' }, 'invisible'],
  ['invalid compiler token', (resource: ReturnType<typeof readInstallerLocales>[number]) => { resource.nsisLanguage = 'EN\n!error' }, 'invalid NSIS language identifier'],
])('rejects %s', (_name, mutate, diagnostic) => {
  const directory = fixture()
  const resource = readInstallerLocales(directory)[0]!
  mutate(resource)
  writeFileSync(join(directory, 'en_US.json'), JSON.stringify(resource))
  expect(() => readInstallerLocales(directory)).toThrow(diagnostic)
})

it('rejects an invalid installer string key', () => {
  const directory = fixture()
  const resource = readInstallerLocales(directory)[0]!
  resource.strings.install = 'Install'
  writeFileSync(join(directory, 'en_US.json'), JSON.stringify(resource))
  expect(() => readInstallerLocales(directory)).toThrow('invalid installer string key')
})

it('escapes literal NSIS syntax without changing English text', () => {
  const locale = readInstallerLocales()[0]!
  expect(renderInstallerStrings([{ ...locale, strings: { INSTALLER_INSTALL: '"$name"\nnext\rline' } }]))
    .toContain('"$\\"$$name$\\"$\\nnext$\\rline"')
})

it('uses the real electron-builder language identifier', () => {
  const require = createRequire(import.meta.url)
  const { LangConfigurator, createAddLangsMacro } = require('app-builder-lib/out/targets/nsis/nsisLang.js') as {
    LangConfigurator: new (options: { installerLanguages: string[] }) => object
    createAddLangsMacro: (generator: { macro: (name: string, lines: string[]) => void }, languages: object) => void
  }
  const locales = readInstallerLocales()
  expect(locales[0]?.id).toBe('en_US')
  expect(locales.map(locale => locale.id.split('_')[0])).toEqual(['en'])
  createAddLangsMacro({ macro: (_name, lines) => {
    expect(lines.map(line => /MUI_LANGUAGE "([^" ]+)"/u.exec(line)?.[1]?.toUpperCase()))
      .toEqual(locales.map(locale => locale.nsisLanguage))
  } }, new LangConfigurator({ installerLanguages: locales.map(locale => locale.id) }))
}, 30_000)
