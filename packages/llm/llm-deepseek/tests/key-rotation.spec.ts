/** A refused credential is swapped for the next one and the identical request is sent again. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeepSeekRequestAuth } from '../src/index.ts'
import { adapter, chunks, options, sse, textEvents } from './helpers.ts'

afterEach(() => { vi.unstubAllGlobals() })

const refusal = (status: number) => new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }), { status })
const ok = () => new Response(sse(textEvents), { headers: { 'content-type': 'text/event-stream' } })

function authFor(keys: string[], index = 0): DeepSeekRequestAuth {
  return {
    headers: { 'x-api-key': keys[index] ?? '' },
    rotate: async ({ status }) => (status === 429 && index + 1 < keys.length ? authFor(keys, index + 1) : undefined),
  }
}

describe('credential rotation', () => {
  it('resends the identical request with the next key after a rate limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(refusal(429))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchImpl)

    const output = await chunks(adapter({}, { resolveAuth: async () => authFor(['key-a', 'key-b']) }).stream(options()))

    expect(output.length).toBeGreaterThan(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [first, second] = fetchImpl.mock.calls.map(call => call[1] as RequestInit)
    expect((first?.headers as Record<string, string>)['x-api-key']).toBe('key-a')
    expect((second?.headers as Record<string, string>)['x-api-key']).toBe('key-b')
    expect(second?.body).toBe(first?.body)
  })

  it('surfaces the failure once every key was refused', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => refusal(429))
    vi.stubGlobal('fetch', fetchImpl)

    await expect(chunks(adapter({}, { resolveAuth: async () => authFor(['key-a', 'key-b']) }).stream(options())))
      .rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not rotate when the provider offers no other credential', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => refusal(429))
    vi.stubGlobal('fetch', fetchImpl)

    await expect(chunks(adapter().stream(options()))).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
