/**
 * The MCP server directory: a curated catalog of well-known MCP servers that the person, or an agent on their
 * behalf, turns on with one choice. Each enabled server runs as its own `mcp-client` instance, mounted and removed
 * live as the choice changes, with its tools in an on-demand group so they cost nothing until an agent loads them.
 * Choices live in this entry's volatile `servers` setting, which Settings forms and the `mcp_directory` tool edit.
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
import { DIRECTORY, findServer } from './catalog.ts'
import { findSkill, installSkill, removeSkill, SKILLS, skillState } from './skills.ts'
import type { DirectoryServer } from './catalog.ts'

export { DIRECTORY, findServer } from './catalog.ts'
export type { DirectoryServer } from './catalog.ts'
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
  /** Values for the keys the server requires; a key left out is read from the environment Hack Dev Code started in. */
  env?: Readonly<Record<string, string>> | undefined
  /** Folders for a server that opens folders, such as filesystem. */
  roots?: readonly string[] | undefined
}

/** Plugin config. */
export interface Config {
  /** Chosen servers by directory id; edited live by Settings and `mcp_directory`. */
  servers: Volatile<Record<string, ServerChoice>>
}

export const Config: z<Config> = z.object({
  servers: z.dict(z.object({
    enabled: z.boolean().default(true),
    env: z.dict(z.string().role('secret')),
    roots: z.array(String),
  })).default({}).volatile(),
}) as z<Config>

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
  /** Running clients by server id, with the config each was started with. */
  const running = new Map<string, { fiber: Fiber; key: string }>()
  const notes = new Map<string, string>()
  const choices = (): Readonly<Record<string, ServerChoice>> => config.servers.get()

  const sync = (): void => {
    const chosen = choices()
    for (const server of DIRECTORY) {
      const choice = chosen[server.id]
      const built = choice?.enabled === true ? clientConfig(server, choice, process.env, process.cwd()) : undefined
      const key = built !== undefined && 'config' in built ? JSON.stringify(built.config) : ''
      const current = running.get(server.id)
      if (current !== undefined && current.key !== key) {
        void current.fiber.dispose()
        running.delete(server.id)
      }
      if (built !== undefined && 'missing' in built) notes.set(server.id, `needs ${built.missing.join(', ')}`)
      else notes.delete(server.id)
      if (built !== undefined && 'config' in built && !running.has(server.id)) {
        running.set(server.id, { fiber: ctx.plugin(McpClient, built.config), key })
      }
    }
  }
  ctx.on('loader/volatile-update', sync)
  sync()

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
    async execute(args) {
      if (args.action === 'list') return DIRECTORY.map(describe).join('\n')
      if (args.action !== 'add' && args.action !== 'remove') throw new Error('action must be list, add or remove')
      const server = args.server === undefined ? undefined : findServer(args.server)
      if (server === undefined) throw new Error(`no directory server is named "${args.server ?? ''}"; call mcp_directory with action list`)
      const current = { ...choices() }
      const previous = current[server.id]
      if (args.action === 'remove') {
        if (previous?.enabled !== true) return `${server.title} is already off.`
        await save(Object.fromEntries(Object.entries(current).filter(([id]) => id !== server.id)))
        return `Turned off ${server.title}; its tools are gone.`
      }
      const given = Object.fromEntries(Object.entries(args.env ?? {}).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []))
      const env = Object.keys(given).length > 0 ? { ...previous?.env, ...given } : previous?.env
      const roots = args.roots !== undefined && args.roots.length > 0 ? args.roots : previous?.roots
      const choice: ServerChoice = { enabled: true, ...env === undefined ? {} : { env }, ...roots === undefined ? {} : { roots } }
      const built = clientConfig(server, choice, process.env, process.cwd())
      if ('missing' in built) {
        return `${server.title} needs ${built.missing.join(', ')}: ${server.requires.map(key => `${key.name}: ${key.description}`).join(' ')} `
          + 'Ask the person for the value and call add again with env, or have them set it in the environment and restart.'
      }
      current[server.id] = choice
      await save(current)
      return `Turned on ${server.title}. It starts in the background (the first start downloads it); `
        + `load its tools with the group mcp-${server.id}. Its tools are named mcp__${server.id}__<tool>.`
    },
  }))

  const skillsDir = join(resolveDshHome(), 'skills')
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
    async execute(args) {
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
