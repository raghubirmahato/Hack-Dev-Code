/**
 * The person's custom instructions reach every request as numbered standing orders, with a short reminder beside
 * the newest message on the first step of each turn.
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

async function harness(script: StreamChunk[][], customInstructions: string): Promise<{ ctx: Context; adapter: MockAdapter; agent: Agent }> {
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
  await ctx.plugin(AgentLoop, { agents: [], customInstructions })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'look', description: 'look', parameters: {},
    async execute() { return [{ type: 'text', text: 'seen' }] },
  }))
  const agent = await ctx.agentLoop.create(SessionId('custom-instructions'), { provider: 'mock', model: 'mock' })
  return { ctx, adapter, agent }
}

function runTurn(ctx: Context, agent: Agent, text = 'go'): Promise<void> {
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  return idle
}

const REMINDER = "(Note from Hack Dev Code, not a request from the person: keep following the person's 2 custom instructions from the system prompt. Reply to the person's message that follows.)"

describe('custom instructions in requests', () => {
  it('sends numbered standing orders and reminds once per turn', async () => {
    const { ctx, adapter, agent } = await harness(
      [toolCallResponse('c1', 'look', {}), textResponse('done'), textResponse('again')],
      'Answer in British English.\nUse tabs.',
    )
    await runTurn(ctx, agent)
    const [first, second] = adapter.requests.map(request => JSON.stringify(request))
    expect(first).toContain('<custom_instructions>\\n1. Answer in British English.\\n2. Use tabs.\\n</custom_instructions>')
    expect(first).toContain(REMINDER)
    // The note comes before the person's message, so the model answers the person and not the note.
    const messages = JSON.stringify(adapter.requests[0]?.messages ?? [])
    expect(messages.indexOf(REMINDER)).toBeGreaterThan(-1)
    expect(messages.indexOf(REMINDER)).toBeLessThan(messages.lastIndexOf('"go"'))
    // Occurrences per request; one reminder message serializes its text more than once.
    const count = (request: unknown): number => JSON.stringify(request).split(REMINDER).length - 1
    const once = count(adapter.requests[0])
    expect(once).toBeGreaterThan(0)
    // The step after the tool result belongs to the same turn: no second reminder is added.
    expect(second?.split(REMINDER).length).toBe(once + 1)
    await runTurn(ctx, agent, 'next')
    // A new turn adds one more reminder beside the new message.
    expect(count(adapter.requests[2])).toBe(once * 2)
  })

  it('adds nothing when there are no custom instructions', async () => {
    const { ctx, adapter, agent } = await harness([textResponse('done')], '  ')
    await runTurn(ctx, agent)
    const request = JSON.stringify(adapter.requests[0])
    expect(request).not.toContain('custom_instructions')
    expect(request).not.toContain('custom instruction')
  })
})
