import { Context } from '@hackdevcode/cordis'
import AgentRegistry from '@hackdevcode/dsh-agent'
import SessionProjectionRegistry from '@hackdevcode/dsh-session-projection'
import type { Agent, AgentHandle, CreateAgentOptions } from '@hackdevcode/dsh-agent'
import type {} from '@hackdevcode/dsh-agent-preset-registry'
import { createUserMessage } from '@hackdevcode/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@hackdevcode/dsh-session'
import { RemoteError } from '@hackdevcode/dsh-typert-protocol'
import TypertRegistry from '@hackdevcode/dsh-typert-registry'
import type { Workspace, WorkspaceId } from '@hackdevcode/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiSessionAgentController,
  ApiSessionCwdConflict,
  type ApiSessionCreated,
  type ApiSessionCreateRequest,
} from '../src/agent.ts'
import { SessionCommandController, undoCut } from '../src/commands.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code })
}

/** The Agent controller with a fixed Agent composition, and optionally a fixed creation outcome. */
function controllerAgents(
  ctx: Context,
  fixed: {
    readonly composeAgent?: ApiSessionAgentController['composeAgent']
    readonly createSession?: ApiSessionAgentController['createSession']
  } = {},
): ApiSessionAgentController {
  const agents = new ApiSessionAgentController(ctx)
  vi.spyOn(agents, 'composeAgent').mockImplementation(fixed.composeAgent ?? (() => Promise.resolve({ setup: () => {} })))
  if (fixed.createSession !== undefined) vi.spyOn(agents, 'createSession').mockImplementation(fixed.createSession)
  return agents
}

/** A creation outcome that publishes `sessionId` in `cwd` as a stand-in Agent. */
function publishedSession(ctx: Context, sessionId: SessionId) {
  return (request: ApiSessionCreateRequest): Promise<ApiSessionCreated> => {
    const session = ctx.sessions.create(sessionId, { meta: { cwd: request.cwd } })
    return Promise.resolve({ agent: { id: session.id, session, status: 'idle', ctx } as Agent, agentPreset: undefined })
  }
}

async function baseContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  return ctx
}

describe('Session creation failures', () => {
  it('creates in the default cwd without a named identity when no explicit target is supplied', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [], archivedSessionIds: [] } as never)
    const createSession = vi.fn(publishedSession(ctx, SessionId('session-minted')))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx, { createSession }), '/default-workspace')

    const created = await controller.create({})

    expect(created).toEqual({ sessionId: 'session-minted' })
    expect(createSession).toHaveBeenCalledOnce()
    const request = createSession.mock.calls[0]?.[0]
    expect(request?.cwd).toBe('/default-workspace')
    expect(Object.keys(request ?? {}).sort()).toEqual(['cwd', 'reusable'])
    await ctx.fiber.dispose()
  })

  it('maps missing Workspaces and attachment failures', async () => {
    const missing = await baseContext()
    missing.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
    const missingController = new SessionCommandController(
      missing,
      controllerAgents(missing),
      '/default',
    )
    await expectFailure(missingController.create({
      workspaceId: 'missing' as WorkspaceId,
    }), 'workspace/not-found')
    await missing.fiber.dispose()

    const failed = await baseContext()
    const workspace = {
      id: 'workspace-1' as WorkspaceId,
      path: '/workspace',
      attachSession: () => Promise.reject(new Error('read-only workspace')),
    } as unknown as Workspace
    failed.provide('workspaceRegistry', {
      get: () => workspace,
      list: () => [workspace],
    } as never)
    const failedController = new SessionCommandController(
      failed,
      controllerAgents(failed, { createSession: publishedSession(failed, SessionId('workspace-session')) }),
      '/default',
    )
    await expectFailure(failedController.create({
      sessionId: SessionId('workspace-session'),
      workspaceId: workspace.id,
    }), 'session/workspace-attach-failed')
    await failed.fiber.dispose()
  })

  it.each([
    {
      error: new RemoteError(
        'agent-preset/invalid',
        'agent-presets: preset "broken" failed to mount: invalid composition',
        { agentPreset: 'broken', reason: 'invalid composition' },
      ),
      code: 'agent-preset/invalid',
    },
    {
      error: new ApiSessionCwdConflict(SessionId('cwd-less'), '/requested', undefined),
      code: 'session/conflict',
    },
    {
      error: new ApiSessionCwdConflict(SessionId('wrong-cwd'), '/requested', '/stored'),
      code: 'session/conflict',
    },
    {
      error: new Error('factory unavailable'),
      code: 'gateway/internal',
    },
  ])('maps $code creation failures', async ({ error, code }) => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
    const controller = new SessionCommandController(
      ctx,
      controllerAgents(ctx, { createSession: () => Promise.reject(error) }),
      '/default',
    )

    await expectFailure(controller.create({
      sessionId: SessionId('failed-create'), cwd: '/requested',
    }), code)
    await ctx.fiber.dispose()
  })

  it('rejects contradictory create targets', async () => {
    const ctx = await baseContext()
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.create({
      workspaceId: 'workspace-1' as WorkspaceId,
      cwd: '/workspace',
    }), 'gateway/bad-request')
    await ctx.fiber.dispose()
  })

})

