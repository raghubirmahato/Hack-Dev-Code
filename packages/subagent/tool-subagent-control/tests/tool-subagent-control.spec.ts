import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import { agentEvents } from '@hackdevcode/dsh-agent'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@hackdevcode/cordis'
import type { Agent } from '@hackdevcode/dsh-agent'
import { ToolCallId, createUserMessage } from '@hackdevcode/dsh-llm'
import AgentLoop from '@hackdevcode/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@hackdevcode/dsh-agent-loop-testkit'
import { SessionId } from '@hackdevcode/dsh-session'
import * as JsonlSessionPersistence from '@hackdevcode/dsh-session-persistence-jsonl'
import SubagentRuntime from '@hackdevcode/dsh-subagent'
import * as SubagentFork from '@hackdevcode/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@hackdevcode/dsh-subagent-spawn-in-process'
import type { GenerateOptions, StreamChunk } from '@hackdevcode/dsh-llm'
import { LlmAdapter } from '@hackdevcode/dsh-llm'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as tool from '../src/index.ts'
import { parkParent } from './park-parent.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { loadStoredSession } from '../../subagent/tests/persistence-helpers.ts'

/** One scripted response that may wait on a caller-released gate before streaming. */
interface GatedEntry {
  chunks: StreamChunk[]
  gate?: Promise<undefined>
}

