import { describe, expect, it, onTestFinished } from 'vitest'
import { Context, Service } from '@hackdevcode/cordis'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SkillRegistry from '@hackdevcode/dsh-skill'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import * as Directory from '../src/index.ts'
import { ConnectorAuth } from '../src/oauth.ts'
import type { AuthRunner, ConnectorGrant, CustomServer, GrantStore, ServerChoice, SiteBrowser, SiteEntry } from '../src/index.ts'

const { CONNECTORS, DIRECTORY, OAUTH_CALLBACK_PATH, customConfig } = Directory

/** An authorization flow that hands out a link first and tokens once a code arrives. */
const fakeRunner: AuthRunner = async (provider, options) => {
  if (options.authorizationCode === undefined) {
    if (await provider.tokens() !== undefined) return 'AUTHORIZED'
    if (await provider.clientInformation() === undefined) {
      await provider.saveClientInformation?.({ client_id: 'client-1', redirect_uris: [String(provider.redirectUrl)] })
    }
    await provider.saveCodeVerifier('verifier')
    const state = await provider.state?.()
    await provider.redirectToAuthorization(new URL(`https://auth.example.test/authorize?state=${state ?? ''}`))
    return 'REDIRECT'
  }
  if (options.authorizationCode !== 'good' || await provider.codeVerifier() !== 'verifier') return 'REDIRECT'
  await provider.saveTokens({ access_token: 'token-1', token_type: 'Bearer' })
  return 'AUTHORIZED'
}

function memoryStore(): GrantStore & { grants: Map<string, ConnectorGrant> } {
  const grants = new Map<string, ConnectorGrant>()
  return {
    grants,
    read: id => Promise.resolve(grants.get(id)),
    write: (id, change) => { grants.set(id, change(grants.get(id))); return Promise.resolve() },
    remove: (id) => { grants.delete(id); return Promise.resolve() },
  }
}

describe('ConnectorAuth', () => {
  it('carries a sign-in from the authorization link to stored tokens', async () => {
    const store = memoryStore()
    const changed: string[] = []
    const auth = new ConnectorAuth(store, () => 'http://127.0.0.1:3080/mcp/oauth/callback', id => changed.push(id), fakeRunner)
    expect(await auth.signedIn('notion')).toBe(false)
    const { authorizeUrl } = await auth.begin('notion', 'https://mcp.example.test/mcp')
    const state = new URL(authorizeUrl!).searchParams.get('state')!
    expect(state.length).toBeGreaterThan(20)
    await expect(auth.finish('someone-else', 'good')).rejects.toThrow('no longer valid')
    expect(await auth.finish(state, 'good')).toBe('notion')
    expect(await auth.signedIn('notion')).toBe(true)
    expect(changed).toEqual(['notion'])
    expect(store.grants.get('notion')).toMatchObject({ client: { client_id: 'client-1' }, tokens: { access_token: 'token-1' } })
    // The link is spent: the same state cannot finish twice.
    await expect(auth.finish(state, 'good')).rejects.toThrow('no longer valid')
    expect(await auth.begin('notion', 'https://mcp.example.test/mcp')).toEqual({})
    await auth.forget('notion')
    expect(await auth.signedIn('notion')).toBe(false)
  })

  it('rejects a refused code, a verifier from another attempt and a missing Web UI', async () => {
    const auth = new ConnectorAuth(memoryStore(), () => 'http://127.0.0.1:3080/mcp/oauth/callback', () => {}, fakeRunner)
    const { authorizeUrl } = await auth.begin('linear', 'https://mcp.example.test/mcp')
    await expect(auth.finish(new URL(authorizeUrl!).searchParams.get('state')!, 'bad')).rejects.toThrow('did not accept')
    expect(() => auth.provider('linear').codeVerifier()).toThrow('not started here')
    expect(auth.provider('linear').clientMetadata).toMatchObject({ token_endpoint_auth_method: 'none', response_types: ['code'] })
    const silent = new ConnectorAuth(memoryStore(), () => 'http://127.0.0.1:3080/cb', () => {}, () => Promise.resolve('REDIRECT'))
    await expect(silent.begin('linear', 'https://mcp.example.test/mcp')).rejects.toThrow('did not give an authorization link')
    const headless = new ConnectorAuth(memoryStore(), () => undefined, () => {}, fakeRunner)
    await expect(headless.begin('linear', 'https://mcp.example.test/mcp')).rejects.toThrow('needs the Web UI')
  })

  it('does not reuse a client registered for another callback address', async () => {
    const store = memoryStore()
    let origin = 'http://127.0.0.1:3080'
    const auth = new ConnectorAuth(store, () => `${origin}/cb`, () => {}, fakeRunner)
    await auth.begin('sentry', 'https://mcp.example.test/mcp')
    expect(await auth.provider('sentry').clientInformation()).toMatchObject({ client_id: 'client-1' })
    origin = 'http://127.0.0.1:4000'
    expect(await auth.provider('sentry').clientInformation()).toBeUndefined()
  })
})

