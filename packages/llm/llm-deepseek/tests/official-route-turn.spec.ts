/** Turns on the official endpoint report credential failures on the model request, after the prompt is recorded. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import LlmRuntime, { createUserMessage } from '@hackdevcode/dsh-llm'
import AgentRegistry from '@hackdevcode/dsh-agent'
import AgentLoop from '@hackdevcode/dsh-agent-loop'
import SessionStore, { SessionId } from '@hackdevcode/dsh-session'
import SessionProjectionRegistry from '@hackdevcode/dsh-session-projection'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import ToolRuntime from '@hackdevcode/dsh-tools'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import * as DeepSeek from '@hackdevcode/dsh-llm-deepseek-api-key'
import * as LlmRetry from '@hackdevcode/dsh-llm-retry'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('records the prompt and fails the request when the official endpoint has a malformed key', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'invalid\nheader')
  const fetch = vi.spyOn(globalThis, 'fetch')
  const ctx = new Context()
  contexts.push(ctx)
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) {
    await ctx.plugin(plugin)
  }
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(DeepSeek, {})
  const agent = await ctx.agentLoop.create(SessionId('malformed-official-key'), { provider: 'deepseek-official', model: 'deepseek-flash' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const events = agent.session.snapshotEvents()
  expect(events.map(event => event.type)).toContain('user/message')
  expect(events.find(event => event.type === 'assistant/attempt')?.data).toMatchObject({
    stream: [{ chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_CREDENTIAL' } } } }],
  })
  expect(fetch).not.toHaveBeenCalled()
})

it('continues the same turn on the next stored key after a rate limit', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'key-a,key-b')
  const sent: string[] = []
  const reply = (events: unknown[]) => events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (!target.endsWith('/messages')) return new Response('{}', { status: 404 })
    const key = (init?.headers as Record<string, string>)['x-api-key'] ?? ''
    sent.push(key)
    if (key === 'key-a') return new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429 })
    return new Response(reply([
      { type: 'message_start', message: { id: 'm1', model: 'deepseek-v4-flash', usage: { input_tokens: 3, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]), { headers: { 'content-type': 'text/event-stream' } })
  })
  const ctx = new Context()
  contexts.push(ctx)
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) {
    await ctx.plugin(plugin)
  }
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(DeepSeek, {})
  const agent = await ctx.agentLoop.create(SessionId('rotating-official-key'), { provider: 'deepseek-official', model: 'deepseek-flash' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(sent).toEqual(['key-a', 'key-b'])
  const attempts = agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')
  expect(attempts).toHaveLength(1)
  expect(JSON.stringify(attempts[0]?.data)).toContain('done')
})

it('finishes the same step on the next key when a rate limit cuts the reply short', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'key-a,key-b')
  const sent: string[] = []
  const frames = (events: unknown[]) => events.map(event => `event: ${(event as { type: string }).type}
data: ${JSON.stringify(event)}

`).join('')
  const start = { type: 'message_start', message: { id: 'm1', model: 'deepseek-v4-flash', usage: { input_tokens: 3, output_tokens: 1 } } }
  const textStart = { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
  const text = (value: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: value } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (!target.endsWith('/messages')) return new Response('{}', { status: 404 })
    const key = (init?.headers as Record<string, string>)['x-api-key'] ?? ''
    sent.push(key)
    const body = key === 'key-a'
      ? [start, textStart, text('par'), { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }]
      : [start, textStart, text('complete answer'), { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }, { type: 'message_stop' }]
    return new Response(frames(body), { headers: { 'content-type': 'text/event-stream' } })
  })
  const ctx = new Context()
  contexts.push(ctx)
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) {
    await ctx.plugin(plugin)
  }
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmRetry)
  await ctx.plugin(DeepSeek, {})
  const agent = await ctx.agentLoop.create(SessionId('midstream-rotation'), { provider: 'deepseek-official', model: 'deepseek-flash' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(sent).toEqual(['key-a', 'key-b'])
  const events = agent.session.snapshotEvents()
  expect(events.map(event => event.type)).toContain('llm/retry')
  expect(JSON.stringify(events.filter(event => event.type === 'assistant/message').map(event => event.data))).toContain('complete answer')
})
