/**
 * Live key-pool check against Gemini. Skipped unless GEMINI_POOL holds two or more comma-separated keys;
 * the keys are read from the environment only and never printed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import LlmRuntime, { ApiKeyPool, createUserMessage, splitApiKeys } from '@hackdevcode/dsh-llm'
import { PiAiAdapter } from '@hackdevcode/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'

const pool = process.env['GEMINI_POOL'] ?? ''
const keys = splitApiKeys(pool)
const sharedPool = new ApiKeyPool()
const MODEL = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash'

afterEach(() => { vi.restoreAllMocks() })

describe.skipIf(keys.length < 2)('Gemini key pool (live)', () => {
  interface Turn { used: string[]; reply: string; finish: string; detail?: string }
  async function ask(stored: string, text: string, keyPool = sharedPool): Promise<Turn> {
    vi.restoreAllMocks()
    const used: string[] = []
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const headers = new Headers(init?.headers)
      const key = headers.get('x-goog-api-key') ?? new URL(input instanceof Request ? input.url : input).searchParams.get('key') ?? ''
      const response = await real(input, init)
      used.push(`key#${splitApiKeys(stored).indexOf(key)}:${response.status}`)
      return response
    })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['google'], new PiAiAdapter({
      profiles: () => resolveProfiles({ google: { apiKeyEnv: 'GEMINI_POOL' } }),
      resolveApiKey: () => Promise.resolve(keyPool.next('GEMINI_POOL', stored)),
      rotateApiKey: (_provider, _profile, refused) => {
        for (const key of refused) keyPool.report(key)
        for (let attempt = 0; attempt < splitApiKeys(stored).length; attempt++) {
          const key = keyPool.next('GEMINI_POOL', stored)
          if (!refused.has(key)) return Promise.resolve(key)
        }
        return Promise.resolve(undefined)
      },
      auth: memoryAuth(),
    }))
    const result = await assemble(ctx, {
      provider: 'google',
      model: MODEL,
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })],
    })
    const reply = result.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    await ctx.fiber.dispose()
    return { used, reply, finish: result.finish.kind, ...result.finish.kind === 'error' ? { detail: result.finish.failure.message.replace(/AQ\.[A-Za-z0-9_-]+/g, '<key>').slice(0, 300) } : {} }
  }

  it('rotates across the stored keys on successive requests', async () => {
    const first = await ask(pool, 'Reply with the single word: alpha')
    const second = await ask(pool, 'Reply with the single word: beta')
    console.log('requests', first.used, second.used, first.finish, second.finish, first.detail, second.detail)
    expect(first.finish).toBe('stop')
    expect(first.reply.length).toBeGreaterThan(0)
    expect(second.reply.length).toBeGreaterThan(0)
    expect(first.used[0]?.slice(0, 5)).not.toBe(second.used[0]?.slice(0, 5))
  }, 60_000)

  it('moves past a refused key and still answers the same request', async () => {
    const stored = `not-a-real-key,${pool}`
    const turn = await ask(stored, 'Reply with the single word: gamma', new ApiKeyPool())
    console.log('failover', turn.used, turn.finish, turn.detail)
    expect(turn.used[0]).toMatch(/^key#0:(?:400|401|403)$/)
    expect(turn.finish).toBe('stop')
    expect(turn.reply.length).toBeGreaterThan(0)
  }, 60_000)
})
