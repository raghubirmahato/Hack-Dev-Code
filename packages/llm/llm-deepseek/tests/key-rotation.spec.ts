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

  const midStreamRefusal = (type: string) => new Response(sse([
    ...textEvents.slice(0, 3),
    { type: 'error', error: { type, message: 'refused mid stream' } },
  ]), { headers: { 'content-type': 'text/event-stream' } })

  it('rests the key after a mid-stream refusal and reports it retryable so the next attempt uses another key', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => midStreamRefusal('authentication_error')))
    const rotate = vi.fn(async () => authFor(['key-b']))

    await expect(chunks(adapter({}, { resolveAuth: async () => ({ headers: { 'x-api-key': 'key-a' }, rotate }) }).stream(options())))
      .rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(rotate).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
  })

  it('leaves a mid-stream refusal unchanged when no other key exists', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => midStreamRefusal('authentication_error')))
    const rotate = vi.fn(async () => undefined)

    await expect(chunks(adapter({}, { resolveAuth: async () => ({ headers: { 'x-api-key': 'key-a' }, rotate }) }).stream(options())))
      .rejects.toMatchObject({ code: 'AUTH' })
  })

  it('waits for a resting key before sending, and an abort ends the wait', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok())
    vi.stubGlobal('fetch', fetchImpl)
    const started = Date.now()
    await chunks(adapter({}, { resolveAuth: async () => ({ headers: { 'x-api-key': 'key-a' }, readyInMs: 50 }) }).stream(options()))
    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const controller = new AbortController()
    const pending = chunks(adapter({}, { resolveAuth: async () => ({ headers: { 'x-api-key': 'key-a' }, readyInMs: 60_000 }) })
      .stream(options({ signal: controller.signal })))
    setTimeout(() => { controller.abort() }, 10)
    await expect(pending).rejects.toBeDefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
