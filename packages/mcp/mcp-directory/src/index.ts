/**
 * The MCP server directory: a curated catalog of well-known MCP servers that the person, or an agent on their
 * behalf, turns on with one choice. Each enabled server runs as its own `mcp-client` instance, mounted and removed
 * live as the choice changes, with its tools in an on-demand group so they cost nothing until an agent loads them.
 * Choices live in this entry's volatile `servers` setting, which Settings forms and the `mcp_directory` tool edit.
 * The person's own servers (`custom`) and connectors (`connectors`: remote servers signed in to with OAuth) mount
 * the same way. The `mcpDirectory` service is the same set of changes for a settings page, and `mcpAuth` hands a
 * connector's connection its sign-in.
 * @module @hackdevcode/dsh-mcp-directory
 */

import type { Context, Fiber } from '@hackdevcode/cordis'
import type { Volatile } from '@hackdevcode/cosmokit'
import z from '@hackdevcode/schemastery'
import * as McpClient from '@hackdevcode/dsh-mcp-client'
import { defineTool } from '@hackdevcode/dsh-tools'
import type {} from '@hackdevcode/dsh-settings'
import type {} from '@hackdevcode/cordis-plugin-loader'
import { join } from 'node:path'
import { resolveDshHome } from '@hackdevcode/dsh-home-paths'
import { credentialRef } from '@hackdevcode/dsh-credentials'
import { approveEscalation } from '@hackdevcode/dsh-sandbox'
import type {} from '@hackdevcode/dsh-sandbox-policy'
import type {} from '@hackdevcode/dsh-user-approval'
import type { ToolRunContext } from '@hackdevcode/dsh-tools'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@hackdevcode/dsh-host-webserver'
import { credentialKey } from '@hackdevcode/dsh-credentials'
import { CONNECTORS, DIRECTORY, findServer } from './catalog.ts'
import { ConnectorAuth } from './oauth.ts'
import { findSkill, installSkill, removeSkill, SKILLS, skillState } from './skills.ts'
import type { DirectoryServer } from './catalog.ts'
import type { AuthRunner, ConnectorGrant, GrantStore } from './oauth.ts'
import type { ConnectorStatus, CustomServer, McpDirectoryControl, ServerStatus } from './types.ts'

export { CONNECTORS, DIRECTORY, findServer } from './catalog.ts'
export type { DirectoryConnector, DirectoryServer } from './catalog.ts'
export { ConnectorAuth } from './oauth.ts'
export type { AuthRunner, ConnectorGrant, GrantStore } from './oauth.ts'
export type {
  ConnectorChoice, ConnectorStatus, CustomServer, McpDirectoryControl, ServerChange, ServerStatus, SkillStatus,
} from './types.ts'

declare module '@hackdevcode/cordis' {
  interface Context {
    /** The server, connector and skill directory, for a settings page. */
    mcpDirectory: McpDirectoryControl
  }
  interface Events {
    /** A server, connector or skill was turned on, off, added, removed, signed in to or signed out of.
     * @mode emit
     */
    'mcp-directory/changed'(): void
  }
}

/** The browser callback path a connector's authorization server redirects to. */
export const OAUTH_CALLBACK_PATH = '/mcp/oauth/callback'

/** Ids a custom server or connector may use: also an MCP server name and a credential key segment. */
const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u
export { INSTALLED_MARKER, SKILLS, findSkill, installSkill, removeSkill, skillState } from './skills.ts'
export type { DirectorySkill, GitRunner } from './skills.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-directory'

/** Services required: the tool registry. Settings is optional and read when a choice is saved. */
export const inject = ['tools']

/** One server the person turned on. */
export interface ServerChoice {
  /** Run the server; a choice turned off keeps its keys and folders for later. */
  enabled: boolean
  /**
   * Values typed into the profile by hand for the keys the server requires. Prefer the credential store: a key left
   * out here is read from it, under the key's own name, and then from the environment Hack Dev Code started in.
   */
  env?: Readonly<Record<string, string>> | undefined
  /** Folders for a server that opens folders, such as filesystem. */
  roots?: readonly string[] | undefined
}

/** One connector the person added. */
export interface ConnectorEntry {
  /** Use the connector; a choice turned off keeps its sign-in for later. */
  enabled: boolean
  /** Name shown for a connector that is not in the directory. */
  title?: string | undefined
  /** The connector's MCP address. */
  url: string
}

