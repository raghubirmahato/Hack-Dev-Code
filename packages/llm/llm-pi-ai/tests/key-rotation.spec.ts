/** A refused key is swapped for the next stored key and the same context is sent again. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import LlmRuntime, { createUserMessage } from '@hackdevcode/dsh-llm'
import { PiAiAdapter } from '@hackdevcode/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => { await closeMockServers() })

const rateLimited = { status: 429, body: JSON.stringify({ error: { message: 'Too Many Requests (429)' } }) }

async function contextWith(url: string, keys: string[]): Promise<{ ctx: Context; asked: Set<string>[] }> {
  const asked: Set<string>[] = []
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['deepseek'], new PiAiAdapter({
    profiles: () => resolveProfiles({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: url } }),
    resolveApiKey: () => Promise.resolve(keys[0]),
    rotateApiKey: (_provider, _profile, refused) => {
      asked.push(new Set(refused))
      return Promise.resolve(keys.find(key => !refused.has(key)))
    },
    auth: memoryAuth(),
  }))
  return { ctx, asked }
}

const hello = () => [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })]

describe('pi-ai key rotation', () => {
  it('retries the same request with the next key after a rate limit', async () => {
    const server = await mockServer([rateLimited, { events: textEvents }])
    const { ctx } = await contextWith(server.url, ['key-a', 'key-b'])

    const result = await assemble(ctx, { model: 'deepseek-flash', messages: hello() })

    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]).toEqual(server.requests[0])
    expect(String(server.headers[0]?.['authorization'])).toContain('key-a')
    expect(String(server.headers[1]?.['authorization'])).toContain('key-b')
  })

  it('reports the failure once no untried key is left', async () => {
    const server = await mockServer([rateLimited, rateLimited])
    const { ctx, asked } = await contextWith(server.url, ['key-a', 'key-b'])

    const result = await assemble(ctx, { model: 'deepseek-flash', messages: hello() })

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
    expect(server.requests).toHaveLength(2)
    expect(asked).toHaveLength(2)
  })

  it('marks a refusal after output began as retryable and rests the key for the next attempt', async () => {
    const server = await mockServer([{
      events: [
        '{"choices":[{"delta":{"role":"assistant","content":"par"},"index":0,"finish_reason":null}]}',
        '{"error":{"message":"429 Too Many Requests: rate limit exceeded"}}',
      ],
    }])
    const { ctx, asked } = await contextWith(server.url, ['key-a', 'key-b'])

    const result = await assemble(ctx, { model: 'deepseek-flash', messages: hello() })

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
    expect(server.requests).toHaveLength(1)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.has('key-a')).toBe(true)
  })

  it('reports a quota exhausted on every key as a rate limit, so the step is retried once a key recovers', async () => {
    const quota = { status: 429, body: JSON.stringify({ error: { message: 'Request quota exhausted: insufficient quota' } }) }
    const server = await mockServer([quota, quota])
    const { ctx } = await contextWith(server.url, ['key-a', 'key-b'])

    const result = await assemble(ctx, { model: 'deepseek-flash', messages: hello() })

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
    expect(server.requests).toHaveLength(2)
  })

  it('sends the same request to the next fallback model when the requested one is overloaded', async () => {
    const busy = { status: 503, body: JSON.stringify({ error: { message: 'This model is currently experiencing high demand (503 UNAVAILABLE)' } }) }
    const server = await mockServer([busy, { events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['deepseek'], new PiAiAdapter({
      profiles: () => resolveProfiles({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, fallbackModels: ['deepseek-v4-pro'] } }),
      resolveApiKey: () => Promise.resolve('key-a'),
      auth: memoryAuth(),
    }))

    const result = await assemble(ctx, { model: 'deepseek-flash', messages: hello() })

    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.requests).toHaveLength(2)
    expect(JSON.stringify(server.requests[0])).not.toContain('deepseek-v4-pro')
    expect(JSON.stringify(server.requests[1])).toContain('deepseek-v4-pro')
  })

  it('moves to the fallback model when every key used up the requested model, and keeps a daily quota final', async () => {
    const daily = { status: 429, body: JSON.stringify({ error: { message: 'Quota exceeded: generate content requests per day limit exceeded. Please retry in 22h23m.' } }) }
    const server = await mockServer([daily, daily, { events: textEvents }, { events: textEvents }])
    const { ctx } = await contextWith(server.url, ['key-a', 'key-b'])
    ctx.llm.registerAdapter(['fallback'], new PiAiAdapter({
      profiles: () => resolveProfiles({ fallback: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, api: 'openai-completions', models: [{ id: 'big' }, { id: 'small' }], fallbackModels: ['small'] } }),
      resolveApiKey: () => Promise.resolve('key-a'),
      rotateApiKey: (_provider, _profile, refused) => Promise.resolve(['key-a', 'key-b'].find(key => !refused.has(key))),
      auth: memoryAuth(),
    }))

    const result = await assemble(ctx, { provider: 'fallback', model: 'big', messages: hello() })

    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.requests).toHaveLength(3)
    expect(JSON.stringify(server.requests[2])).toContain('small')
    // The next step starts on the model that answered instead of spending a request on the exhausted one.
    const next = await assemble(ctx, { provider: 'fallback', model: 'big', messages: hello() })
    expect(next.finish).toEqual({ kind: 'stop' })
    expect(server.requests).toHaveLength(4)
    expect(JSON.stringify(server.requests[3])).toContain('small')

    const final = await mockServer([daily, daily])
    const plain = await contextWith(final.url, ['key-a', 'key-b'])
    const exhausted = await assemble(plain.ctx, { model: 'deepseek-flash', messages: hello() })
    expect(exhausted.finish).toMatchObject({ kind: 'error', failure: { code: 'QUOTA' } })
  })
})
