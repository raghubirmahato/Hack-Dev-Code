import { describe, expect, it, onTestFinished } from 'vitest'
import { Context, Service } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import * as Directory from '../src/index.ts'
import type { ServerChoice } from '../src/index.ts'

const { DIRECTORY, clientConfig, findServer } = Directory

describe('the directory catalog', () => {
  it('has unique, valid server names and documents every server', () => {
    const ids = DIRECTORY.map(server => server.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const server of DIRECTORY) {
      expect(server.id).toMatch(/^[a-z0-9-]{1,32}$/u)
      expect(server.homepage).toMatch(/^https:\/\//u)
      expect(server.description.length).toBeGreaterThan(10)
    }
  })

  it('finds a server by id or title', () => {
    expect(findServer('github')?.id).toBe('github')
    expect(findServer('Brave Search')?.id).toBe('brave-search')
    expect(findServer('sequential_thinking')?.id).toBe('sequential-thinking')
    expect(findServer('nothing')).toBeUndefined()
  })

  it('builds a stdio client with folders and an on-demand tool group', () => {
    const built = clientConfig(findServer('filesystem')!, { enabled: true, roots: ['/work/a', '/work/b'] }, {}, '/start')
    expect(built).toMatchObject({
      config: {
        transport: 'stdio', serverName: 'filesystem', command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/work/a', '/work/b'],
        toolGroup: { name: 'mcp-filesystem' },
      },
    })
    expect(clientConfig(findServer('filesystem')!, { enabled: true }, {}, '/start')).toMatchObject({ config: { args: ['-y', '@modelcontextprotocol/server-filesystem', '/start'] } })
  })

  it('fills a key into an HTTP header from the choice or the environment, and names a missing one', () => {
    const github = findServer('github')!
    expect(clientConfig(github, { enabled: true }, {}, '/')).toEqual({ missing: ['GITHUB_PERSONAL_ACCESS_TOKEN'] })
    expect(clientConfig(github, { enabled: true }, { GITHUB_PERSONAL_ACCESS_TOKEN: 'from-env' }, '/'))
      .toMatchObject({ config: { transport: 'streamable-http', headers: { Authorization: 'Bearer from-env' } } })
    expect(clientConfig(findServer('brave-search')!, { enabled: true, env: { BRAVE_API_KEY: 'chosen' } }, {}, '/'))
      .toMatchObject({ config: { env: { BRAVE_API_KEY: 'chosen' } } })
  })
})

describe('the mcp_directory tool', () => {
  async function mount(servers: Record<string, ServerChoice> = {}, sandboxMode?: string) {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const updates: { ns: string; patch: object }[] = []
    class Settings extends Service {
      constructor(inner: Context) { super(inner, 'settings') }
      update(ns: string, patch: object) { updates.push({ ns, patch }); return Promise.resolve() }
    }
    await ctx.plugin(Settings)
    const stored = new Map<string, string>()
    class Credentials extends Service {
      constructor(inner: Context) { super(inner, 'credentials') }
      set(ref: string, value: string) { stored.set(ref, value); return Promise.resolve() }
      resolve(ref: string) { const value = stored.get(ref); return Promise.resolve(value === undefined ? undefined : { value, source: 'file' }) }
    }
    await ctx.plugin(Credentials)
    if (sandboxMode !== undefined) {
      class Policy extends Service {
        constructor(inner: Context) { super(inner, 'sandboxPolicy') }
        resolve() { return { mode: sandboxMode } }
      }
      await ctx.plugin(Policy)
    }
    await ctx.plugin({
      name: 'mcp-directory-test',
      inject: Directory.inject,
      apply: (inner: Context) => {
        Object.defineProperty(inner.fiber, 'entry', { value: { options: { id: 'mcp-directory' } } })
        const none = { get: () => ({}) }
        return Directory.apply(inner, { servers: { get: () => servers }, custom: none, connectors: none, sites: none })
      },
    })
    const call = async (args: Record<string, unknown>) => {
      const result = await executeToolFixture(ctx, { name: 'mcp_directory', callId: ToolCallId('d'), arguments: args, signal: new AbortController().signal })
      return { isError: result.isError, text: result.content.map(block => block.type === 'text' ? block.text : '').join('') }
    }
    return { call, updates, stored }
  }

  it('lists every server with its state and the keys it needs', async () => {
    const { call } = await mount({ github: { enabled: true } })
    const listed = (await call({ action: 'list' })).text
    expect(listed).toContain('github (GitHub) [on, needs GITHUB_PERSONAL_ACCESS_TOKEN]')
    expect(listed).toContain('playwright (Playwright browser) [off]')
    expect(listed.split('\n')).toHaveLength(DIRECTORY.length)
  })

  it('turns a server on through settings and reports how to load its tools', async () => {
    const { call, updates } = await mount()
    const added = await call({ action: 'add', server: 'Context7 library docs' })
    expect(added.text).toContain('Turned on Context7 library docs')
    expect(added.text).toContain('group mcp-context7')
    expect(updates).toEqual([{ ns: 'mcp-directory', patch: { servers: { context7: { enabled: true } } } }])
  })

  it('asks for a missing key, and keeps a given key in the credential store rather than the profile', async () => {
    const { call, updates, stored } = await mount()
    const added = await call({ action: 'add', server: 'brave-search' })
    expect(added.text).toContain('needs BRAVE_API_KEY')
    expect(updates).toEqual([])
    await call({ action: 'add', server: 'brave-search', env: { BRAVE_API_KEY: 'k' } })
    expect(updates).toEqual([{ ns: 'mcp-directory', patch: { servers: { 'brave-search': { enabled: true } } } }])
    expect(stored.get('BRAVE_API_KEY')).toBe('k')
    expect((await call({ action: 'add', server: 'brave-search', env: { OTHER_KEY: 'x' } })).text).toContain('does not use a key named OTHER_KEY')
  })

  it('refuses to start third-party code from a read-only session without approval', async () => {
    const { call, updates } = await mount({}, 'read-only')
    const added = await call({ action: 'add', server: 'filesystem', roots: ['C:/'] })
    expect(added.isError).toBe(true)
    expect(added.text).toContain('requires approval')
    expect(updates).toEqual([])
    expect((await call({ action: 'list' })).isError).toBe(false)
  })

  it('turns a server off, and explains unknown servers and actions', async () => {
    const { call, updates } = await mount({ time: { enabled: false }, memory: { enabled: false } })
    expect((await call({ action: 'remove', server: 'time' })).text).toContain('already off')
    expect((await call({ action: 'add', server: 'teleporter' })).text).toContain('no directory server is named')
    expect((await call({ action: 'install' })).text).toContain('action must be list, add or remove')
    expect(updates).toEqual([])
  })
})