describe('customConfig', () => {
  it('builds a local or a remote client, and says what is missing', () => {
    expect(customConfig('mine', { enabled: true, title: 'Mine', command: 'node', args: ['server.js'], env: { A: 'b' } })).toMatchObject({
      config: { transport: 'stdio', serverName: 'mine', command: 'node', args: ['server.js'], env: { A: 'b' }, toolGroup: { name: 'mcp-mine' } },
    })
    expect(customConfig('far', { enabled: true, url: 'https://example.test/mcp', headers: { 'X-Key': 'k' } })).toMatchObject({
      config: { transport: 'streamable-http', serverName: 'far', url: 'https://example.test/mcp', headers: { 'X-Key': 'k' } },
    })
    expect(customConfig('far', { enabled: true, url: 'file:///etc/passwd' })).toEqual({ note: 'the address is not an http or https URL' })
    expect(customConfig('none', { enabled: true, command: ' ' })).toEqual({ note: 'needs a command or an address' })
  })
})

describe('the mcpDirectory service', () => {
  interface Start {
    servers?: Record<string, ServerChoice>
    custom?: Record<string, CustomServer>
    connectors?: Record<string, { enabled: boolean; title?: string; url: string }>
    sites?: Record<string, SiteEntry>
    webServer?: boolean
    /** The browser website sessions find; none when null. */
    browser?: SiteBrowser | null
    skills?: boolean
  }

  async function mount(start: Start = {}) {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const state = { servers: start.servers ?? {}, custom: start.custom ?? {}, connectors: start.connectors ?? {}, sites: start.sites ?? {} }
    const home = await mkdtemp(join(tmpdir(), 'hackdev-directory-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const launched: { path: string; args: readonly string[] }[] = []
    if (start.skills === true) await ctx.plugin(SkillRegistry)
    const updates: object[] = []
    class Settings extends Service {
      constructor(inner: Context) { super(inner, 'settings') }
      update(_ns: string, patch: object) { updates.push(patch); Object.assign(state, patch); return Promise.resolve() }
    }
    await ctx.plugin(Settings)
    const stored = new Map<string, string>()
    const records = new Map<string, { kind: string; payload: unknown }>()
    class Credentials extends Service {
      constructor(inner: Context) { super(inner, 'credentials') }
      set(ref: string, value: string) { stored.set(ref, value); return Promise.resolve() }
      resolve(ref: string) { const value = stored.get(ref); return Promise.resolve(value === undefined ? undefined : { value, source: 'file' }) }
      readRecord(key: string) { return Promise.resolve(records.get(key)) }
      async modifyRecord(key: string, change: (current: unknown) => Promise<{ kind: string; payload: unknown } | undefined>) {
        const next = await change(records.get(key))
        if (next === undefined) records.delete(key)
        else records.set(key, next)
      }
      deleteRecord(key: string) { records.delete(key); return Promise.resolve() }
    }
    await ctx.plugin(Credentials)
    const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => unknown>()
    if (start.webServer !== false) {
      class WebServer extends Service {
        constructor(inner: Context) { super(inner, 'webServer') }
        getOrigin() { return 'http://127.0.0.1:3080' }
        register(route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }) {
          routes.set(route.path, route.handler)
          return () => { routes.delete(route.path) }
        }
      }
      await ctx.plugin(WebServer)
    }
    let changes = 0
    ctx.on('mcp-directory/changed', () => { changes += 1 })
    const fiber = ctx.plugin({
      name: 'mcp-directory-test',
      inject: Directory.inject,
      apply: (inner: Context) => {
        Object.defineProperty(inner.fiber, 'entry', { value: { options: { id: 'mcp-directory' } } })
        return Directory.apply(inner, {
          servers: { get: () => state.servers }, custom: { get: () => state.custom }, connectors: { get: () => state.connectors },
          sites: { get: () => state.sites },
          authRunner: fakeRunner,
          home,
          browserFinder: () => start.browser === null ? undefined : start.browser ?? { path: '/opt/chrome', channel: 'chrome' },
          browserLauncher: (path, args) => { launched.push({ path, args }) },
        })
      },
    })
    await fiber
    /** Calls the sign-in callback the way the browser would and returns what it answered. */
    const callback = async (url: string, method = 'GET') => {
      let status = 0
      let body = ''
      const res = { writeHead: (code: number) => { status = code }, end: (text: string) => { body = text } } as unknown as ServerResponse
      await routes.get(OAUTH_CALLBACK_PATH)?.({ url, method } as IncomingMessage, res)
      return { status, body }
    }
    return { ctx, fiber, control: ctx.get('mcpDirectory')!, state, updates, stored, records, routes, callback, changes: () => changes, home, launched }
  }

  it('lists directory servers and the person\'s own with their state', async () => {
    const { control, stored } = await mount({
      servers: { github: { enabled: true }, filesystem: { enabled: false, roots: ['/work'] } },
      custom: { mine: { enabled: false, title: 'Mine', command: 'node', args: ['server.js'] }, far: { enabled: false, url: 'https://example.test/mcp' } },
    })
    const rows = await control.servers()
    expect(rows).toHaveLength(DIRECTORY.length + 2)
    expect(rows.find(row => row.id === 'github')).toMatchObject({
      enabled: true, custom: false, note: 'needs GITHUB_PERSONAL_ACCESS_TOKEN', requires: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', set: false }],
    })
    expect(rows.find(row => row.id === 'filesystem')).toMatchObject({ enabled: false, opensFolders: true, roots: ['/work'] })
    expect(rows.find(row => row.id === 'mine')).toMatchObject({ custom: true, title: 'Mine', command: 'node server.js', url: '' })
    expect(rows.find(row => row.id === 'far')).toMatchObject({ custom: true, title: 'far', command: '', url: 'https://example.test/mcp' })
    stored.set('GITHUB_PERSONAL_ACCESS_TOKEN', 'x')
    expect((await control.servers()).find(row => row.id === 'github')?.requires[0]?.set).toBe(true)
  })

  it('turns servers on and off, keeping keys in the credential store', async () => {
    const { control, updates, stored, state } = await mount({ custom: { mine: { enabled: false, command: 'node' } } })
    await control.setServer('brave-search', { enabled: false })
    expect(updates).toEqual([])
    await expect(control.setServer('brave-search', { enabled: true, keys: { OTHER: 'x' } })).rejects.toThrow('does not use a key named OTHER')
    // A blank key is left alone; a server whose key is missing is on and says what it needs.
    await control.setServer('brave-search', { enabled: true, keys: { BRAVE_API_KEY: ' ' } })
    expect(stored.size).toBe(0)
    expect(updates).toEqual([{ servers: { 'brave-search': { enabled: true } } }])
    await control.setServer('brave-search', { enabled: false })
    expect(state.servers).toEqual({ 'brave-search': { enabled: false } })
    await control.setServer('filesystem', { enabled: false, roots: ['/a'] })
    expect(state.servers).not.toHaveProperty('filesystem')
    await control.setServer('mine', { enabled: false })
    expect(state.custom).toEqual({ mine: { enabled: false, command: 'node' } })
    await expect(control.setServer('nothing', { enabled: true })).rejects.toThrow('no server has the id "nothing"')
  })

  it('saves and removes the person\'s own servers, refusing bad ids and incomplete servers', async () => {
    const { control, state } = await mount({ connectors: { taken: { enabled: false, url: 'https://example.test/mcp' } } })
    await expect(control.saveCustom('Bad Id', { enabled: false, command: 'node' })).rejects.toThrow('lowercase letters')
    await expect(control.saveCustom('github', { enabled: false, command: 'node' })).rejects.toThrow('directory server')
    await expect(control.saveCustom('taken', { enabled: false, command: 'node' })).rejects.toThrow('already used by a connector')
    await expect(control.saveCustom('mine', { enabled: false })).rejects.toThrow('needs a command or an address')
    await control.saveCustom('mine', { enabled: false, command: 'node', args: ['s.js'] })
    expect(state.custom).toEqual({ mine: { enabled: false, command: 'node', args: ['s.js'] } })
    await control.removeCustom('mine')
    expect(state.custom).toEqual({})
  })

  it('adds a connector, signs in through the browser callback and signs out again', async () => {
    const { ctx, control, state, records, callback, changes } = await mount({ custom: { used: { enabled: false, command: 'node' } } })
    expect((await control.connectors()).map(row => row.id)).toEqual(CONNECTORS.map(connector => connector.id))
    await expect(control.connect({ id: 'used', url: 'https://example.test/mcp' })).rejects.toThrow('already used by a server')
    await expect(control.connect({ id: 'mine' })).rejects.toThrow('http or https address')
    await expect(control.connect({ id: 'mine', url: 'ftp://example.test' })).rejects.toThrow('http or https address')

    // The connector is added switched off here so the test never opens a connection to the real service.
    const { authorizeUrl } = await control.connect({ id: 'mine', url: 'https://example.test/mcp', title: 'Mine' })
    expect(state.connectors).toEqual({ mine: { enabled: true, title: 'Mine', url: 'https://example.test/mcp' } })
    state.connectors = { mine: { enabled: false, title: 'Mine', url: 'https://example.test/mcp' } }
    expect((await control.connectors()).at(-1)).toMatchObject({ id: 'mine', title: 'Mine', custom: true, added: true, signedIn: false })
    expect(ctx.get('mcpAuth')?.provider('mine')).toBeDefined()
    expect(ctx.get('mcpAuth')?.provider('notion')).toBeUndefined()

    expect(await callback('/mcp/oauth/callback?state=x')).toMatchObject({ status: 400 })
    expect(await callback('/mcp/oauth/callback?state=nope&code=good')).toMatchObject({ status: 400 })
    const state1 = new URL(authorizeUrl!).searchParams.get('state')!
    expect(await callback(`/mcp/oauth/callback?state=${state1}&code=good`, 'POST')).toMatchObject({ status: 400 })
    const before = changes()
    const done = await callback(`/mcp/oauth/callback?state=${state1}&code=good`)
    expect(done.status).toBe(200)
    expect(done.body).toContain('Connected')
    expect(done.body).not.toContain(state1)
    expect(records.get('mcp-directory/mine')).toMatchObject({ kind: 'grant', payload: { tokens: { access_token: 'token-1' } } })
    expect((await control.connectors()).at(-1)).toMatchObject({ signedIn: true })
    await expect.poll(changes).toBeGreaterThan(before)

    await control.disconnect('mine')
    expect(records.has('mcp-directory/mine')).toBe(false)
    expect(state.connectors).toEqual({})
  })

  it('adds a catalog connector by id alone', async () => {
    const { control, state } = await mount()
    const { authorizeUrl } = await control.connect({ id: 'notion' })
    expect(authorizeUrl).toContain('https://auth.example.test/authorize')
    expect(state.connectors).toEqual({ notion: { enabled: true, title: 'Notion', url: CONNECTORS.find(connector => connector.id === 'notion')!.url } })
    state.connectors = {}
  })

  it('cannot sign in without the Web UI', async () => {
    const { control, routes } = await mount({ webServer: false })
    expect(routes.size).toBe(0)
    await expect(control.connect({ id: 'mine', url: 'https://example.test/mcp' })).rejects.toThrow('needs the Web UI')
  })

  it('lists directory skills and refuses unknown ones', async () => {
    const { control } = await mount()
    const skills = await control.skills()
    expect(skills.length).toBeGreaterThan(0)
    expect(skills[0]).toMatchObject({ id: 'code-review', state: 'builtin' })
    expect(skills.at(-1)?.id).toEqual(expect.any(String))
    expect(skills.at(-1)?.state).toMatch(/^(directory|other|no)$/u)
    // A built-in skill needs no install and cannot be removed.
    await expect(control.installSkill('code-review')).rejects.toThrow('no directory skill')
    await expect(control.installSkill('nothing')).rejects.toThrow('no directory skill')
    await expect(control.removeSkill('nothing')).rejects.toThrow('no directory skill')
  })

  it('adds a website session: opens the sign-in window on its own profile and mounts a browser on that profile', async () => {
    const { control, state, launched, home, updates } = await mount()
    expect(await control.sites()).toEqual([])
    const { id } = await control.addSite({ url: 'www.reddit.com/login', title: 'Reddit' })
    expect(id).toBe('reddit')
    const profile = join(home, 'site-sessions', 'reddit', 'profile')
    expect(launched).toEqual([{ path: '/opt/chrome', args: Directory.signInArgs(profile, 'https://www.reddit.com/login') }])
    expect((await stat(profile)).isDirectory()).toBe(true)
    expect(state.sites).toEqual({ reddit: { enabled: true, title: 'Reddit', url: 'https://www.reddit.com/login' } })
    expect(updates.at(-1)).toEqual({ sites: state.sites })
    expect(await control.sites()).toEqual([{
      id: 'reddit', title: 'Reddit', url: 'https://www.reddit.com/login', host: 'www.reddit.com', enabled: true, note: '', playbook: false,
    }])
    // Signing in again reuses the session instead of making a second one.
    expect((await control.addSite({ url: 'https://reddit.com' })).id).toBe('reddit')
    await control.openSite('reddit')
    expect(launched).toHaveLength(3)
  })

  it('refuses a link that is not a website and a session without a browser', async () => {
    const { control } = await mount()
    await expect(control.addSite({ url: 'not a link' })).rejects.toThrow('enter the website')
    await expect(control.addSite({ url: 'file:///etc/passwd' })).rejects.toThrow('enter the website')
    await expect(control.openSite('nothing')).rejects.toThrow('no website session')
    const bare = await mount({ browser: null, sites: { reddit: { enabled: true, url: 'https://www.reddit.com/' } } })
    await expect(bare.control.addSite({ url: 'github.com' })).rejects.toThrow('no Chrome, Edge or Chromium')
    expect((await bare.control.sites())[0]!.note).toBe('needs Chrome, Edge or Chromium installed')
  })

  it('names a session apart from a server that already holds the name', async () => {
    const { control } = await mount()
    // `github` is a directory server, so the website session gets a suffix.
    expect((await control.addSite({ url: 'https://github.com/login' })).id).toBe('github-site')
  })

  it('records a playbook through the site_connector tool and removes the session with its profile', async () => {
    const { ctx, control, home, state } = await mount({ sites: { reddit: { enabled: true, url: 'https://www.reddit.com/' } } })
    const run = async (args: Record<string, unknown>) => {
      const result = await executeToolFixture(ctx, { name: 'site_connector', callId: ToolCallId('c1'), arguments: args, signal: new AbortController().signal })
      return { isError: result.isError, text: result.content.map(block => block.type === 'text' ? block.text : '').join('') }
    }
    expect((await run({ action: 'list' })).text).toContain('reddit (www.reddit.com, www.reddit.com) [ready]: tools in group mcp-reddit, instructions in skill site-reddit')
    await run({ action: 'learn', id: 'reddit', notes: '## Post to a subreddit\nOpen /r/<name>/submit.' })
    await run({ action: 'learn', id: 'reddit', notes: 'Wait for the "Post" button to enable.' })
    const playbook = await readFile(join(home, 'site-sessions', 'reddit', 'PLAYBOOK.md'), 'utf8')
    expect(playbook).toContain('Open /r/<name>/submit.')
    expect(playbook).toContain('Wait for the "Post" button')
    expect((await control.sites())[0]!.playbook).toBe(true)
    await run({ action: 'learn', id: 'reddit', notes: 'Rewritten.', replace: true })
    expect(await readFile(join(home, 'site-sessions', 'reddit', 'PLAYBOOK.md'), 'utf8')).toBe('Rewritten.\n')
    expect(await run({ action: 'learn', id: 'reddit', notes: 'x'.repeat(21_000) })).toMatchObject({ isError: true, text: expect.stringContaining('the limit is 20000') as string })
    expect(await run({ action: 'learn', id: 'nope', notes: 'x' })).toMatchObject({ isError: true, text: expect.stringContaining('no website session') as string })
    expect(await run({ action: 'dance' })).toMatchObject({ isError: true, text: expect.stringContaining('action must be') as string })
    await control.removeSite('reddit')
    expect(state.sites).toEqual({})
    await expect(stat(join(home, 'site-sessions', 'reddit'))).rejects.toThrow()
  })

  it('provides the built-in skills and one skill per website session from memory', async () => {
    const { ctx, control } = await mount({ skills: true, sites: { reddit: { enabled: true, title: 'Reddit', url: 'https://www.reddit.com/' }, off: { enabled: false, url: 'https://off.example.com/' } } })
    const names = (await ctx.skills.list()).map(skill => skill.name)
    expect(names).toEqual(expect.arrayContaining(['code-review', 'systematic-debugging', 'test-first', 'git-commit-and-pr', 'security-review', 'web-research', 'site-reddit']))
    expect(names).not.toContain('site-off')
    const review = await ctx.skills.get('code-review')
    expect(review?.content).toContain('# Code review')
    expect(review?.source).toBe('bundled')
    const site = await ctx.skills.get('site-reddit')
    expect(site?.content).toContain('Load the tools with the group `mcp-reddit`')
    expect(site?.content).toContain('Nothing is recorded for www.reddit.com yet')
    await executeToolFixture(ctx, {
      name: 'site_connector', callId: ToolCallId('c2'), arguments: { action: 'learn', id: 'reddit', notes: 'Search lives at /search.' }, signal: new AbortController().signal,
    })
    // The playbook is part of the skill the next session loads.
    expect((await ctx.skills.get('site-reddit'))?.content).toContain('Search lives at /search.')
    await control.removeSite('reddit')
  })

  it('removes its service, its sign-in seam and its callback route when disposed', async () => {
    const { ctx, fiber, routes } = await mount()
    expect(routes.has(OAUTH_CALLBACK_PATH)).toBe(true)
    await fiber.dispose()
    expect(routes.has(OAUTH_CALLBACK_PATH)).toBe(false)
    expect(ctx.get('mcpDirectory')).toBeUndefined()
    expect(ctx.get('mcpAuth')).toBeUndefined()
  })
})