/** Plugin config. */
export interface Config {
  /** Chosen servers by directory id; edited live by Settings and `mcp_directory`. */
  servers: Volatile<Record<string, ServerChoice>>
  /** The person's own MCP servers by id. */
  custom: Volatile<Record<string, CustomServer>>
  /** Connectors the person added, by id. */
  connectors: Volatile<Record<string, ConnectorEntry>>
  /** Test seam: the OAuth flow; the MCP SDK's when unset. */
  authRunner?: AuthRunner | undefined
}

export const Config: z<Config> = z.object({
  servers: z.dict(z.object({
    enabled: z.boolean().default(true),
    env: z.dict(z.string().role('secret')),
    roots: z.array(String),
  })).default({}).volatile(),
  custom: z.dict(z.object({
    enabled: z.boolean().default(true),
    title: z.string(),
    command: z.string(),
    args: z.array(String),
    env: z.dict(z.string().role('secret')),
    url: z.string(),
    headers: z.dict(z.string().role('secret')),
  })).default({}).volatile(),
  connectors: z.dict(z.object({
    enabled: z.boolean().default(true),
    title: z.string(),
    url: z.string().required(),
  })).default({}).volatile(),
}) as z<Config>

/**
 * The mcp-client config that starts one of the person's own servers.
 * @param id - the server id.
 * @param server - what the person entered.
 * @returns the client config, or a note saying what is missing.
 */
export function customConfig(id: string, server: CustomServer): { config: McpClient.Config } | { note: string } {
  const toolGroup = { name: `mcp-${id}`, description: `${server.title ?? id} MCP server (added by the user).` }
  const shared = { serverName: id, toolGroup, toolCallTimeoutMs: 120_000, failOnStartupError: false }
  if (server.url !== undefined && server.url !== '') {
    if (!URL.canParse(server.url) || !/^https?:$/u.test(new URL(server.url).protocol)) return { note: 'the address is not an http or https URL' }
    return { config: { transport: 'streamable-http', url: server.url, headers: { ...server.headers }, ...shared } as McpClient.Config }
  }
  if (server.command === undefined || server.command.trim() === '') return { note: 'needs a command or an address' }
  return {
    config: { transport: 'stdio', command: server.command, args: [...server.args ?? []], env: { ...server.env }, ...shared } as McpClient.Config,
  }
}

/**
 * The mcp-client config that starts one directory server, or the names of the keys it still needs.
 * @param server - the directory entry.
 * @param choice - the person's choice.
 * @param environment - the environment Hack Dev Code started in.
 * @param defaultRoot - the folder used when a server opens folders and none was chosen.
 * @returns the client config, or the missing key names.
 */
export function clientConfig(
  server: DirectoryServer, choice: ServerChoice, environment: Readonly<Record<string, string | undefined>>, defaultRoot: string,
): { config: McpClient.Config } | { missing: string[] } {
  const values: Record<string, string> = {}
  const missing: string[] = []
  for (const key of server.requires) {
    const value = choice.env?.[key.name] ?? environment[key.name]
    if (value === undefined || value.trim() === '') missing.push(key.name)
    else values[key.name] = value
  }
  if (missing.length > 0) return { missing }
  const fill = (text: string): string => text.replace(/\$\{([A-Z0-9_]+)\}/gu, (whole, key: string) => values[key] ?? whole)
  const toolGroup = { name: `mcp-${server.id}`, description: `${server.title} MCP server: ${server.description}` }
  if (server.launch.transport === 'streamable-http') {
    return {
      config: {
        transport: 'streamable-http', serverName: server.id, url: server.launch.url,
        headers: Object.fromEntries(Object.entries(server.launch.headers).map(([key, value]) => [key, fill(value)])),
        toolGroup, toolCallTimeoutMs: 120_000, failOnStartupError: false,
      } as McpClient.Config,
    }
  }
  const roots = choice.roots !== undefined && choice.roots.length > 0 ? choice.roots : [defaultRoot]
  const args = server.launch.args.flatMap(arg => arg === '${roots}' ? roots : [fill(arg)])
  return {
    config: {
      transport: 'stdio', serverName: server.id, command: server.launch.command, args,
      env: values, toolGroup, toolCallTimeoutMs: 120_000, failOnStartupError: false,
    } as McpClient.Config,
  }
}

/**
 * Mount the chosen servers and register `mcp_directory`.
 * @param ctx - plugin context.
 * @param config - resolved config.
 */