function completedSession(
  ctx: Context,
  id: string,
  cwd?: string,
  lineage: { parentSession?: SessionId; origin?: 'subagent' } = {},
) {
  const session = ctx.sessions.create(SessionId(id), {
    meta: { ...(cwd === undefined ? {} : { cwd }), ...lineage },
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'work' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

function resolvedHandle(ctx: Context, sessionId: SessionId): AgentHandle {
  return {
    agent: { id: sessionId, status: 'idle', ctx } as Agent,
    dispose: () => Promise.resolve(),
  }
}

describe('Session fork failures', () => {
  it('maps missing cold sources with and without persistence', async () => {
    const withoutPersistence = await baseContext()
    withoutPersistence.provide('workspaceRegistry', { list: () => [] } as never)
    const unavailableController = new SessionCommandController(
      withoutPersistence, controllerAgents(withoutPersistence), '/default',
    )
    await expectFailure(unavailableController.fork({
      sessionId: SessionId('missing'),
    }), 'session/not-found')
    await withoutPersistence.fiber.dispose()

    const missing = await baseContext()
    missing.provide('workspaceRegistry', { list: () => [] } as never)
    missing.provide('sessionPersistence', testSessionPersistence(missing, {
      list: () => Promise.resolve([]),
      inspect: vi.fn(),
    }) as never)
    const missingController = new SessionCommandController(missing, controllerAgents(missing), '/default')
    await expectFailure(missingController.fork({
      sessionId: SessionId('missing'),
    }), 'session/not-found')
    await missing.fiber.dispose()
  })

  it('maps an observation failure to an internal fork error', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValue(new Error('storage offline'))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.fork({ sessionId: SessionId('unreadable') }), 'gateway/internal')
    await ctx.fiber.dispose()
  })

  it('rejects a Session with no completed turn', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const source = ctx.sessions.create(SessionId('empty-source'))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.fork({ sessionId: source.id }), 'session/fork-unavailable')
    await expect(controller.fork({ sessionId: source.id, atSeq: 0 })).rejects.toMatchObject({
      code: 'session/fork-unavailable',
      message: 'event 0 does not exist in session "empty-source" (last seq: none)',
    })
    await ctx.fiber.dispose()
  })

  it('maps lineage lookup and Agent creation failures', async () => {
    const lineage = await baseContext()
    lineage.provide('workspaceRegistry', { list: () => [] } as never)
    vi.spyOn(lineage.sessionQuery, 'traceSession')
      .mockRejectedValue(new Error('lineage unavailable'))
    const child = completedSession(lineage, 'subagent-source', '/workspace', {
      parentSession: SessionId('parent'),
      origin: 'subagent',
    })
    const lineageController = new SessionCommandController(lineage, controllerAgents(lineage), '/default')
    await expectFailure(lineageController.fork({ sessionId: child.id }), 'gateway/internal')
    await lineage.fiber.dispose()

    const creation = await baseContext()
    creation.provide('workspaceRegistry', { list: () => [] } as never)
    const source = completedSession(creation, 'creation-source', '/workspace')
    vi.spyOn(creation.agents, 'create').mockRejectedValue(new Error('factory failed'))
    const creationController = new SessionCommandController(creation, controllerAgents(creation), '/default')
    await expectFailure(creationController.fork({ sessionId: source.id }), 'gateway/internal')
    await creation.fiber.dispose()
  })

  it('omits absent cwd and preset metadata before reporting Workspace attachment failure', async () => {
    const ctx = await baseContext()
    const source = completedSession(ctx, 'workspace-source')
    const workspace = {
      id: 'workspace-1' as WorkspaceId,
      sessionIds: [source.id],
      attachSession: () => Promise.reject(new Error('workspace write failed')),
    } as unknown as Workspace
    ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation(
      (options: CreateAgentOptions) => Promise.resolve(resolvedHandle(ctx, options.sessionId)),
    )
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    await expectFailure(controller.fork({ sessionId: source.id }), 'session/workspace-attach-failed')
    const options = create.mock.calls[0]?.[0]
    if (options === undefined) throw new Error('Agent creation was not attempted')
    expect(options.meta).not.toHaveProperty('cwd')
    expect(options.meta).not.toHaveProperty('agentPreset')
    await ctx.fiber.dispose()
  })

  it('carries the composed Agent preset into the child metadata', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const source = completedSession(ctx, 'preset-source', '/workspace')
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation(
      (options: CreateAgentOptions) => Promise.resolve(resolvedHandle(ctx, options.sessionId)),
    )
    const controller = new SessionCommandController(ctx, controllerAgents(ctx, {
      composeAgent: () => Promise.resolve({ agentPreset: 'minimal', setup: () => {} }),
    }), '/default')

    const forked = await controller.fork({ sessionId: source.id })
    expect(forked.sessionId).toMatch(/^session-/)
    const options = create.mock.calls[0]?.[0]
    if (options === undefined) throw new Error('Agent creation was not attempted')
    expect(options.meta?.agentPreset).toBe('minimal')
    await ctx.fiber.dispose()
  })
})

