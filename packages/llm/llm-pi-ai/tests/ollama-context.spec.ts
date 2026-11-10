import { describe, expect, it } from 'vitest'
import { OLLAMA_DEFAULT_NUM_CTX, OllamaContext, isOllamaPort, ollamaRoot, ollamaVariantName } from '../src/ollama-context.ts'
import type { OllamaFetch } from '../src/ollama-context.ts'

/** A fake Ollama server: answers version, show and create, and records each call. */
function server(models: Record<string, { trained?: number; numCtx?: number }>, options: { version?: boolean; createOk?: boolean } = {}) {
  const calls: string[] = []
  const fetchImpl: OllamaFetch = async (url, init) => {
    const path = new URL(url).pathname
    type Body = { model?: string; from?: string; parameters?: { num_ctx?: number } }
    const body = init?.body === undefined ? {} : JSON.parse(init.body) as Body
    const size = body.parameters?.num_ctx === undefined ? '' : ` ${String(body.parameters.num_ctx)}`
    calls.push(`${path} ${body.model ?? ''}${size}`)
    if (path === '/api/version') return { ok: options.version !== false, json: async () => (options.version === false ? {} : { version: '0.40.15' }) }
    if (path === '/api/show') {
      const model = models[body.model ?? '']
      if (model === undefined) return { ok: false, json: async () => ({}) }
      return {
        ok: true,
        json: async () => ({
          model_info: model.trained === undefined ? {} : { 'gemma4.context_length': model.trained },
          parameters: model.numCtx === undefined ? 'temperature 1' : `temperature 1\nnum_ctx                        ${String(model.numCtx)}`,
        }),
      }
    }
    if (path === '/api/create') {
      const size = body.parameters?.num_ctx
      if (options.createOk !== false && body.model !== undefined) models[body.model] = size === undefined ? {} : { numCtx: size }
      return { ok: options.createOk !== false, json: async () => ({ status: 'success' }) }
    }
    return { ok: false, json: async () => ({}) }
  }
  return { calls, fetchImpl }
}

describe('Ollama context variants', () => {
  it('creates a variant with a larger context once and requests it from then on', async () => {
    const { calls, fetchImpl } = server({ 'gemma4:e2b': { trained: 131_072 } })
    const context = new OllamaContext(fetchImpl)
    expect(await context.modelFor('http://127.0.0.1:11434/v1', 'gemma4:e2b')).toBe('hackdev/gemma4:e2b')
    expect(await context.modelFor('http://127.0.0.1:11434/v1', 'gemma4:e2b')).toBe('hackdev/gemma4:e2b')
    expect(calls).toEqual([
      '/api/version ', '/api/show gemma4:e2b', '/api/show hackdev/gemma4:e2b', `/api/create hackdev/gemma4:e2b ${String(OLLAMA_DEFAULT_NUM_CTX)}`,
    ])
  })

  it('reuses an existing variant, keeps the trained limit and honours a configured context', async () => {
    const { calls, fetchImpl } = server({ 'phi3:mini': { trained: 16_384 }, 'hackdev/phi3:mini': { numCtx: 16_384 } })
    expect(await new OllamaContext(fetchImpl).modelFor('http://localhost:11434/v1', 'phi3:mini', 65_536)).toBe('hackdev/phi3:mini')
    expect(calls.some(call => call.startsWith('/api/create'))).toBe(false)
  })

  it('leaves the model alone when it already asks for enough context, is small, or is not on Ollama', async () => {
    const enough = server({ 'big:latest': { trained: 131_072, numCtx: 65_536 } })
    expect(await new OllamaContext(enough.fetchImpl).modelFor('http://127.0.0.1:11434/v1', 'big:latest')).toBe('big:latest')
    const small = server({ 'tiny:latest': { trained: 2_048 } })
    expect(await new OllamaContext(small.fetchImpl).modelFor('http://127.0.0.1:11434/v1', 'tiny:latest')).toBe('tiny:latest')
    const other = server({ 'm:latest': { trained: 131_072 } }, { version: false })
    expect(await new OllamaContext(other.fetchImpl).modelFor('http://127.0.0.1:1234/v1', 'm:latest')).toBe('m:latest')
    const remote = server({})
    expect(await new OllamaContext(remote.fetchImpl).modelFor('https://api.example.com/v1', 'm')).toBe('m')
    expect(remote.calls).toEqual([])
  })

  it('falls back to the original model when the variant cannot be created or the server fails', async () => {
    const refused = server({ 'gemma4:e2b': { trained: 131_072 } }, { createOk: false })
    expect(await new OllamaContext(refused.fetchImpl).modelFor('http://127.0.0.1:11434/v1', 'gemma4:e2b')).toBe('gemma4:e2b')
    const broken = new OllamaContext(async () => { throw new Error('connection refused') })
    expect(await broken.modelFor('http://127.0.0.1:11434/v1', 'gemma4:e2b')).toBe('gemma4:e2b')
  })

  it('names variants and recognises Ollama addresses', () => {
    expect(ollamaVariantName('gemma4:e2b')).toBe('hackdev/gemma4:e2b')
    expect(ollamaVariantName('user/model')).toBe('hackdev/user-model:latest')
    expect(ollamaRoot('http://192.168.1.20:11434/v1')).toBe('http://192.168.1.20:11434')
    expect(ollamaRoot('http://127.0.0.1:1234/v1')).toBeUndefined()
    expect(ollamaRoot('https://api.example.com/v1')).toBeUndefined()
    expect(ollamaRoot('not a url')).toBeUndefined()
    expect(isOllamaPort('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isOllamaPort('https://api.example.com/v1')).toBe(false)
    expect(isOllamaPort(undefined)).toBe(false)
  })
})

describe('Ollama context retries', () => {
  it('asks again after Ollama was not reachable, instead of remembering the failure', async () => {
    let up = false
    const live = server({ 'gemma4:e2b': { trained: 131_072 } })
    const fetchImpl: OllamaFetch = async (url, init) => {
      if (!up) throw new Error('connection refused')
      return live.fetchImpl(url, init)
    }
    const context = new OllamaContext(fetchImpl)
    expect(await context.modelFor('http://127.0.0.1:11434/v1', 'gemma4:e2b')).toBe('gemma4:e2b')
    up = true
    expect(await context.modelFor('http://127.0.0.1:11434/v1', 'gemma4:e2b')).toBe('hackdev/gemma4:e2b')
  })
})
