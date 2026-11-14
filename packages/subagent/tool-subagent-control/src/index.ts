/**
 * Shared messaging, interruption, and child discovery tools, and the team board.
 * The messaging tools perform no lifecycle routing of their own —
 * residency, cold resume, and interrupt authorization belong to the subagent
 * service — and they live apart from the provider-bound
 * `@hackdevcode/dsh-tool-subagent` instances so multiple delegation tools share
 * one control API.
 *
 * `send_message` reaches only an adjacent, continuable agent. The team board is for everyone else: every agent
 * that descends from one root conversation (the lead, its subagents, their subagents, workflow members) shares one
 * board. A post reaches the agents it is addressed to at their next step, while they are still working, so a parent
 * can steer a running one-shot child, a child can ask its parent, and siblings can warn each other. Agents also claim
 * the files they are about to edit, and a second agent that claims an overlapping path is told who holds it. Each
 * board is kept in a small file under the Hack Dev Code home, so a conversation resumed after a restart finds its
 * board, posts and claims as they were.
 * @module @hackdevcode/dsh-tool-subagent-control
 */

import type { Context } from '@hackdevcode/cordis'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import z from '@hackdevcode/schemastery'
import { writeFileAtomic } from '@hackdevcode/dsh-atomic-write'
import { resolveDshHome } from '@hackdevcode/dsh-home-paths'
import { brandString } from '@hackdevcode/dsh-brand'
import { defineTool } from '@hackdevcode/dsh-tools'
import { createUserMessage } from '@hackdevcode/dsh-llm'
import type { ContentBlock, ContextFormed } from '@hackdevcode/dsh-llm'
import type { Agent, PreStepDecision } from '@hackdevcode/dsh-agent'
import type { SessionId } from '@hackdevcode/dsh-session'
import type {} from '@hackdevcode/dsh-subagent'
import { markAdjacentAgentSendMessageTool } from '@hackdevcode/dsh-subagent/internal'
import { registerListAgents } from './list-agents.ts'

export const name = 'tool-subagent-control'
export const inject = ['tools', 'subagents', 'agents']

/** Plugin config. */
export interface Config {
  /** Folder the team boards are kept in; `team-boards` under the Hack Dev Code home when unset. */
  boardDir?: string
}

/** Schemastery configuration. */
export const Config: z<Config> = z.object({
  boardDir: z.string(),
})

/** What a board post is for. */
export const BOARD_KINDS = ['note', 'question', 'answer', 'warning', 'done'] as const

/** One post on a team board. */
export interface BoardPost {
  /** Position on the board, from 1. */
  n: number
  /** Session id of the agent that posted. */
  from: SessionId
  /** The name the poster goes by on the board. */
  name: string
  /** `all`, or the session id of the one agent it is for. */
  to: string
  kind: typeof BOARD_KINDS[number]
  text: string
}

/** The board of one family of agents: its posts, who claimed which paths, and how far each member has read. */
export interface Board {
  posts: BoardPost[]
  /** Posts made over the board's life; `posts` keeps only the newest. */
  count: number
  claims: Map<string, { by: SessionId; name: string; path: string }>
  names: Map<SessionId, string>
  read: Map<SessionId, number>
}

/** Posts kept per board; older ones are dropped. */
const MAX_BOARD_POSTS = 200

/** Boards kept at once; the one used longest ago is dropped first. */
const MAX_BOARDS = 64

/** Longest post text. */
const MAX_POST_CHARS = 1200

/** Message source of board posts delivered to an agent between steps. */
const TEAM_BOARD_SOURCE = 'team-board'

declare module '@hackdevcode/dsh-llm' {
  interface MessageSourceMap {
    /** Board posts from the other agents of the same task, delivered before a step. */
    'team-board': { kind: 'team-board' } & ContextFormed
  }
}

/**
 * A path as claims compare it: forward slashes, lowercase, no leading `./` and no trailing slash.
 * @param path - the path an agent named.
 * @returns the comparison key.
 */
export function claimKey(path: string): string {
  let key = path.trim().replaceAll('\\', '/').toLowerCase()
  while (key.startsWith('./')) key = key.slice(2)
  return key.replace(/\/+$/u, '')
}

/**
 * Whether two claimed paths cover the same files: the same path, or one inside the other.
 * @param a - one claim key.
 * @param b - another claim key.
 * @returns true when editing one could touch the other.
 */
export function claimsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/**
 * Register the shared subagent control and discovery tools.
 * @param ctx - context carrying tools, subagents, and live Agents.
 * @param config - where the team boards are kept.
 */
