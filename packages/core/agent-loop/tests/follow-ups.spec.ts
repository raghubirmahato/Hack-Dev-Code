/**
 * The loop's own follow-ups for replies weaker models get wrong: a tool call written as text, and a reply cut off at
 * the output-token limit when continuations are configured.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import LlmRuntime, { createUserMessage } from '@hackdevcode/dsh-llm'
import type { StreamChunk } from '@hackdevcode/dsh-llm'
import SessionStore, { SessionId } from '@hackdevcode/dsh-session'
import type { TurnEndReason } from '@hackdevcode/dsh-session'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import ToolRuntime from '@hackdevcode/dsh-tools'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import AgentRegistry, { type Agent } from '@hackdevcode/dsh-agent'
import AgentLoop from '@hackdevcode/dsh-agent-loop'
import SessionProjectionRegistry from '@hackdevcode/dsh-session-projection'
import { MockAdapter, maxTokensResponse, textResponse } from './mock-adapter.ts'
import { MAX_TOKENS_FOLLOW_UP, TEXT_TOOL_CALL_FOLLOW_UP, writesToolCallAsText } from '../src/agent.ts'

async function harness(
  script: StreamChunk[][], maxTokensContinuations?: number,
): Promise<{ ctx: Context; adapter: MockAdapter; agent: Agent }> {
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
  await ctx.plugin(AgentLoop, { agents: [], ...maxTokensContinuations === undefined ? {} : { maxTokensContinuations } })
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('follow-ups'), { provider: 'mock', model: 'mock' })
  return { ctx, adapter, agent }
}

async function runTurn(ctx: Context, agent: Agent): Promise<TurnEndReason[]> {
  const reasons: TurnEndReason[] = []
  ctx.on('session/event', (_session, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle
  return reasons
}

const carries = (text: string) => (request: unknown): boolean => JSON.stringify(request).includes(JSON.stringify(text).slice(1, -1))

describe('a tool call written as text', () => {
  it('recognizes the markup models use, and leaves ordinary answers alone', () => {
    const text = (value: string) => [{ type: 'text', text: value }]
    expect(writesToolCallAsText(text('<tool_call>\n{"name": "read", "arguments": {"path": "a"}}\n</tool_call>'))).toBe(true)
    expect(writesToolCallAsText(text('<function=bash>{"command": "ls"}</function>'))).toBe(true)
    expect(writesToolCallAsText(text('{"name": "read", "arguments": {"path": "a.ts"}}'))).toBe(true)
    expect(writesToolCallAsText(text('<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function'))).toBe(true)
    expect(writesToolCallAsText(text('Done. I updated the name field in config.json.'))).toBe(false)
    expect(writesToolCallAsText(text('The response looks like {"status": "ok", "count": 3}.'))).toBe(false)
  })

  it('asks once for a real call, then ends the turn with the next answer', async () => {
    const { ctx, adapter, agent } = await harness([
      textResponse('<tool_call>{"name": "look", "arguments": {}}</tool_call>'),
      textResponse('<tool_call>{"name": "look", "arguments": {}}</tool_call>'),
    ])
    const reasons = await runTurn(ctx, agent)
    expect(adapter.requests.map(carries(TEXT_TOOL_CALL_FOLLOW_UP))).toEqual([false, true])
    expect(reasons).toEqual([{ kind: 'completed' }])
  })
})

describe('a reply cut off at the output limit', () => {
  it('ends the turn as max-tokens by default', async () => {
    const { ctx, adapter, agent } = await harness([maxTokensResponse('partial')])
    expect(await runTurn(ctx, agent)).toEqual([{ kind: 'max-tokens' }])
    expect(adapter.requests).toHaveLength(1)
  })

  it('asks to continue in smaller pieces up to the configured count, then ends as max-tokens', async () => {
    const { ctx, adapter, agent } = await harness([maxTokensResponse('part 1'), maxTokensResponse('part 2'), maxTokensResponse('part 3')], 2)
    expect(await runTurn(ctx, agent)).toEqual([{ kind: 'max-tokens' }])
    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests.map(carries(MAX_TOKENS_FOLLOW_UP))).toEqual([false, true, true])
  })

  it('finishes normally when the continuation completes', async () => {
    const { ctx, adapter, agent } = await harness([maxTokensResponse('part 1'), textResponse('the rest')], 2)
    expect(await runTurn(ctx, agent)).toEqual([{ kind: 'completed' }])
    expect(adapter.requests).toHaveLength(2)
  })
})
