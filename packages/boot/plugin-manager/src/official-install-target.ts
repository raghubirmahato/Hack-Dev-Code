/** Select Official bundle packages from the running installation without importing provider code. */
import { existsSync, globSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { bundlePatchPaths, type ProfileManifest } from '@hackdevcode/dsh-app-boot'

interface WorkspaceManifest extends ProfileManifest {
  main?: string
}

function manifestAt(file: string): WorkspaceManifest {
  return JSON.parse(readFileSync(file, 'utf8')) as WorkspaceManifest
}

/** Directory beside a packaged Desktop archive holding the on-demand Official bundle tarballs. */
const SHIPPED_BUNDLES_DIR = 'official-bundles'

/**
 * The tarball a packaged installation ships for one Official bundle. Desktop keeps these beside its archive, a few
 * levels above the DSH manifest, because the registry does not carry the bundles; the search stops at the
 * filesystem root.
 * @param name - Official catalog package name.
 * @param anchor - Real path of the running DSH package.json.
 * @param version - Running DSH version.
 * @returns the absolute tarball path, or undefined when this installation ships none.
 */
function shippedBundleTarball(name: string, anchor: string, version: string): string | undefined {
  const file = `${name.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`
  for (let directory = dirname(anchor), parent = dirname(directory); ; directory = parent, parent = dirname(parent)) {
    const candidate = join(directory, SHIPPED_BUNDLES_DIR, file)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    if (parent === directory) return undefined
  }
}

/**
 * Offer a source checkout link, a tarball the installation ships, or an exact published package version. Source
 * installations are identified by the real CLI manifest and its unpacked workspace dependencies, including Desktop's
 * development symlink. An incomplete checkout is an error, never a registry fallback. A packaged Desktop installs
 * from the tarball beside its archive when it ships one, since the registry does not carry the bundle.
 * @param name - Official catalog package name.
 * @param installAnchor - Running application's DSH package.json, possibly reached through a symlink.
 * @param version - Running DSH version used by its release family.
 * @returns An ordinary package-manager spec and its package version.
 * @throws when a source installation lacks its workspace package, bundle patch, or built runtime.
 */
export function officialBundleInstallTarget(name: string, installAnchor: string, version: string): { spec: string; version: string } {
  const anchor = realpathSync(installAnchor)
  const installation = manifestAt(anchor)
  const source = installation.name === '@hackdevcode/dsh'
    && Object.values(installation.dependencies ?? {}).some(value => value.startsWith('workspace:'))
  if (!source) {
    const shipped = shippedBundleTarball(name, anchor, version)
    return shipped === undefined ? { spec: `${name}@${version}`, version } : { spec: `file:${shipped}`, version }
  }
  const root = resolve(dirname(anchor), '../..')
  if (anchor !== join(root, 'apps', 'cli', 'package.json')
    || !existsSync(join(root, 'package.json'))
    || manifestAt(join(root, 'package.json')).name !== '@hackdevcode/dsh-root') {
    throw new Error(`Official bundle ${name}: source DSH installation ${anchor} requires its complete workspace checkout`)
  }
  const matches = globSync('packages/*/*/package.json', { cwd: root })
    .map(file => ({ file: join(root, file), manifest: manifestAt(join(root, file)) }))
    .filter(entry => entry.manifest.name === name)
  const selected = matches[0]
  if (matches.length !== 1 || selected === undefined) {
    throw new Error(`Official bundle ${name}: expected one workspace package in ${root}, found ${matches.length}; restore the checkout and run pnpm install`)
  }
  const { file, manifest } = selected
  const directory = realpathSync(dirname(file))
  if (manifest.version !== version || manifest.private === true || manifest.dsh?.bundle === undefined) {
    throw new Error(`Official bundle ${name}: ${file} must declare a public bundle at DSH version ${version}`)
  }
  const main = typeof manifest.main === 'string' ? resolve(directory, manifest.main) : undefined
  if (main === undefined || !existsSync(main) || !statSync(main).isFile()) {
    throw new Error(`Official bundle ${name}: built runtime is missing in ${directory}; run pnpm install and pnpm run build in ${root}`)
  }
  for (const patch of bundlePatchPaths(directory, manifest.dsh.bundle)) {
    if (!existsSync(patch) || !statSync(patch).isFile()) {
      throw new Error(`Official bundle ${name}: bundle patch ${patch} is missing; restore the checkout`)
    }
  }
  return { spec: `link:${directory}`, version }
}
