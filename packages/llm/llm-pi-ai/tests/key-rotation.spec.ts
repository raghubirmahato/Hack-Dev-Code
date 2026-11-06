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
})
