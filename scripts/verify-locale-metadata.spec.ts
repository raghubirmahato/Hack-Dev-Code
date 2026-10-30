/** English metadata coverage uses the same checker as CI. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { localeMetadataProblems } from './verify-locale-metadata.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(english: unknown = { meta: { title: 'Name {name}', description: 'Description.' } }): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-locale-meta-'))
  roots.push(root)
  const directory = join(root, 'packages/demo/plugin/locale')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'en.json'), JSON.stringify(english))
  return root
}

it('accepts complete English metadata', () => {
  expect(localeMetadataProblems(fixture())).toEqual([])
})

it('rejects a missing English locale file, including newly added packages', () => {
  const root = fixture()
  rmSync(join(root, 'packages/demo/plugin/locale/en.json'))
  expect(localeMetadataProblems(root).join('\n')).toContain('no package locale metadata found')
})

it.each([
  [{ meta: { title: 'Name {name}', description: 'No punctuation' } }, 'sentence punctuation'],
  [{ meta: { title: '' } }, 'expected non-empty text'],
  [{ meta: { title: 5 } }, 'expected non-empty text'],
])('rejects incomplete or inconsistent English metadata', (en, diagnostic) => {
  expect(localeMetadataProblems(fixture(en)).join('\n')).toContain(diagnostic)
})

it('checks referenced detail documents', () => {
  const root = fixture({ meta: { title: 'Name {name}', detail: 'docs/DETAIL.md' } })
  expect(localeMetadataProblems(root).join('\n')).toContain('missing detail resource')
  const directory = join(root, 'packages/demo/plugin/locale')
  mkdirSync(join(directory, '../docs'))
  writeFileSync(join(directory, '../docs/DETAIL.md'), '# Detail\n')
  expect(localeMetadataProblems(root)).toEqual([])
})

it('does not mistake package.json in the locale service package for a translation', () => {
  const root = fixture()
  const directory = join(root, 'packages/client/locale')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{"name":"locale"}')
  mkdirSync(join(directory, 'src'))
  writeFileSync(join(directory, 'src/index.ts'), 'export {}')
  expect(localeMetadataProblems(root)).toEqual([])
})

it('rejects an empty discovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-locale-empty-'))
  roots.push(root)
  expect(localeMetadataProblems(root)).toEqual(['no package locale metadata found'])
})

it('rejects loadable plugins without any locale directory', () => {
  const root = fixture()
  const directory = join(root, 'packages/demo/new-plugin')
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@hackdevcode/dsh-new-plugin' }))
  writeFileSync(join(directory, 'src/index.ts'), 'export function apply() {}')
  expect(localeMetadataProblems(root).join('\n')).toContain('new-plugin/locale')
})

it('checks nested subpath locale resources and package-relative detail files', () => {
  const root = fixture()
  const directory = join(root, 'packages/demo/plugin/locale/tools')
  mkdirSync(directory)
  writeFileSync(join(directory, 'en.json'), JSON.stringify({ meta: { title: 'Tools', description: 'Tool list.', detail: 'docs/TOOLS.md' } }))
  mkdirSync(join(root, 'packages/demo/plugin/docs'))
  writeFileSync(join(root, 'packages/demo/plugin/docs/TOOLS.md'), '# Tools\n')
  expect(localeMetadataProblems(root)).toEqual([])
})

it.each(['../../other/README.md', 'docs\\DETAIL.md', 'docs/DETAIL.txt', '/README.md'])('rejects runtime-invalid detail path %s', (detail) => {
  const root = fixture({ meta: { title: 'Name {name}', description: 'Description.', detail } })
  expect(localeMetadataProblems(root).join('\n')).toMatch(/must (?:be a relative path|name a Markdown file)/u)
})

it('requires sentence punctuation for English descriptions', () => {
  const root = fixture({ meta: { title: 'Name {name}', description: 'Description' } })
  expect(localeMetadataProblems(root).join('\n')).toContain('sentence punctuation')
})

it('excludes packages formally classified as test helpers', () => {
  const root = fixture()
  const directory = join(root, 'packages/test-support/llm-replay')
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(join(directory, 'src/index.ts'), 'export function apply() {}')
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@hackdevcode/dsh-llm-replay' }))
  expect(localeMetadataProblems(root)).toEqual([])
})

it.each(['\u200b', '\ufeff', String.raw`\u200b`, String.raw`\ufeff`])('rejects invisible characters in JSON resources', (character) => {
  const root = fixture()
  const file = join(root, 'packages/demo/plugin/locale/en.json')
  writeFileSync(file, readFileSync(file, 'utf8').replace('Description.', `Description${character}.`))
  expect(localeMetadataProblems(root).join('\n')).toContain('invisible locale character')
})
