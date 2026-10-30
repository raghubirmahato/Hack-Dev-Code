/** Check the shipped English metadata of package and plugin locales without loading plugins. */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { posix, join, resolve } from 'node:path'
import { detailPath } from '../packages/util/plugin-detail/src/document.ts'
import { PRODUCT_PACKAGE_POLICY } from './product-package-policy.ts'
import { SHIPPED_LOCALE_IDS, hasInvisibleLocaleCharacters } from './shipped-locales.ts'
import { collectConfigCatalog } from './gen-config-catalog.ts'

/** Flatten metadata strings and reject values that cannot be translated. */
function strings(value: unknown, key = ''): Record<string, string> {
  if (typeof value === 'string' && value.trim() !== '') return { [key]: value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${key}: expected non-empty text`)
  return Object.fromEntries(Object.entries(value).flatMap(([name, child]) => Object.entries(strings(child, key ? `${key}.${name}` : name))))
}

/**
 * Check every package and template locale directory for complete English metadata.
 * @param root - repository or fixture root.
 * @returns actionable missing-file, field, placeholder and resource diagnostics.
 */
export function localeMetadataProblems(root: string): string[] {
  const language = SHIPPED_LOCALE_IDS[0]
  const fileName = `${language}.json`
  const directories = new Set(globSync(`packages/**/locale/**/${fileName}`, {
    cwd: root, exclude: ['packages/**/node_modules/**', 'packages/**/lib/**', 'packages/**/tests/**'],
  }).map(file => file.replaceAll('\\', '/')).map(file => posix.dirname(file)))
  for (const entry of collectConfigCatalog(root)) {
    const dir = entry.dir.replaceAll('\\', '/')
    if (PRODUCT_PACKAGE_POLICY[dir]?.category === 'test') continue
    if (entry.kind !== 'config' && entry.kind !== 'no-config') continue
    directories.add(`${dir}/locale`)
  }
  const problems: string[] = []
  if (directories.size === 0) return ['no package locale metadata found']
  for (const directory of [...directories].sort()) {
    try {
      const read = (): Record<string, string> => {
        const file = join(root, directory, fileName)
        const source = readFileSync(file, 'utf8')
        if (hasInvisibleLocaleCharacters(source) || /\\u(?:200b|feff)/iu.test(source)) throw new Error(`${fileName}: invisible locale character`)
        const value: unknown = JSON.parse(source)
        const dictionary = strings(value)
        const detail = detailPath(dictionary['meta.detail'], `${directory}/${fileName}: meta.detail`)
        const packageDir = directory.slice(0, directory.lastIndexOf('/locale'))
        if (detail !== undefined && !existsSync(resolve(root, packageDir, detail))) {
          throw new Error(`missing detail resource ${detail}`)
        }
        return dictionary
      }
      const en = read()
      const description = en['meta.description']
      if (description !== undefined && !/[.!?]$/u.test(description)) problems.push(`${directory}/${fileName}: meta.description must end with sentence punctuation`)
    } catch (error) {
      problems.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return problems
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const problems = localeMetadataProblems(resolve(import.meta.dirname, '..'))
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) process.exitCode = 1
  else console.log('verify-locale-metadata: all package and template metadata carries complete English metadata.')
}