/** Adapter whose entries can hold a model call open until the test releases it. */
class GatedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private script: GatedEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('GatedAdapter: script exhausted')
    if (entry.gate) await entry.gate
    for (const chunk of entry.chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

const testToolSignal = new AbortController().signal

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

async function setupWith(adapter: MockAdapter | GatedAdapter, park = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-subagent-control-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  // Boards go to the test's own folder, never the user's home.
  const boardDir = join(root, 'boards')
  const control = await ctx.plugin(tool, { boardDir })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  if (park) parkParent(ctx, parent)
  return { ctx, parent, adapter, boardDir, control }
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  return setupWith(new MockAdapter(script))
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

let calls = 0
function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: unknown,
  signal: AbortSignal = testToolSignal,
) {
  return executeToolFixture(ctx, {
    signal,
    callId: ToolCallId(`call-${++calls}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })
}

/** Wait until a child's Activation released its handle. */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 5_000 })
}

describe('dsh-tool-subagent-control', () => {
  it('registers send_message once, globally, with the two required parameters', async () => {
    const { ctx } = await setup([])
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'send_message')
    expect(schemas).toHaveLength(1)
    const props = (schemas[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['agent_id', 'message'])
    // The continuable path has no Task, so the schema must not promise one.
    expect(schemas[0]!.description).not.toContain('job_output')
    expect(schemas[0]!.description).not.toContain('job id')
    expect(schemas[0]!.description).toContain('receives it at its next step')
    expect(props.agent_id).toMatchObject({
      description: 'The agent id of your direct continuable child, or your direct parent when you are a resident continuable child.',
    })
  })

  it('keeps the send_message definition and ordering byte-identical in a fork child', async () => {
    const release = Promise.withResolvers<undefined>()
    const { ctx, parent, adapter } = await setupWith(new GatedAdapter([
      { chunks: textResponse('parent done') },
      { chunks: textResponse('child done'), gate: release.promise },
    ]), false)
    parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'parent work' }],
      source: { kind: 'user' },
    }))
    await parent.whenIdle()
    parkParent(ctx, parent)
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'fork',
      label: 'fork child',
      request: { prompt: [{ type: 'text', text: 'fork task' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const child = ctx.agents.get(started.childId)
    if (child === undefined) throw new Error('expected a live fork child')

    const parentSchemas = ctx.tools.schemas(parent)
    const childSchemas = ctx.tools.schemas(child)
    expect(JSON.stringify(childSchemas)).toBe(JSON.stringify(parentSchemas))
    expect(childSchemas.map(schema => schema.name)).not.toContain('report')

    release.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    const loaded = await loadStoredSession(ctx.sessionPersistence, started.childId)
    const promptIndex = loaded.events.findIndex(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === 'fork task'))
    expect(loaded.meta.isSeeded).toBe(true)
    expect(promptIndex).toBeGreaterThanOrEqual(loaded.inheritedEventCount)
    const prompt = loaded.events[promptIndex]
    if (prompt?.type !== 'user/message') throw new Error('expected the initial fork task')
    const texts = prompt.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    expect(texts[0]).toBe('fork task')
    expect(texts[1]).toContain(`Your parent agent id is ${JSON.stringify(parent.id)}`)
    expect(texts[1]).toContain(`send_message({ agent_id: ${JSON.stringify(parent.id)}`)
    expect(texts[1]).not.toContain('report tool')
  })

  it('JSON-encodes a caller-supplied parent id in the initial return instruction', async () => {
    const { ctx } = await setup([textResponse('child done')])
    const parent = await ctx.agentLoop.create(SessionId('parent"\nagent'), { provider: 'mock', model: 'mock' })
    parkParent(ctx, parent)
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'encoded parent',
      request: { prompt: [{ type: 'text', text: 'encoded task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    const loaded = await loadStoredSession(ctx.sessionPersistence, started.childId)
    const prompt = loaded.events.find(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === 'encoded task'))
    if (prompt?.type !== 'user/message') throw new Error('expected the encoded initial task')
    const guidance = prompt.data.content.findLast(block => block.type === 'text')?.text ?? ''

    expect(guidance).toContain(`Your parent agent id is ${JSON.stringify(parent.id)}`)
    expect(guidance).toContain(`agent_id: ${JSON.stringify(parent.id)}`)
    expect(guidance).not.toContain(parent.id)
  })

  it('lets a continuable child steer its direct parent with send_message', async () => {
    const release = Promise.withResolvers<undefined>()
    const { ctx, parent, adapter } = await setupWith(new GatedAdapter([
      { chunks: textResponse('child done'), gate: release.promise },
    ]))
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'child task',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)
    if (child === undefined) throw new Error('expected a live child')
    const delivered: Array<{ agent: Agent; message: ReturnType<typeof createUserMessage> }> = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent === parent && message.source.kind === 'agent-message') delivered.push({ agent, message })
    })

    const result = await callTool(ctx, 'send_message', {
      agent_id: parent.id,
      message: 'CHILD_FINDING',
    }, child)

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`message delivered to agent ${parent.id}`)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.message.source).toEqual({
      kind: 'agent-message',
      form: 'relay',
      senderSessionId: started.childId,
    })
    expect(delivered[0]?.message.content).toEqual([
      { type: 'text', text: `Agent ${started.childId} sent a message: ` },
      { type: 'text', text: 'CHILD_FINDING' },
    ])

    release.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('cold-resumes a settled child and reports delivery', async () => {
    const { ctx, parent } = await setup([textResponse('first answer'), textResponse('second answer')])
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'child task',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)

    const result = await callTool(ctx, 'send_message', {
      agent_id: started.childId,
      message: 'and then?',
    }, parent)

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`message delivered to agent ${started.childId}`)
    await waitNoActivation(ctx, started.childId)

    const loaded = await loadStoredSession(ctx.sessionPersistence, started.childId)
    const followUp = loaded.events.findLast(event => event.type === 'user/message')
    // The durable message source records the calling agent without granting authority.
    expect(followUp?.type === 'user/message' && followUp.data.source).toEqual({
      kind: 'agent-message',
      form: 'relay',
      senderSessionId: parent.id,
    })
    expect(followUp?.type === 'user/message' && followUp.data.content).toEqual([
      { type: 'text', text: `Agent ${parent.id} sent a message: ` },
      { type: 'text', text: 'and then?' },
    ])
  })

  it('steers the nearest step of an open turn', async () => {
    const { ctx, parent, adapter } = await setup([textResponse('first'), textResponse('second')])
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'long work',
      request: { prompt: [{ type: 'text', text: 'long work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    const result = await callTool(ctx, 'send_message', {
      agent_id: started.childId,
      message: 'also consider Y',
    }, parent)
    expect(result.isError).toBe(false)

    await waitNoActivation(ctx, started.childId)
    const loaded = await loadStoredSession(ctx.sessionPersistence, started.childId)
    const prompts = loaded.events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'runtime-context'
      ? event.data.content.flatMap(block => block.type === 'text'
        && !block.text.startsWith('Your parent agent id is ')
        ? [block.text]
        : [])
      : [])
    expect(prompts).toEqual([
      'long work',
      `Agent ${parent.id} sent a message: `,
      'also consider Y',
    ])
  })

  it('reports a delivery failure as an errored, not-delivered result', async () => {
    const { ctx, parent } = await setup([])
    const result = await callTool(ctx, 'send_message', {
      agent_id: 'no-such-child',
      message: 'hello?',
    }, parent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unavailable')
  })

  it('rejects a caller that is not the child\'s durable direct parent', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'child task',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    const stranger = await ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })

    const result = await callTool(ctx, 'send_message', {
      agent_id: started.childId,
      message: 'mine now',
    }, stranger)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('another parent session')
  })

  it('compares claimed paths without regard to slashes, case or a leading ./', () => {
    expect(tool.claimKey('.\\src\\API\\')).toBe('src/api')
    expect(tool.claimKey('./src/api/routes.ts')).toBe('src/api/routes.ts')
    expect(tool.claimsOverlap('src/api', 'src/api/routes.ts')).toBe(true)
    expect(tool.claimsOverlap('src/api/routes.ts', 'src/api')).toBe(true)
    expect(tool.claimsOverlap('src/api', 'src/api')).toBe(true)
    // A shared prefix is not containment.
    expect(tool.claimsOverlap('src/api', 'src/api-tests')).toBe(false)
  })

  it('delivers a board post to a running subagent at its next step and lets it answer its parent', async () => {
    const release = Promise.withResolvers<undefined>()
    const { ctx, parent, adapter } = await setupWith(new GatedAdapter([
      { chunks: textResponse('child done'), gate: release.promise },
    ]))
    expect(text(await callTool(ctx, 'team_board', { action: 'read' }, parent))).toBe('The board is empty.')
    const posted = await callTool(ctx, 'team_board', { action: 'post', as: 'lead', kind: 'warning', text: 'The API returns ISO dates, not timestamps.' }, parent)
    expect(text(posted)).toContain('Posted #1 to everyone on the board')
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'worker',
      request: { prompt: [{ type: 'text', text: 'build the client' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // The child never polled: the post was waiting for it before its first step.
    const seen = JSON.stringify(adapter.requests[0]!.messages)
    expect(seen).toContain('New on the team board')
    expect(seen).toContain('#1 @lead -> @all (warning): The API returns ISO dates, not timestamps.')
    const child = ctx.agents.get(started.childId)
    if (child === undefined) throw new Error('expected a live child')

    // The child asks the agent that started it; the question waits for the parent's next step.
    const asked = await callTool(ctx, 'team_board', { action: 'post', as: 'client', to: 'parent', kind: 'question', text: 'Which time zone?' }, child)
    expect(text(asked)).toContain('Posted #2 to @parent')
    const board = text(await callTool(ctx, 'team_board', { action: 'read' }, parent))
    expect(board).toContain('#2 @client -> @parent (question): Which time zone?')
    // A name works as an address once its owner has used it.
    expect(text(await callTool(ctx, 'team_board', { action: 'post', to: 'client', kind: 'answer', text: 'UTC.' }, parent))).toContain(`Posted #3 to @${String(started.childId)}`)

    release.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('does not push the posts of an agent that has finished, but keeps them on the board', async () => {
    const release = Promise.withResolvers<undefined>()
    const { ctx, parent, adapter } = await setupWith(new GatedAdapter([
      { chunks: textResponse('child done'), gate: release.promise },
    ]))
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'worker',
      request: { prompt: [{ type: 'text', text: 'build the client' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)
    if (child === undefined) throw new Error('expected a live child')
    await callTool(ctx, 'team_board', { action: 'post', as: 'client', kind: 'note', text: 'Client finished; start the server work now.' }, child)
    release.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    expect(ctx.agents.get(started.childId)).toBeUndefined()
    // The parent's next step gets the child's result, not its stale post as a fresh instruction.
    const decision = await agentEvents(ctx, parent).waterfall('agent/pre-step', {
      modelSelection: { provider: 'mock', model: 'mock' },
      messages: [], turn: 2, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    expect(JSON.stringify(decision)).not.toContain('start the server work now')
    expect(text(await callTool(ctx, 'team_board', { action: 'read' }, parent))).toContain('start the server work now')
  })

  it('lets one agent claim files and tells another that an overlapping path is held', async () => {
    const release = Promise.withResolvers<undefined>()
    const { ctx, parent, adapter } = await setupWith(new GatedAdapter([
      { chunks: textResponse('child done'), gate: release.promise },
    ]))
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'worker',
      request: { prompt: [{ type: 'text', text: 'build' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)
    if (child === undefined) throw new Error('expected a live child')

    expect(text(await callTool(ctx, 'team_board', { action: 'claim', as: 'lead', paths: ['src/api/', 'README.md'] }, parent))).toBe('Claimed: src/api/, README.md.')
    const second = text(await callTool(ctx, 'team_board', { action: 'claim', as: 'ui', paths: ['./src/API/routes.ts', 'src/ui'] }, child))
    expect(second).toContain('Claimed: src/ui.')
    expect(second).toContain('NOT claimed: ./src/API/routes.ts overlaps src/api/, held by @lead')
    expect(text(await callTool(ctx, 'team_board', { action: 'read' }, child))).toContain('Claimed files:\n- src/api/ — @lead\n- README.md — @lead\n- src/ui — @ui')
    // Only the holder can release a path; once released, the other agent can take it.
    expect(text(await callTool(ctx, 'team_board', { action: 'release', paths: ['src/api'] }, child))).toBe('Released 0 of 1 path(s).')
    expect(text(await callTool(ctx, 'team_board', { action: 'release', paths: ['src/api'] }, parent))).toBe('Released 1 of 1 path(s).')
    expect(text(await callTool(ctx, 'team_board', { action: 'claim', paths: ['src/api/routes.ts'] }, child))).toBe('Claimed: src/api/routes.ts.')

    release.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('keeps a board, its claims and who has read what across a restart', async () => {
    const { ctx, parent, boardDir, control } = await setup([])
    await callTool(ctx, 'team_board', { action: 'post', as: 'lead', text: 'Use UTC everywhere.' }, parent)
    await callTool(ctx, 'team_board', { action: 'claim', paths: ['src/api'] }, parent)
    const files = readdirSync(boardDir)
    expect(files).toEqual(['parent.json'])
    // The plugin goes away, as when the app quits, and a fresh one starts on the same folder.
    await control.dispose()
    await ctx.plugin(tool, { boardDir })
    const board = text(await callTool(ctx, 'team_board', { action: 'read' }, parent))
    expect(board).toContain('#1 @lead -> @all (note): Use UTC everywhere.')
    expect(board).toContain('- src/api — @lead')
    expect(text(await callTool(ctx, 'team_board', { action: 'post', text: 'Second.' }, parent))).toContain('Posted #2')
  })

  it('ignores a damaged board file and keeps only well-formed entries', () => {
    expect(tool.parseStoredBoard('not json')).toBeUndefined()
    expect(tool.parseStoredBoard('null')).toBeUndefined()
    const board = tool.parseStoredBoard(JSON.stringify({
      posts: [
        { n: 1, from: 'a', name: 'a', to: 'all', kind: 'note', text: 'kept' },
        { n: 2, from: 'a', name: 'a', to: 'all', kind: 'shout', text: 'unknown kind' },
        'garbage',
      ],
      count: 'nine',
      claims: [['src', { by: 'a', name: 'a', path: 'src' }], ['bad', { path: 3 }]],
      names: [['a', 'api'], ['b', 4]],
      read: [['a', 1], ['b', -1]],
    }))
    expect(board?.posts.map(post => post.text)).toEqual(['kept'])
    expect(board?.count).toBe(1)
    expect([...board?.claims.keys() ?? []]).toEqual(['src'])
    expect([...board?.names ?? []]).toEqual([['a', 'api']])
    expect([...board?.read ?? []]).toEqual([['a', 1]])
  })

  it('refuses a board post without text, to oneself, or to a parent that does not exist', async () => {
    const { ctx, parent } = await setup([])
    expect(text(await callTool(ctx, 'team_board', { action: 'post', text: '  ' }, parent))).toContain('post needs text')
    expect(text(await callTool(ctx, 'team_board', { action: 'post', text: 'x', to: 'parent' }, parent))).toContain('you have no parent agent')
    expect(text(await callTool(ctx, 'team_board', { action: 'post', text: 'x', to: 'parent-id-of-mine', as: 'parent-id-of-mine' }, parent))).toContain('cannot be addressed to yourself')
    expect(text(await callTool(ctx, 'team_board', { action: 'claim', paths: [] }, parent))).toContain('claim needs paths')
    expect((await callTool(ctx, 'team_board', { action: 'read' })).isError).toBe(true)
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    const result = await callTool(ctx, 'send_message', { agent_id: 'x', message: 'y' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('unregisters with its plugin fiber (HMR safety)', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    const fiber = await ctx.plugin(tool, { boardDir: join(tmpdir(), 'dsh-board-hmr-unused') })
    const names = ['send_message', 'interrupt_agent', 'list_agents']
    for (const name of names) expect(ctx.tools.schemas().filter(schema => schema.name === name)).toHaveLength(1)
    expect(ctx.tools.get('list_subagent_models')).toBeUndefined()
    await fiber.dispose()
    for (const name of names) expect(ctx.tools.get(name)).toBeUndefined()
    const reloaded = await ctx.plugin(tool, { boardDir: join(tmpdir(), 'dsh-board-hmr-unused') })
    for (const name of names) expect(ctx.tools.schemas().filter(schema => schema.name === name)).toHaveLength(1)
    await reloaded.dispose()
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-subagent-control')
    expect(tool.inject).toEqual(['tools', 'subagents', 'agents'])
    expect(typeof tool.apply).toBe('function')
  })
})

describe('dsh-tool-subagent-control interrupt_agent', () => {
  it('registers interrupt_agent with the single agent_id parameter and current-turn wording', async () => {
    const { ctx } = await setup([])
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'interrupt_agent')
    expect(schemas).toHaveLength(1)
    const props = (schemas[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['agent_id'])
    expect(schemas[0]!.description).toContain('stop its current work')
    expect(schemas[0]!.description).toContain('send_message')
  })

  it('interrupts a running direct child with the parent cause, parking its queue', async () => {
    const releaseFirst = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('held'), gate: releaseFirst.promise },
      { chunks: textResponse('parked answer') },
      { chunks: textResponse('waking answer') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'long work',
      request: { prompt: [{ type: 'text', text: 'long work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const queued = await callTool(ctx, 'send_message', {
      agent_id: started.childId,
      message: 'parked follow-up',
    }, parent)
    expect(queued.isError).toBe(false)
    const cancelSpy = vi.spyOn(child, 'cancel')

    const result = await callTool(ctx, 'interrupt_agent', { agent_id: started.childId }, parent)

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`interrupt requested for agent ${started.childId}`)
    expect(cancelSpy).toHaveBeenCalledExactlyOnceWith({ kind: 'parent' }, { keepInbox: true })
    releaseFirst.resolve(undefined)
    await child.whenIdle()
    // Parked, not resumed: the steering waits for another waking send.
    expect(adapter.requests).toHaveLength(1)
    expect(child.inbox.nextStep).toHaveLength(1)

    const waking = await callTool(ctx, 'send_message', {
      agent_id: started.childId,
      message: 'wake up',
    }, parent)
    expect(waking.isError).toBe(false)
    await waitNoActivation(ctx, started.childId)
    const loaded = await loadStoredSession(ctx.sessionPersistence, started.childId)
    const prompts = loaded.events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'runtime-context'
      ? event.data.content.flatMap(block => block.type === 'text'
        && !block.text.startsWith('Your parent agent id is ')
        ? [block.text]
        : [])
      : [])
    expect(prompts).toEqual([
      'long work',
      `Agent ${parent.id} sent a message: `,
      'parked follow-up',
      `Agent ${parent.id} sent a message: `,
      'wake up',
    ])
  })

  it('lets a deep live ancestor interrupt a descendant it did not directly create', async () => {
    const releaseChild = Promise.withResolvers<undefined>()
    const releaseGrandchild = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child'), gate: releaseChild.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'child',
      request: { prompt: [{ type: 'text', text: 'child work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const grandchild = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'grandchild',
      request: { prompt: [{ type: 'text', text: 'grandchild work' }], parent: child },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    const cancelSpy = vi.spyOn(grandchildAgent, 'cancel')

    const result = await callTool(ctx, 'interrupt_agent', { agent_id: grandchild.childId }, parent)

    expect(result.isError).toBe(false)
    expect(cancelSpy).toHaveBeenCalledExactlyOnceWith({ kind: 'parent' }, { keepInbox: true })
    releaseChild.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('rejects self, sibling, and unrelated callers without touching the target', async () => {
    const releaseA = Promise.withResolvers<undefined>()
    const releaseB = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('a'), gate: releaseA.promise },
      { chunks: textResponse('b'), gate: releaseB.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const target = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'target',
      request: { prompt: [{ type: 'text', text: 'a' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const sibling = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'sibling',
      request: { prompt: [{ type: 'text', text: 'b' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const targetAgent = ctx.agents.get(target.childId)!
    const siblingAgent = ctx.agents.get(sibling.childId)!
    const stranger = await ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })
    const cancelSpy = vi.spyOn(targetAgent, 'cancel')

    const self = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, targetAgent)
    expect(self.isError).toBe(true)
    expect(text(self)).toContain('cannot interrupt itself')
    const fromSibling = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, siblingAgent)
    expect(fromSibling.isError).toBe(true)
    expect(text(fromSibling)).toContain('not a live descendant')
    const fromStranger = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, stranger)
    expect(fromStranger.isError).toBe(true)
    expect(text(fromStranger)).toContain('not a live descendant')
    expect(cancelSpy).not.toHaveBeenCalled()

    releaseA.resolve(undefined)
    releaseB.resolve(undefined)
    await waitNoActivation(ctx, target.childId)
    await waitNoActivation(ctx, sibling.childId)
  })

  it('accepts an absent target as a no-op without cold-resuming it', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'settled child',
      request: { prompt: [{ type: 'text', text: 'child work' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)

    const settled = await callTool(ctx, 'interrupt_agent', { agent_id: started.childId }, parent)
    expect(settled.isError).toBe(false)
    expect(text(settled)).toBe(`interrupt requested for agent ${started.childId}`)
    const unknown = await callTool(ctx, 'interrupt_agent', { agent_id: 'no-such-agent' }, parent)
    expect(unknown.isError).toBe(false)
    // No cold resume: the settled target never rematerialized.
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    const result = await callTool(ctx, 'interrupt_agent', { agent_id: 'x' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })
})