export function apply(ctx: Context, config: Config = {}): void {
  registerListAgents(ctx)
  registerTeamBoard(ctx, config.boardDir ?? join(resolveDshHome(), 'team-boards'))
  ctx.tools.register(markAdjacentAgentSendMessageTool(defineTool({
    name: 'send_message',
    description:
      'Send a message to an agent. A working agent receives it at its next step; an idle agent starts a new turn with it. '
      + 'Returns delivery confirmation, not the agent\'s answer.',
    parameters: {
      agent_id: {
        type: 'string',
        required: true,
        description: 'The agent id of your direct continuable child, or your direct parent when you are a resident continuable child.',
      },
      message: {
        type: 'string',
        required: true,
        description: 'The message to deliver to the agent.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          messageId: { type: 'string', required: true },
        },
      },
      render: (args, _value) => [{
        type: 'text',
        text: `message delivered to agent ${args.agent_id}`,
      }],
    },
    async execute(args, exec) {
      const sender = exec.agent
      if (!sender) {
        throw new Error('send_message requires a calling agent (exec.agent was undefined)')
      }
      const message: ContentBlock[] = [{ type: 'text', text: args.message }]
      const messageId = await ctx.subagents.sendMessage(
        sender,
        brandString<SessionId>(args.agent_id),
        message,
        { signal: exec.signal },
      )
      return { messageId }
    },
  })))

  ctx.tools.register(defineTool({
    name: 'interrupt_agent',
    description:
      'Ask a subagent to stop its current work. This call returns without waiting for it to stop. '
      + 'You can continue a local direct child\'s conversation later with send_message. '
      + 'External executions stop permanently and cannot receive follow-ups. Subagents it started will keep running.',
    parameters: {
      agent_id: {
        type: 'string',
        required: true,
        description: 'The id of an agent created under you: your direct child or a deeper descendant.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
        },
      },
      render: (args, _value) => [{
        type: 'text',
        text: `interrupt requested for agent ${args.agent_id}`,
      }],
    },
    execute(args, exec) {
      const caller = exec.agent
      if (!caller) {
        // Ancestor authority requires an exact live calling agent.
        throw new Error('interrupt_agent requires a calling agent (exec.agent was undefined)')
      }
      // The service authorizes the exact live caller against the target's
      // recorded lineage; the tool adds no authority of its own.
      ctx.subagents.interrupt(brandString<SessionId>(args.agent_id), { kind: 'ancestor', agent: caller })
      return Promise.resolve({ accepted: true })
    },
  }))
}

/** A board as it is written to disk. */
interface StoredBoard {
  posts: BoardPost[]
  count: number
  claims: [string, { by: SessionId; name: string; path: string }][]
  names: [SessionId, string][]
  read: [SessionId, number][]
}

/** The file name of one board: its root session id, with anything a file name cannot hold replaced. */
function boardFileName(root: SessionId): string {
  return `${String(root).replace(/[^\w.-]/gu, '_')}.json`
}

/**
 * Read a stored board back, keeping only well-formed parts.
 * @param text - the file's text.
 * @returns the board, or undefined when the file is not a board.
 */
export function parseStoredBoard(text: string): Board | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  if (typeof value !== 'object' || value === null) return undefined
  const stored = value as Partial<StoredBoard>
  // The file is untrusted input, so every entry is checked as unknown data.
  const isPost = (entry: unknown): entry is BoardPost => {
    if (typeof entry !== 'object' || entry === null) return false
    const post = entry as Record<string, unknown>
    return typeof post['n'] === 'number' && typeof post['text'] === 'string' && typeof post['from'] === 'string'
      && typeof post['to'] === 'string' && typeof post['name'] === 'string'
      && (BOARD_KINDS as readonly unknown[]).includes(post['kind'])
  }
  const posts = Array.isArray(stored.posts) ? (stored.posts as unknown[]).filter(isPost).slice(-MAX_BOARD_POSTS) : []
  const pairs = <V>(list: unknown, valid: (entry: unknown) => entry is V): [string, V][] =>
    Array.isArray(list) ? list.filter((entry): entry is [string, V] => Array.isArray(entry) && typeof entry[0] === 'string' && valid(entry[1])) : []
  const isClaim = (entry: unknown): entry is { by: SessionId; name: string; path: string } =>
    typeof entry === 'object' && entry !== null && typeof (entry as { path?: unknown }).path === 'string'
    && typeof (entry as { by?: unknown }).by === 'string' && typeof (entry as { name?: unknown }).name === 'string'
  const isText = (entry: unknown): entry is string => typeof entry === 'string'
  const isCount = (entry: unknown): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0
  const count = isCount(stored.count) ? stored.count : posts.at(-1)?.n ?? 0
  return {
    posts,
    count: Math.max(count, posts.at(-1)?.n ?? 0),
    claims: new Map(pairs(stored.claims, isClaim)),
    names: new Map(pairs(stored.names, isText).map(([id, known]) => [id as SessionId, known])),
    read: new Map(pairs(stored.read, isCount).map(([id, n]) => [id as SessionId, n])),
  }
}