describe('Session undo', () => {
  /** Two turns, each opened by the person's prompt; the second also has an assistant reply. */
  function twoTurnSession(ctx: Context, id: string) {
    const session = completedSession(ctx, id, '/workspace')
    const prompt = createUserMessage({ content: [{ type: 'text', text: 'second prompt' }], source: { kind: 'user' } })
    // The prompt is queued before its turn starts, as the Agent records it.
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [prompt] })
    session.append('turn/start', { turn: 2 })
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
    session.append('user/message', prompt, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    return session
  }

  it('cuts before the turn the newest prompt opened, puts its files back, and returns the prompt', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const source = twoTurnSession(ctx, 'undo-source')
    const restore = vi.fn((_sessionId: SessionId, _cwd: string, _afterTurn: number, _signal: AbortSignal) =>
      Promise.resolve({ restored: ['a.txt', 'b.txt'], removed: ['new.txt'] }))
    const inherit = vi.fn(() => Promise.resolve())
    ctx.provide('workspaceChanges', { restore, inherit } as never)
    const create = vi.spyOn(ctx.agents, 'create').mockImplementation((options: CreateAgentOptions) => Promise.resolve(resolvedHandle(ctx, options.sessionId)))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')

    const forked = await controller.fork({ sessionId: source.id, undoLastPrompt: true })
    expect(forked.undone).toEqual({ prompt: 'second prompt', restored: 2, removed: 1 })
    expect(restore.mock.calls[0]?.slice(0, 3)).toEqual([source.id, '/workspace', 1])
    expect(inherit).toHaveBeenCalledWith(source.id, forked.sessionId, '/workspace', 1)
    // The child keeps turn 1 and the queueing of the prompt, and nothing of turn 2.
    const turnOneEnd = source.snapshotEvents().find(event => event.type === 'turn/end')!
    expect(create.mock.calls[0]?.[0].inheritedEventCount).toBe(turnOneEnd.seq + 2)
    // The kept history ends with the prompt queued; the child cancels it so it does not wait to run again.
    expect(create.mock.calls[0]?.[0].seed?.at(-1)).toMatchObject({
      type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' },
    })
    await ctx.fiber.dispose()
  })

  it('undoes the only prompt into a blank Session and keeps files on a Host without change records', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const source = completedSession(ctx, 'undo-only', '/workspace')
    const createSession = vi.fn(publishedSession(ctx, SessionId('undo-blank')))
    const controller = new SessionCommandController(ctx, controllerAgents(ctx, { createSession }), '/default')

    const forked = await controller.fork({ sessionId: source.id, undoLastPrompt: true })
    expect(forked).toEqual({ sessionId: 'undo-blank', undone: { prompt: 'work', restored: 0, removed: 0 } })
    expect(createSession.mock.calls[0]?.[0].cwd).toBe('/workspace')
    await ctx.fiber.dispose()
  })

  it('refuses a Session without a prompt, and fails rather than undoing without the files', async () => {
    const ctx = await baseContext()
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    const empty = ctx.sessions.create(SessionId('undo-empty'), { meta: { cwd: '/workspace' } })
    empty.append('turn/start', { turn: 1 })
    empty.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const controller = new SessionCommandController(ctx, controllerAgents(ctx), '/default')
    await expectFailure(controller.fork({ sessionId: empty.id, undoLastPrompt: true }), 'session/fork-unavailable')
    const source = twoTurnSession(ctx, 'undo-refused')
    ctx.provide('workspaceChanges', { restore: () => Promise.reject(new Error('not a repository')) } as never)
    await expectFailure(controller.fork({ sessionId: source.id, undoLastPrompt: true }), 'session/undo-failed')
    await ctx.fiber.dispose()
  })

  it('cuts a prompt sent into a running turn on its own, keeping that turn', () => {
    const events = [
      { type: 'turn/start', seq: 0, data: { turn: 1 } },
      { type: 'user/message', seq: 1, surfaceOp: 'append', data: createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }) },
      { type: 'assistant/message', seq: 2, data: {} },
      { type: 'user/message', seq: 3, surfaceOp: 'append', data: createUserMessage({ content: [{ type: 'text', text: 'also this' }], source: { kind: 'user' } }) },
    ] as unknown as SessionEvent[]
    expect(undoCut(events)).toEqual({ boundary: 2, afterTurn: 1, prompt: 'also this' })
    expect(undoCut(events.slice(0, 2))).toEqual({ boundary: -1, afterTurn: 0, prompt: 'first' })
    expect(undoCut(events.slice(0, 1))).toBeUndefined()
  })
})
