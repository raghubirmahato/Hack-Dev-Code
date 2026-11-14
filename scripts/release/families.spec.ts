/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { ON_DEMAND_BUNDLES } from '../../packages/util/official-bundles/src/bundles.ts'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

const roots: string[] = []

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-build-'))
  roots.push(root)
  write(join(root, 'package.json'), `${JSON.stringify({ version: environment.DSH_CLIENT_VERSION ?? '0.0.1' })}\n`)
  write(join(root, 'apps/web/dist/index.html'), '<main></main>')
  write(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('release families', () => {
  it('publishes all current experimental packages', () => {
    const members = releaseFamily('dsh').members(resolve(import.meta.dirname, '../..'))

    expect(members
      .filter(member => member.directory.startsWith('packages/experimental/'))
      .map(member => member.name)).toEqual([
      '@hackdevcode/dsh-action-cards',
      '@hackdevcode/dsh-experimental-agent-team-profile',
      '@hackdevcode/dsh-experimental-agent-team',
      '@hackdevcode/dsh-experimental-api-speech-to-text',
      '@hackdevcode/dsh-experimental-auto-review',
      '@hackdevcode/dsh-experimental-badge-skill-bundle',
      '@hackdevcode/dsh-experimental-browser-use-chrome-devtools-mcp',
      '@hackdevcode/dsh-experimental-browser-use-playwright-mcp',
      '@hackdevcode/dsh-experimental-browser-use-runtime',
      '@hackdevcode/dsh-experimental-browser-use-stagehand-native',
      '@hackdevcode/dsh-experimental-claude-code-mods',
      '@hackdevcode/dsh-client-ui-action-cards',
      '@hackdevcode/dsh-experimental-client-ui-agent-team',
      '@hackdevcode/dsh-experimental-client-ui-claude-code-mods',
      '@hackdevcode/dsh-experimental-client-ui-cot-translation',
      '@hackdevcode/dsh-client-ui-creation-recommendations',
      '@hackdevcode/dsh-experimental-client-ui-forge',
      '@hackdevcode/dsh-client-ui-plugin-recommendations',
      '@hackdevcode/dsh-experimental-client-ui-stats',
      '@hackdevcode/dsh-experimental-client-ui-voice-input',
      '@hackdevcode/dsh-experimental-computer-use-cua-driver-mcp',
      '@hackdevcode/dsh-experimental-computer-use-cua-driver-native',
      '@hackdevcode/dsh-experimental-cot-translation-bundle',
      '@hackdevcode/dsh-creation-recommendations',
      '@hackdevcode/dsh-cua-bundle',
      '@hackdevcode/dsh-experimental-cua-macos',
      '@hackdevcode/dsh-cua',
      '@hackdevcode/dsh-experimental-forge-bundle',
      '@hackdevcode/dsh-experimental-forge-github',
      '@hackdevcode/dsh-experimental-forge-session',
      '@hackdevcode/dsh-experimental-forge',
      '@hackdevcode/dsh-hook-protocol',
      '@hackdevcode/dsh-hooks-claude-code',
      '@hackdevcode/dsh-hooks-codex',
      '@hackdevcode/dsh-experimental-inspector-profile',
      '@hackdevcode/dsh-experimental-inspector',
      '@hackdevcode/dsh-experimental-liveshare-protocol',
      '@hackdevcode/dsh-experimental-liveshare',
      '@hackdevcode/dsh-personalized-recommendations',
      '@hackdevcode/dsh-experimental-plugin-market-bundle',
      '@hackdevcode/dsh-plugin-recommendations',
      '@hackdevcode/dsh-experimental-ptc-runtime-python',
      '@hackdevcode/dsh-experimental-ralph-bundle',
      '@hackdevcode/dsh-experimental-session-inspector',
      '@hackdevcode/dsh-experimental-session-search',
      '@hackdevcode/dsh-session-title-all-prompts-llm',
      '@hackdevcode/dsh-experimental-session-titles-bundle',
      '@hackdevcode/dsh-skill-badge',
      '@hackdevcode/dsh-experimental-speech-to-text-sensevoice',
      '@hackdevcode/dsh-experimental-speech-to-text',
      '@hackdevcode/dsh-experimental-subagent-oar',
      '@hackdevcode/dsh-experimental-terminal-bundle',
      '@hackdevcode/dsh-experimental-tool-agent-team',
      '@hackdevcode/dsh-tool-ralph',
      '@hackdevcode/dsh-tool-session-query',
      '@hackdevcode/dsh-experimental-tool-subagent-oar',
      '@hackdevcode/dsh-tool-terminal',
      '@hackdevcode/dsh-experimental-tool-worktree',
      '@hackdevcode/dsh-experimental-translator',
      '@hackdevcode/dsh-experimental-voice-input-bundle',
      '@hackdevcode/dsh-webhook-github',
      '@hackdevcode/dsh-webhook',
      '@hackdevcode/dsh-experimental-webworker-packer',
      '@hackdevcode/dsh-experimental-webworker-runtime',
      '@hackdevcode/dsh-experimental-worktree',
    ])
  })

  it('excludes private applications from the publish set', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-private-'))
    roots.push(root)
    write(join(root, 'apps/public/package.json'), '{"name":"@hackdevcode/dsh-public","version":"0.0.1"}\n')
    write(join(root, 'apps/private/package.json'), '{"name":"@hackdevcode/dsh-private","version":"0.0.1","private":true}\n')

    expect(releaseFamily('dsh').members(root).map(entry => entry.name)).toEqual(['@hackdevcode/dsh-public'])
  })

  it('publishes unlisted experimental packages while retaining private exclusions', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-experimental-'))
    roots.push(root)
    write(join(root, 'packages/experimental/prototype/package.json'), JSON.stringify({
      name: '@hackdevcode/dsh-experimental-prototype',
      version: '0.0.1',
      publishConfig: { access: 'public' },
    }))
    write(join(root, 'packages/experimental/inspector/package.json'), JSON.stringify({
      name: '@hackdevcode/dsh-experimental-inspector',
      version: '0.0.1',
      private: true,
    }))

    expect(releaseFamily('dsh').members(root).map(entry => entry.name)).toEqual([
      '@hackdevcode/dsh-experimental-prototype',
    ])
  })

  it('bumps private dsh workspaces without adding release tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-version-'))
    roots.push(root)
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'apps/desktop/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/core/unselected/package.json'), '{"version":"0.0.1"}\n')

    const dsh = releaseFamily('dsh')
    const published = member('packages/core/published', '@hackdevcode/dsh-published')
    const { planned } = planShared(dsh, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'packages/core/published/package.json', tag: 'dsh-v0.0.2' },
      { path: 'apps/desktop/package.json', tag: undefined },
      { path: 'packages/experimental/prototype/package.json', tag: undefined },
    ])
  })

  it.each(['0.0.2-alpha.1', '0.0.2-canary.1', '0.0.2-rc.1'])(
    'accepts the explicit dsh prerelease version %s',
    (version) => {
      const root = mkdtempSync(join(tmpdir(), 'dsh-release-prerelease-'))
      roots.push(root)
      write(join(root, 'package.json'), '{"version":"0.0.1"}\n')

      const dsh = releaseFamily('dsh')
      const published = member('packages/core/published', '@hackdevcode/dsh-published')
      const plan = planShared(dsh, root, [published], version)

      expect(plan.version).toBe(version)
      expect(plan.planned[1]?.tag).toBe(`dsh-v${version}`)
    },
  )

  it('names one tag for the whole dsh family and one per vendored package', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', '@hackdevcode/dsh')
    const cordis = { ...member('vendor/cordis', '@hackdevcode/cordis'), version: '4.0.1' }

    expect(dsh.tagFor(cli)).toBe('dsh-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('assigns alpha and canary dist-tags only to dsh releases', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')

    expect(dsh.distTagForVersion('0.0.2-alpha.1')).toBe('alpha')
    expect(dsh.distTagForVersion('0.0.2-canary.1')).toBe('canary')
    expect(dsh.distTagForVersion('0.0.2-rc.1')).toBe('next')
    expect(dsh.distTagForVersion('0.0.2')).toBeUndefined()
    expect(vendor.distTagForVersion('4.0.1-alpha.1')).toBe('next')
    expect(vendor.distTagForVersion('4.0.1-canary.1')).toBe('next')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const dsh = releaseFamily('dsh')
    const members = [member('apps/cli', '@hackdevcode/dsh'), { ...member('apps/web', '@hackdevcode/dsh-web-frontend'), version: '0.0.2' }]

    expect(() => { dsh.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { dsh.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@hackdevcode/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@hackdevcode/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('requires a current official client build only for dsh artifacts', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../..'))
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', officialEnvironment.DSH_CLIENT_COMMIT_HASH)
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})
    const missing = join(defaultBuild, 'missing')
    write(join(missing, 'package.json'), `${JSON.stringify({ version: officialEnvironment.DSH_CLIENT_VERSION })}\n`)

    expect(() => { dsh.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { dsh.verifyBuildArtifacts(defaultBuild) }).toThrow(/DSH_CLIENT_TITLE/)
    expect(() => { dsh.verifyBuildArtifacts(missing) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(missing) }).not.toThrow()

    write(join(official, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { dsh.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/consumer', '@hackdevcode/dsh-consumer', { dependencies: { '@hackdevcode/dsh-library': 'workspace:^' } }),
      member('packages/a/library', '@hackdevcode/dsh-library'),
      member('packages/a/zebra', '@hackdevcode/dsh-zebra'),
    ]

    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@hackdevcode/dsh-library',
      '@hackdevcode/dsh-consumer',
      '@hackdevcode/dsh-zebra',
    ])
  })

  it('publishes on-demand catalog members before dsh without adding installed dependencies', () => {
    const dsh = member('apps/cli', '@hackdevcode/dsh')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name))
    const plan = releaseFamily('dsh').publishOrder([dsh, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES, dsh.name])
    expect(dsh.manifest).toEqual({})
    expect(plan.droppedPeerEdges).toEqual([])
  })

  it('rejects an advertised provider missing from the public release family', () => {
    expect(() => releaseFamily('dsh').publishOrder([member('apps/cli', '@hackdevcode/dsh')]))
      .toThrow('Official catalog prerequisite')
  })

  it('keeps catalog prerequisites ahead of a dsh peer declaration', () => {
    const dsh = member('apps/cli', '@hackdevcode/dsh')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name, {
      peerDependencies: { '@hackdevcode/dsh': 'workspace:*' },
    }))
    const plan = releaseFamily('dsh').publishOrder([dsh, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES, dsh.name])
    expect(plan.droppedPeerEdges).toEqual(ON_DEMAND_BUNDLES.map(name => ({ consumer: name, peer: dsh.name })))
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])(
    'requires exact packed DSH %s while preserving external ranges', (section) => {
      const pkg = member('packages/example/provider', '@hackdevcode/dsh-provider')
      const family = releaseFamily('dsh')
      const manifest = { name: pkg.name, version: pkg.version, [section]: { '@hackdevcode/dsh-tools': pkg.version, external: '^4.0.0' } }
      expect(() => { family.validatePackedManifest(pkg, manifest) }).not.toThrow()
      for (const range of ['workspace:*', '^0.0.1', '~0.0.1', '0.0.2', '*']) {
        expect(() => { family.validatePackedManifest(pkg, { ...manifest, [section]: { '@hackdevcode/dsh-tools': range } }) })
          .toThrow(`packed ${section}.@hackdevcode/dsh-tools must equal`)
      }
    },
  )

  it('checks packed identities and preserves independent vendor versions', () => {
    const pkg = member('vendor/example', '@hackdevcode/example')
    const family = releaseFamily('vendor')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: pkg.version, dependencies: { '@hackdevcode/dsh-tools': '^4.0.0' } }) })
      .not.toThrow()
    expect(() => { family.validatePackedManifest(pkg, { name: '@hackdevcode/other', version: pkg.version }) }).toThrow('packed identity')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: '0.0.2' }) }).toThrow('packed identity')
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/left', '@hackdevcode/dsh-left', { dependencies: { '@hackdevcode/dsh-right': 'workspace:^' } }),
      member('packages/a/right', '@hackdevcode/dsh-right', { dependencies: { '@hackdevcode/dsh-left': 'workspace:^' } }),
    ]

    expect(() => { dsh.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/consumer', '@hackdevcode/dsh-consumer', { peerDependencies: { '@hackdevcode/dsh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@hackdevcode/dsh-zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@hackdevcode/dsh-zebra',
      '@hackdevcode/dsh-consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/left', '@hackdevcode/dsh-left', { peerDependencies: { '@hackdevcode/dsh-right': 'workspace:^' } }),
      member('packages/a/right', '@hackdevcode/dsh-right', { peerDependencies: { '@hackdevcode/dsh-left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@hackdevcode/dsh-right',
      '@hackdevcode/dsh-left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@hackdevcode/dsh-right', peer: '@hackdevcode/dsh-left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/base', '@hackdevcode/dsh-base', { peerDependencies: { '@hackdevcode/dsh-consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@hackdevcode/dsh-consumer', {
        dependencies: { '@hackdevcode/dsh-base': 'workspace:^' },
        peerDependencies: { '@hackdevcode/dsh-base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@hackdevcode/dsh-base',
      '@hackdevcode/dsh-consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@hackdevcode/dsh-base', peer: '@hackdevcode/dsh-consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/alpha', '@hackdevcode/dsh-alpha', { peerDependencies: { '@hackdevcode/dsh-bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@hackdevcode/dsh-bravo', { peerDependencies: { '@hackdevcode/dsh-charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@hackdevcode/dsh-charlie', { dependencies: { '@hackdevcode/dsh-alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { dsh.publishOrder(members) }).toThrow(/no publish order honours @hackdevcode\/dsh-charlie -> @hackdevcode\/dsh-alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/alpha', '@hackdevcode/dsh-alpha', { devDependencies: { '@hackdevcode/dsh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@hackdevcode/dsh-zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@hackdevcode/dsh-alpha',
      '@hackdevcode/dsh-zebra',
    ])
  })

  it('applies the harness payload policy to dsh and keeps upstream payloads for vendored packages', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@hackdevcode/dsh-library')
    const vendored = member('vendor/cordis', '@hackdevcode/cordis')

    expect(() => { dsh.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('dsh').installedEntry).toEqual({ packageName: '@hackdevcode/dsh', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('orders alpha, canary, and release-candidate versions by semver precedence', () => {
    expect(compareVersions('4.0.1-alpha.1', '4.0.1-canary.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-canary.1', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('vendor/cosmokit', '@hackdevcode/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('vendor/cordis', '@hackdevcode/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@hackdevcode/dsh-library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