/**
 * Register the `team_board` tool and deliver its posts to the agents they are for.
 * @param ctx - context carrying the tool registry and the live Agent registry.
 * @param boardDir - folder the boards are kept in.
 */
function registerTeamBoard(ctx: Context, boardDir: string): void {
  /** Boards by root session id, least recently used first. */
  const boards = new Map<SessionId, Board>()
  /** The pending write of each board, so writes of one board land in order. */
  const writes = new Map<SessionId, Promise<void>>()

  /** Write a board after a change; a failed write is logged, never fails the call that changed the board. */
  const save = (root: SessionId, board: Board): Promise<void> => {
    const stored: StoredBoard = {
      posts: board.posts, count: board.count, claims: [...board.claims], names: [...board.names], read: [...board.read],
    }
    const text = JSON.stringify(stored)
    const write = (writes.get(root) ?? Promise.resolve())
      .then(() => writeFileAtomic(join(boardDir, boardFileName(root)), text, { mode: 0o600 }))
      .catch((error: unknown) => { ctx.logger.warn('team_board: could not save the board of %s: %s', root, error) })
    writes.set(root, write)
    return write
  }

  /** The root of an agent's family: the topmost ancestor, live or not. */
  const rootOf = (agent: Agent): SessionId => {
    let id = agent.id
    let parent = agent.session.header.parentSession
    // A depth bound, not a real limit: lineage is acyclic, and delegation depth is capped far below this.
    for (let hops = 0; parent !== undefined && hops < 64; hops += 1) {
      id = parent
      parent = ctx.agents.get(parent)?.session.header.parentSession
    }
    return id
  }
  /** An agent's board and its root: from memory, else from its file, else a new one when `create` is set. */
  const boardOf = async (agent: Agent, create: boolean): Promise<{ root: SessionId; board: Board } | undefined> => {
    const root = rootOf(agent)
    let board = boards.get(root)
    if (board === undefined) {
      board = parseStoredBoard(await readFile(join(boardDir, boardFileName(root)), 'utf8').catch(() => ''))
      // Another call may have loaded or created it while the file was read.
      board = boards.get(root) ?? board
    }
    if (board === undefined) {
      if (!create) return undefined
      board = { posts: [], count: 0, claims: new Map(), names: new Map(), read: new Map() }
    }
    if (!boards.has(root)) {
      if (boards.size >= MAX_BOARDS) {
        const oldest = boards.keys().next().value
        if (oldest !== undefined) boards.delete(oldest)
      }
    } else {
      boards.delete(root)
    }
    boards.set(root, board)
    return { root, board }
  }
  const nameOf = (board: Board, id: SessionId): string => board.names.get(id) ?? String(id).slice(0, 12)
  const line = (post: BoardPost): string =>
    `#${String(post.n)} @${post.name} -> ${post.to === 'all' ? '@all' : `@${post.to}`} (${post.kind}): ${post.text}`

  ctx.tools.register(defineTool({
    name: 'team_board',
    description:
      'The shared board of every agent working on this task: you, the agent that started you, the agents you started and their siblings. '
      + 'post writes a note, question, answer, warning or done notice; it reaches the agents it is for at their next step, even while they are '
      + 'working, so use it to steer a running subagent, to ask the agent that started you a question, or to tell a sibling about an interface it '
      + 'depends on. read shows the newest posts and who has claimed which files. claim records the files or folders you are about to edit and '
      + 'tells you when another agent already holds an overlapping path; release gives them up. Posts addressed to you arrive on their own: '
      + 'you do not need to poll with read.',
    parameters: {
      action: { type: 'string', required: true, enum: ['post', 'read', 'claim', 'release'], description: 'post, read, claim or release.' },
      text: { type: 'string', description: 'For post: what to tell the others, at most 1200 characters.' },
      kind: { type: 'string', enum: [...BOARD_KINDS], description: 'For post: note (default), question, answer, warning or done.' },
      to: { type: 'string', description: 'For post: all (default), parent, or the agent id of the one agent it is for (from list_agents or an earlier post).' },
      as: { type: 'string', description: 'The short name you go by on the board, such as api or tests; kept from your first post or claim.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'For claim and release: files or folders, relative to the workspace.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const agent = exec.agent
      if (!agent) throw new Error('team_board requires a calling agent (exec.agent was undefined)')
      if (args.action === 'read') {
        const found = await boardOf(agent, false)
        const board = found?.board
        if (found === undefined || board === undefined || (board.posts.length === 0 && board.claims.size === 0)) return 'The board is empty.'
        board.read.set(agent.id, board.count)
        await save(found.root, board)
        const claims = [...board.claims.values()].map(claim => `- ${claim.path} — @${claim.name}`)
        return [
          board.posts.length === 0 ? 'No posts yet.' : board.posts.slice(-40).map(line).join('\n'),
          claims.length === 0 ? 'No files are claimed.' : `Claimed files:\n${claims.join('\n')}`,
        ].join('\n\n')
      }
      const { root, board } = await boardOf(agent, true) as { root: SessionId; board: Board }
      const given = (args.as ?? '').trim().replace(/^@/u, '').slice(0, 24)
      if (given !== '' && !board.names.has(agent.id)) board.names.set(agent.id, given)
      const myName = nameOf(board, agent.id)
      if (args.action === 'post') {
        const text = (args.text ?? '').trim()
        if (text === '') throw new Error('post needs text')
        const kind = BOARD_KINDS.find(candidate => candidate === args.kind) ?? 'note'
        const asked = (args.to ?? 'all').trim().replace(/^@/u, '')
        const parent = agent.session.header.parentSession
        if (asked === 'parent' && parent === undefined) throw new Error('you have no parent agent; post to all, or to an agent id')
        // A name another member goes by on the board works as well as its id.
        const named = [...board.names].find(([, known]) => known === asked)?.[0]
        const to = asked === '' || asked === 'all' ? 'all' : asked === 'parent' ? String(parent) : named ?? asked
        if (to === String(agent.id)) throw new Error('a post cannot be addressed to yourself')
        board.count += 1
        const post: BoardPost = { n: board.count, from: agent.id, name: myName, to, kind, text: text.slice(0, MAX_POST_CHARS) }
        board.posts.push(post)
        if (board.posts.length > MAX_BOARD_POSTS) board.posts.splice(0, board.posts.length - MAX_BOARD_POSTS)
        await save(root, board)
        return `Posted #${String(post.n)} to ${to === 'all' ? 'everyone on the board' : `@${to}`}; it reaches them at their next step.`
      }
      const paths = (args.paths ?? []).map(path => ({ path: path.trim(), key: claimKey(path) })).filter(entry => entry.key !== '')
      if (paths.length === 0) throw new Error(`${args.action} needs paths`)
      if (args.action === 'release') {
        let released = 0
        for (const { key } of paths) {
          if (board.claims.get(key)?.by === agent.id && board.claims.delete(key)) released += 1
        }
        await save(root, board)
        return `Released ${String(released)} of ${String(paths.length)} path(s).`
      }
      const taken: string[] = []
      const held: string[] = []
      for (const { path, key } of paths) {
        const other = [...board.claims].find(([claimed, claim]) => claim.by !== agent.id && claimsOverlap(claimed, key))?.[1]
        if (other !== undefined) {
          held.push(`${path} overlaps ${other.path}, held by @${other.name}`)
          continue
        }
        board.claims.set(key, { by: agent.id, name: myName, path })
        taken.push(path)
      }
      await save(root, board)
      return [
        taken.length === 0 ? '' : `Claimed: ${taken.join(', ')}.`,
        held.length === 0
          ? ''
          : `NOT claimed: ${held.join('; ')}. Do not edit those; post to the agent that holds them (a question, or the change you need) and continue with the rest.`,
      ].filter(part => part !== '').join(' ')
    },
  }))

  // Unread posts for an agent arrive before its next step, so a working agent hears from the others without polling.
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const found = await boardOf(agent, false)
    if (found === undefined) return decision
    const { root, board } = found
    const seen = board.read.get(agent.id) ?? 0
    // Posts from agents that have finished are not pushed: their work is over, and what they found reached their caller
    // as their result. Delivered late, as a batch, they read like fresh instructions and a model starts the work again.
    // They stay on the board for team_board read.
    const fresh = board.posts.filter(post => post.n > seen && post.from !== agent.id && (post.to === 'all' || post.to === String(agent.id))
      && ctx.agents.get(post.from) !== undefined)
    if (seen === board.count) return decision
    board.read.set(agent.id, board.count)
    await save(root, board)
    if (fresh.length === 0) return decision
    const text = [
      'New on the team board, from the other agents working on this task with you. Take it into account in what you are already doing; '
      + 'it does not ask you to start new work. Answer a question addressed to you with team_board (action post, kind answer, to its author).',
      ...fresh.map(line),
    ].join('\n')
    return {
      ...decision,
      messages: [
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: TEAM_BOARD_SOURCE, form: 'snapshot', sections: [{ name: TEAM_BOARD_SOURCE, text }] },
        }),
        ...decision.messages,
      ],
    }
  })
}
