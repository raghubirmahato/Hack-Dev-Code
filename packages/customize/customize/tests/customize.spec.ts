import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import type { McpDirectoryControl } from '@hackdevcode/dsh-mcp-directory'
import { RemoteError, remoteMethods } from '@hackdevcode/dsh-typert-protocol'
import Customize from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/** A directory that records what it was asked and answers with fixed rows. */
function fakeDirectory(calls: unknown[][]): McpDirectoryControl {
  const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]) }
  return {
    servers: async () => [{
      id: 'time', title: 'Time', description: 'Clock', homepage: 'https://example.com', custom: false, enabled: true, note: '',
      requires: [], opensFolders: false, roots: [], command: 'npx time', url: '',
    }],
    connectors: async () => [{
      id: 'notion', title: 'Notion', description: 'Notes', homepage: 'https://example.com', url: 'https://example.com/mcp',
      custom: false, added: false, signedIn: false,
    }],
    sites: async () => [{ id: 'reddit', title: 'Reddit', url: 'https://www.reddit.com/', host: 'www.reddit.com', enabled: true, note: '', playbook: false }],
    addSite: async (site) => {
      calls.push(['addSite', site])
      return { id: 'reddit' }
    },
    openSite: record('openSite'),
    removeSite: record('removeSite'),
    skills: async () => [{ id: 'pdf', title: 'PDF', description: 'Read PDFs', license: 'MIT', state: 'no' }],
    setServer: record('setServer'),
    saveCustom: record('saveCustom'),
    removeCustom: async () => { throw new Error('there is no custom server named nope') },
    connect: async (connector) => {
      calls.push(['connect', connector])
      return connector.id === 'notion' ? { authorizeUrl: 'https://example.com/authorize' } : {}
    },
    disconnect: record('disconnect'),
    installSkill: record('installSkill'),
    removeSkill: record('removeSkill'),
  }
}

async function harness(directory?: McpDirectoryControl): Promise<Customize> {
  const ctx = new Context()
  contexts.push(ctx)
  if (directory !== undefined) ctx.provide('mcpDirectory', directory)
  await ctx.plugin(Customize)
  return ctx.get('customize') as Customize
}

describe('Customize', () => {
  it('announces a directory change under its own event name', async () => {
    await harness(fakeDirectory([]))
    let announced = 0
    const bus = contexts.at(-1) as unknown as { on(name: string, listener: () => void): void; emit(name: string): void }
    bus.on('customize/changed', () => { announced += 1 })
    bus.emit('mcp-directory/changed')
    expect(announced).toBe(1)
  })

  it('declares the Remote methods a settings page calls', async () => {
    const customize = await harness(fakeDirectory([]))
    expect(remoteMethods(customize).map(entry => entry.method).sort()).toEqual([
      'addSite', 'connect', 'disconnect', 'installSkill', 'openSite', 'read', 'removeCustom', 'removeSite', 'removeSkill', 'saveCustom', 'setServer',
    ])
  })

  it('reads servers, connectors and skills in one snapshot', async () => {
    const customize = await harness(fakeDirectory([]))
    const snapshot = await customize.read()
    expect(snapshot.servers.map(server => server.id)).toEqual(['time'])
    expect(snapshot.connectors.map(connector => connector.id)).toEqual(['notion'])
    expect(snapshot.sites.map(site => site.id)).toEqual(['reddit'])
    expect(snapshot.skills.map(skill => skill.id)).toEqual(['pdf'])
  })

  it('forwards each change to the directory', async () => {
    const calls: unknown[][] = []
    const customize = await harness(fakeDirectory(calls))
    await customize.setServer('time', { enabled: false })
    await customize.saveCustom('mine', { enabled: true, command: 'node server.js' })
    await customize.disconnect('notion')
    await customize.installSkill('pdf')
    await customize.removeSkill('pdf')
    expect(calls).toEqual([
      ['setServer', 'time', { enabled: false }],
      ['saveCustom', 'mine', { enabled: true, command: 'node server.js' }],
      ['disconnect', 'notion'],
      ['installSkill', 'pdf'],
      ['removeSkill', 'pdf'],
    ])
  })

  it('adds, reopens and removes a website session', async () => {
    const calls: unknown[][] = []
    const customize = await harness(fakeDirectory(calls))
    expect(await customize.addSite({ url: 'reddit.com' })).toEqual({ id: 'reddit' })
    await customize.openSite('reddit')
    await customize.removeSite('reddit')
    expect(calls).toEqual([['addSite', { url: 'reddit.com' }], ['openSite', 'reddit'], ['removeSite', 'reddit']])
  })

  it('returns the sign-in link only when the directory gives one', async () => {
    const customize = await harness(fakeDirectory([]))
    expect(await customize.connect({ id: 'notion' })).toEqual({ authorizeUrl: 'https://example.com/authorize' })
    expect(await customize.connect({ id: 'linear' })).toEqual({})
  })

  it('reports a refused change with the directory\'s reason', async () => {
    const customize = await harness(fakeDirectory([]))
    const error = await customize.removeCustom('nope').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RemoteError)
    expect((error as RemoteError).code).toBe('customize/failed')
    expect((error as RemoteError).message).toContain('no custom server named nope')
  })

  it('reports a refusal that is not an Error by its text', async () => {
    const directory = { ...fakeDirectory([]), installSkill: async () => { throw 'the disk is full' } }
    const customize = await harness(directory)
    const error = await customize.installSkill('pdf').catch((caught: unknown) => caught)
    expect((error as RemoteError).code).toBe('customize/failed')
    expect((error as RemoteError).message).toBe('the disk is full')
  })

  it('reports a deployment without a directory', async () => {
    const customize = await harness()
    const error = await customize.read().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RemoteError)
    expect((error as RemoteError).code).toBe('customize/unavailable')
  })
})
