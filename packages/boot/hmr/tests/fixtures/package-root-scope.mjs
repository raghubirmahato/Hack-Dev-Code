/** Isolate root-scope traversal; the filesystem root is read but never modified. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PackageManifests } from '../../src/package-manifest.ts'

const [root] = process.argv.slice(2)
const reader = createRequire(import.meta.url)('internal/modules/package_json_reader')
const source = join(root, 'missing', 'entry.js')
const url = pathToFileURL(source).href
// Values, not object shapes: Node returns its cached manifest (null prototype, getters) once and a plain object
// after re-reading, which only shows when a package.json exists above the fixture (for example in the temp folder).
const plain = value => value !== null && typeof value === 'object'
  ? { ...value, ...value.data !== null && typeof value.data === 'object' ? { data: { ...value.data } } : {} }
  : value
const expectedScope = plain(reader.getPackageScopeConfig(url))
const expectedNearest = plain(reader.getNearestParentPackageJSON(source))
const manifests = new PackageManifests()
try {
  await manifests.invalidate(join(parse(root).root, 'package.json'))
  assert.deepEqual(plain(reader.getPackageScopeConfig(url)), expectedScope)
  assert.deepEqual(plain(reader.getNearestParentPackageJSON(source)), expectedNearest)
  process.stdout.write('scope traversal completed\n')
} finally {
  manifests.dispose()
}
