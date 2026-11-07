/**
 * A model that answers tool results with an empty message is asked once to continue, so the turn does not end
 * silently with unfinished work and no answer.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import LlmRuntime, { createUserMessage } from '@hackdevcode/dsh-llm'
import type { StreamChunk } from '@hackdevcode/dsh-llm'
import SessionStore, { SessionId } from '@hackdevcode/dsh-session'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import ToolRuntime from '@hackdevcode/dsh-tools'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import { defineContentToolFixture } from '@hackdevcode/dsh-tool-testkit'
import AgentRegistry, { type Agent } from '@hackdevcode/dsh-agent'
import AgentLoop from '@hackdevcode/dsh-agent-loop'
import SessionProjectionRegistry from '@hackdevcode/dsh-session-projection'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'
import { EMPTY_REPLY_FOLLOW_UP } from '../src/agent.ts'

async function harness(script: StreamChunk[][]): Promise<{ ctx: Context; adapter: MockAdapter; agent: Agent }> {
  const adapter = new MockAdapter(script)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin({
    inject: ['tools'],
    apply(owner: Context) { owner.tools.setExecutor(new NativeToolExecutor.NativeToolExecutor(owner, () => 10)) },
  })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'look', description: 'look', parameters: {},
    async execute() { return [{ type: 'text', text: 'seen' }] },
  }))
  const agent = await ctx.agentLoop.create(SessionId('empty-reply'), { provider: 'mock', model: 'mock' })
  return { ctx, adapter, agent }
}

function runTurn(ctx: Context, agent: Agent): Promise<void> {
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  return idle
}

/** Whether a request carries the loop's follow-up text. */
function asksToContinue(request: unknown): boolean {
  return JSON.stringify(request).includes(EMPTY_REPLY_FOLLOW_UP)
}

describe('empty reply after tool work', () => {
  it('asks the model once to continue and ends with its answer', async () => {
    const { ctx, adapter, agent } = await harness([toolCallResponse('c1', 'look', {}), textResponse(''), textResponse('all done')])
    await runTurn(ctx, agent)
    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests.map(asksToContinue)).toEqual([false, false, true])
    const ends = agent.session.snapshotEvents().filter(event => event.type === 'turn/end')
    expect(ends).toHaveLength(1)
  })

  it('does not ask twice in one turn', async () => {
    const { ctx, adapter, agent } = await harness([toolCallResponse('c1', 'look', {}), textResponse(''), textResponse('')])
    await runTurn(ctx, agent)
    expect(adapter.requests).toHaveLength(3)
  })

  it('leaves an empty first reply alone, since no tool work is pending', async () => {
    const { ctx, adapter, agent } = await harness([textResponse('')])
    await runTurn(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
  })

  it('leaves a reply with text alone', async () => {
    const { ctx, adapter, agent } = await harness([toolCallResponse('c1', 'look', {}), textResponse('finished')])
    await runTurn(ctx, agent)
    expect(adapter.requests).toHaveLength(2)
  })
})