// oxlint-disable-next-line typescript/require-await -- async keeps a load-time failure a rejection
export async function apply(ctx: Context, config: Config): Promise<void> {
  const entryId = ctx.fiber.entry?.options.id
  const skillsDir = join(resolveDshHome(), 'skills')
  /** Running clients by server id, with the config each was started with. */
  const running = new Map<string, { fiber: Fiber; key: string }>()
  const notes = new Map<string, string>()
  const choices = (): Readonly<Record<string, ServerChoice>> => config.servers.get()

  /** The environment a server's keys are read from: the credential store first, then the process environment. */
  const keyEnvironment = async (server: DirectoryServer): Promise<Record<string, string | undefined>> => {
    const credentials = ctx.get('credentials')
    const values: Record<string, string | undefined> = { ...process.env }
    for (const key of server.requires) {
      const stored = await credentials?.resolve(credentialRef(key.name)).catch(() => undefined)
      if (stored !== undefined) values[key.name] = stored.value
    }
    return values
  }
  const grants: GrantStore = {
    async read(id) {
      const record = await ctx.get('credentials')?.readRecord(credentialKey(name, id))
      return record?.kind === 'grant' ? record.payload as ConnectorGrant : undefined
    },
    async write(id, change) {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) throw new Error('no credential store is available to keep the sign-in')
      await credentials.modifyRecord(credentialKey(name, id), current => Promise.resolve({
        kind: 'grant', payload: change(current?.kind === 'grant' ? current.payload as ConnectorGrant : undefined),
      }))
    },
    async remove(id) {
      await ctx.get('credentials')?.deleteRecord(credentialKey(name, id))
    },
  }
  const redirectUrl = (): string | undefined => {
    const webServer = ctx.get('webServer')
    return webServer === undefined ? undefined : `${webServer.getOrigin()}${OAUTH_CALLBACK_PATH}`
  }
  const auth = new ConnectorAuth(grants, redirectUrl, () => { void sync() }, config.authRunner)
  ctx.provide('mcpAuth', { provider: id => Object.hasOwn(config.connectors.get(), id) ? auth.provider(id) : undefined })

  /** What should run: the client config of every server and connector that is on and ready, and a note for the rest. */
  const wanted = async (): Promise<Map<string, { config: McpClient.Config } | { note: string }>> => {
    const result = new Map<string, { config: McpClient.Config } | { note: string }>()
    const chosen = choices()
    for (const server of DIRECTORY) {
      const choice = chosen[server.id]
      if (choice?.enabled !== true) continue
      const built = clientConfig(server, choice, await keyEnvironment(server), process.cwd())
      result.set(server.id, 'missing' in built ? { note: `needs ${built.missing.join(', ')}` } : built)
    }
    for (const [id, server] of Object.entries(config.custom.get())) {
      if (server.enabled && !result.has(id)) result.set(id, customConfig(id, server))
    }
    for (const [id, connector] of Object.entries(config.connectors.get())) {
      if (!connector.enabled || result.has(id)) continue
      result.set(id, await auth.signedIn(id)
        ? customConfig(id, { enabled: true, title: connector.title, url: connector.url })
        : { note: 'needs sign-in' })
    }
    return result
  }
  const syncOnce = async (): Promise<void> => {
    const next = await wanted()
    for (const [id, current] of running) {
      const built = next.get(id)
      if (built === undefined || !('config' in built) || JSON.stringify(built.config) !== current.key) {
        void current.fiber.dispose()
        running.delete(id)
      }
    }
    notes.clear()
    for (const [id, built] of next) {
      if ('note' in built) notes.set(id, built.note)
      else if (!running.has(id)) running.set(id, { fiber: ctx.plugin(McpClient, built.config), key: JSON.stringify(built.config) })
    }
    ctx.emit('mcp-directory/changed')
  }
  // Changes apply one at a time, so two quick edits never start the same server twice.
  let syncing: Promise<void> = Promise.resolve()
  const sync = (): Promise<void> => {
    syncing = syncing.then(syncOnce).catch((error: unknown) => { ctx.logger.warn('mcp-directory: could not apply the server choices: %s', error) })
    return syncing
  }
  ctx.on('loader/volatile-update', () => { void sync() })
  void sync()

  /** Changes that start code or write outside the workspace need full access or the person's approval for this call. */
  const approve = async (exec: ToolRunContext, what: string): Promise<void> => {
    const policy = ctx.get('sandboxPolicy')
    if (policy === undefined) return
    const mode = policy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session }).mode
    await approveEscalation({
      requestedMode: 'danger-full-access', effectiveMode: mode, subject: what,
      justification: `${what}. It downloads and runs third-party code outside the workspace sandbox.`,
    }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: exec.name, signal: exec.signal })
    exec.signal.throwIfAborted()
  }

  const save = async (next: Record<string, ServerChoice>): Promise<void> => {
    const settings = ctx.get('settings')
    if (settings === undefined || entryId === undefined) {
      throw new Error('settings are not available in this profile; add the server under the mcp-directory entry\'s servers in the profile patch')
    }
    await settings.update(entryId, { servers: next })
  }

  const describe = (server: DirectoryServer): string => {
    const choice = choices()[server.id]
    const state = choice?.enabled === true ? notes.has(server.id) ? `on, ${notes.get(server.id) ?? ''}` : 'on' : 'off'
    const keys = server.requires.length === 0 ? '' : ` Needs ${server.requires.map(key => key.name).join(', ')}.`
    return `${server.id} (${server.title}) [${state}]: ${server.description}${keys}`
  }

  ctx.tools.register(defineTool({
    name: 'mcp_directory',
    description: 'Browse and manage the directory of well-known MCP servers (GitHub, Playwright browser, filesystem, library docs, fetch, Git, memory, '
      + 'Brave Search and more). list shows each server and whether it is on; add turns one on, after which its tools load with the '
      + 'group mcp-<id>; remove turns it off. Add a server only when the person asks for it: it downloads and runs that server\'s code.',
    parameters: {
      action: { type: 'string', required: true, description: 'list, add or remove.' },
      server: { type: 'string', description: 'Directory id or title for add and remove, such as github or "Brave Search".' },
      env: { type: 'object', additionalProperties: true, description: 'For add: values for the keys the server needs, such as {"BRAVE_API_KEY": "..."}; leave out keys set in the environment.' },
      roots: { type: 'array', items: { type: 'string' }, description: 'For add: folders a folder-opening server may use.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (args.action === 'list') return DIRECTORY.map(describe).join('\n')
      if (args.action !== 'add' && args.action !== 'remove') throw new Error('action must be list, add or remove')
      const server = args.server === undefined ? undefined : findServer(args.server)
      if (server === undefined) throw new Error(`no directory server is named "${args.server ?? ''}"; call mcp_directory with action list`)
      const current = { ...choices() }
      const previous = current[server.id]
      if (args.action === 'remove') {
        if (previous?.enabled !== true) return `${server.title} is already off.`
        await approve(exec, `turn off the ${server.title} MCP server`)
        await save(Object.fromEntries(Object.entries(current).filter(([id]) => id !== server.id)))
        return `Turned off ${server.title}; its tools are gone.`
      }
      await approve(exec, `turn on the ${server.title} MCP server`)
      // Keys go to the encrypted credential store under their own names, never into the profile file.
      const given = Object.entries(args.env ?? {}).flatMap(([key, value]) => typeof value === 'string' && value.trim() !== '' ? [[key, value.trim()] as const] : [])
      await storeKeys(server, given)
      const roots = args.roots !== undefined && args.roots.length > 0 ? args.roots : previous?.roots
      const choice: ServerChoice = {
        enabled: true,
        ...previous?.env === undefined ? {} : { env: previous.env },
        ...roots === undefined ? {} : { roots },
      }
      const built = clientConfig(server, choice, await keyEnvironment(server), process.cwd())
      if ('missing' in built) {
        return `${server.title} needs ${built.missing.join(', ')}: ${server.requires.map(key => `${key.name}: ${key.description}`).join(' ')} `
          + 'Ask the person to add the key in Settings or the environment, or to give it to you once and call add again with env; '
          + 'a key passed in env is kept in the encrypted credential store.'
      }
      current[server.id] = choice
      await save(current)
      return `Turned on ${server.title}. It starts in the background (the first start downloads it); `
        + `load its tools with the group mcp-${server.id}. Its tools are named mcp__${server.id}__<tool>.`
    },
  }))

  /** Keeps given key values in the credential store under their own names. */
  const storeKeys = async (server: DirectoryServer, given: readonly (readonly [string, string])[]): Promise<void> => {
    if (given.length === 0) return
    const credentials = ctx.get('credentials')
    if (credentials === undefined) {
      throw new Error('no credential store is available to keep the key; ask the person to set it in the environment instead')
    }
    for (const [key, value] of given) {
      if (!server.requires.some(required => required.name === key)) throw new Error(`${server.title} does not use a key named ${key}`)
      await credentials.set(credentialRef(key), value)
    }
  }
  const takenBy = (id: string, own: 'custom' | 'connectors'): string | undefined => {
    if (!ID_PATTERN.test(id)) return 'an id is 1 to 32 lowercase letters, digits and hyphens, starting with a letter'
    if (DIRECTORY.some(server => server.id === id)) return `"${id}" is the id of a directory server`
    const other = own === 'custom' ? config.connectors.get() : config.custom.get()
    return Object.hasOwn(other, id) ? `"${id}" is already used by a ${own === 'custom' ? 'connector' : 'server'}` : undefined
  }
  const without = <T>(record: Readonly<Record<string, T>>, id: string): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))
  const patch = async (change: Partial<Record<'servers' | 'custom' | 'connectors', object>>): Promise<void> => {
    const settings = ctx.get('settings')
    if (settings === undefined || entryId === undefined) throw new Error('settings are not available in this profile')
    await settings.update(entryId, change)
  }

  const control: McpDirectoryControl = {
    async servers() {
      const chosen = choices()
      const rows: ServerStatus[] = []
      for (const server of DIRECTORY) {
        const environment = await keyEnvironment(server)
        const choice = chosen[server.id]
        rows.push({
          id: server.id, title: server.title, description: server.description, homepage: server.homepage, custom: false,
          enabled: choice?.enabled === true, note: notes.get(server.id) ?? '',
          requires: server.requires.map(key => ({
            name: key.name, description: key.description, set: (choice?.env?.[key.name] ?? environment[key.name] ?? '').trim() !== '',
          })),
          opensFolders: server.roots !== undefined, roots: [...choice?.roots ?? []],
          command: server.launch.transport === 'stdio' ? [server.launch.command, ...server.launch.args].join(' ') : '',
          url: server.launch.transport === 'stdio' ? '' : server.launch.url,
        })
      }
      for (const [id, server] of Object.entries(config.custom.get())) {
        rows.push({
          id, title: server.title ?? id, description: '', homepage: '', custom: true, enabled: server.enabled, note: notes.get(id) ?? '',
          requires: [], opensFolders: false, roots: [],
          command: server.url === undefined || server.url === '' ? [server.command ?? '', ...server.args ?? []].join(' ').trim() : '',
          url: server.url ?? '',
        })
      }
      return rows
    },
    async setServer(id, change) {
      const server = DIRECTORY.find(candidate => candidate.id === id)
      if (server === undefined) {
        const custom = config.custom.get()
        const own = custom[id]
        if (own === undefined) throw new Error(`no server has the id "${id}"`)
        await patch({ custom: { ...custom, [id]: { ...own, enabled: change.enabled } } })
        return
      }
      const current = choices()
      const previous = current[server.id]
      if (!change.enabled) {
        if (previous !== undefined) await patch({ servers: { ...current, [server.id]: { ...previous, enabled: false } } })
        return
      }
      await storeKeys(server, Object.entries(change.keys ?? {}).flatMap(([key, value]) => value.trim() === '' ? [] : [[key, value.trim()] as const]))
      const roots = change.roots ?? previous?.roots
      await patch({
        servers: {
          ...current,
          [server.id]: {
            enabled: true, ...previous?.env === undefined ? {} : { env: previous.env }, ...roots === undefined ? {} : { roots },
          },
        },
      })
    },
    async saveCustom(id, server) {
      const taken = takenBy(id, 'custom')
      if (taken !== undefined) throw new Error(taken)
      const built = customConfig(id, server)
      if ('note' in built) throw new Error(`the server ${built.note}`)
      await patch({ custom: { ...config.custom.get(), [id]: server } })
    },
    async removeCustom(id) {
      await patch({ custom: without(config.custom.get(), id) })
    },
    async connectors() {
      const added = config.connectors.get()
      const rows: ConnectorStatus[] = []
      for (const connector of CONNECTORS) {
        const own = added[connector.id]
        rows.push({
          id: connector.id, title: connector.title, description: connector.description, homepage: connector.homepage,
          url: own?.url ?? connector.url, custom: false, added: own !== undefined,
          signedIn: own !== undefined && await auth.signedIn(connector.id),
        })
      }
      for (const [id, own] of Object.entries(added)) {
        if (CONNECTORS.some(connector => connector.id === id)) continue
        rows.push({ id, title: own.title ?? id, description: '', homepage: '', url: own.url, custom: true, added: true, signedIn: await auth.signedIn(id) })
      }
      return rows
    },
    async connect(choice) {
      const listed = CONNECTORS.find(connector => connector.id === choice.id)
      const taken = takenBy(choice.id, 'connectors')
      if (taken !== undefined) throw new Error(taken)
      const url = choice.url ?? listed?.url ?? ''
      if (!URL.canParse(url) || !/^https?:$/u.test(new URL(url).protocol)) throw new Error('a connector needs an http or https address')
      const title = choice.title ?? listed?.title
      const result = await auth.begin(choice.id, url)
      const entry = { enabled: true, ...title === undefined ? {} : { title }, url }
      await patch({ connectors: { ...config.connectors.get(), [choice.id]: entry } })
      return result
    },
    async disconnect(id) {
      await auth.forget(id)
      await patch({ connectors: without(config.connectors.get(), id) })
    },
    async skills() {
      return Promise.all(SKILLS.map(async skill => ({
        id: skill.id, title: skill.title, description: skill.description, license: skill.license, state: await skillState(skill, skillsDir),
      })))
    },
    async installSkill(id) {
      const skill = findSkill(id)
      if (skill === undefined) throw new Error(`no directory skill is named "${id}"`)
      await installSkill(skill, skillsDir)
      ctx.emit('mcp-directory/changed')
    },
    async removeSkill(id) {
      const skill = findSkill(id)
      if (skill === undefined) throw new Error(`no directory skill is named "${id}"`)
      if (!await removeSkill(skill, skillsDir)) throw new Error(`the ${skill.title} skill was not installed by the directory, so it was left in place`)
      ctx.emit('mcp-directory/changed')
    },
  }
  ctx.provide('mcpDirectory', control)

  /** The browser lands here after the person approves a connector; the page it shows carries nothing from the request. */
  const callback = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const page = (status: number, text: string): void => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(`<!doctype html><meta charset="utf-8"><title>Hack Dev Code</title><p style="font:16px system-ui;margin:3rem">${text}</p>`)
    }
    const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    const state = query.get('state')
    const code = query.get('code')
    if (req.method !== 'GET' || state === null || code === null) {
      page(400, 'This sign-in link is not valid.')
      return
    }
    try {
      await auth.finish(state, code)
      page(200, 'Connected. You can close this tab and return to Hack Dev Code.')
    } catch (error) {
      ctx.logger.warn('mcp-directory: connector sign-in failed: %s', error)
      page(400, 'The sign-in did not finish. Return to Hack Dev Code and try again.')
    }
  }
  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: OAUTH_CALLBACK_PATH, handler: callback }),
      'mcp-directory: connector sign-in callback',
    )
  })
  ctx.tools.register(defineTool({
    name: 'skill_directory',
    description: 'Browse and install skills from the curated skill directory (MCP server building, web app testing with Playwright, frontend design, '
      + 'Word, Excel, PowerPoint and PDF files, skill writing and more). list shows each skill and whether it is installed; install adds one '
      + 'to the user skill folder, where it is available at once; remove deletes one the directory installed. Install a skill only when the '
      + 'person asks for it.',
    parameters: {
      action: { type: 'string', required: true, description: 'list, install or remove.' },
      skill: { type: 'string', description: 'Skill id or title for install and remove, such as webapp-testing or "Word documents".' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (args.action === 'list') {
        const rows = await Promise.all(SKILLS.map(async (skill) => {
          const state = await skillState(skill, skillsDir)
          const label = state === 'directory' ? 'installed' : state === 'other' ? 'a folder of this name exists' : 'not installed'
          return `${skill.id} (${skill.title}) [${label}]: ${skill.description} (${skill.license})`
        }))
        return rows.join('\n')
      }
      if (args.action !== 'install' && args.action !== 'remove') throw new Error('action must be list, install or remove')
      const skill = args.skill === undefined ? undefined : findSkill(args.skill)
      if (skill === undefined) throw new Error(`no directory skill is named "${args.skill ?? ''}"; call skill_directory with action list`)
      await approve(exec, `${args.action} the ${skill.title} skill`)
      if (args.action === 'remove') {
        return await removeSkill(skill, skillsDir)
          ? `Removed the ${skill.title} skill.`
          : `The ${skill.title} skill was not installed by the directory, so nothing was removed.`
      }
      const target = await installSkill(skill, skillsDir)
      return `Installed the ${skill.title} skill in ${target}; it is available now. Load it with the skill tool by its name, ${skill.id}.`
    },
  }))
  // The MCP clients are child plugins of this one, so unloading the directory stops them.
}
