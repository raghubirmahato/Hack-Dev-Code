import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'
import type { StreamChunk } from '@hackdevcode/dsh-llm'
import { withOllamaFacts } from '../src/discovery.ts'
import { OllamaContext, describeOllamaModels, isLocalHost, isLocalModelServer, isOllamaRoute, ollamaRoot } from '../src/ollama-context.ts'
import type { OllamaFetch } from '../src/ollama-context.ts'
import { mapStopReason, recoverGemmaToolCalls, recoverInlineToolCalls, toStreamChunks } from '../src/stream.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** A fake Ollama server answering version and show, recording each path it was asked. */
function ollama(models: Record<string, { trained?: number; capabilities?: string[] }>, version = true) {
  const calls: string[] = []
  const fetchImpl: OllamaFetch = async (url, init) => {
    const path = new URL(url).pathname
    const body = init?.body === undefined ? {} : JSON.parse(init.body) as { model?: string }
    calls.push(`${path} ${body.model ?? ''}`.trim())
    if (path === '/api/version') return { ok: version, json: async () => (version ? { version: '0.40.15' } : { error: 'not found' }) }
    const model = models[body.model ?? '']
    if (path !== '/api/show' || model === undefined) return { ok: false, json: async () => ({}) }
    return {
      ok: true,
      json: async () => ({
        model_info: model.trained === undefined ? {} : { 'llama.context_length': model.trained },
        parameters: 'temperature 1',
        ...model.capabilities === undefined ? {} : { capabilities: model.capabilities },
      }),
    }
  }
  return { calls, fetchImpl }
}

describe('finding a local model server', () => {
  it('knows this machine and private networks from the public internet', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.255', 'gpu-box.local', 'host.docker.internal', '100.100.1.1']) {
      expect(isLocalHost(host), host).toBe(true)
    }
    for (const host of ['api.openai.com', '8.8.8.8', '172.32.0.1', '192.169.1.1', '11.0.0.1', 'example.com', '1.2.3']) {
      expect(isLocalHost(host), host).toBe(false)
    }
  })

  it('takes a server for Ollama on its port, or on any port for a route set up as Ollama', () => {
    expect(isOllamaRoute('ollama')).toBe(true)
    expect(isOllamaRoute('Ollama-2')).toBe(true)
    expect(isOllamaRoute('lmstudio')).toBe(false)
    expect(isOllamaRoute(undefined)).toBe(false)
    expect(ollamaRoot('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434')
    expect(ollamaRoot('http://127.0.0.1:8080/v1')).toBeUndefined()
    expect(ollamaRoot('http://gpu-box.local:8080/v1', true)).toBe('http://gpu-box.local:8080')
    expect(ollamaRoot('https://ollama.example.com/v1', true)).toBe('https://ollama.example.com')
    expect(isLocalModelServer('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalModelServer('https://ollama.example.com/v1', 'ollama')).toBe(true)
    expect(isLocalModelServer('https://api.openai.com/v1', 'openai')).toBe(false)
    expect(isLocalModelServer(undefined)).toBe(false)
    expect(isLocalModelServer('not a url')).toBe(false)
  })

  it('serves an Ollama route on another port through the larger-context variant', async () => {
    const calls: string[] = []
    const fetchImpl: OllamaFetch = async (url, init) => {
      const path = new URL(url).pathname
      calls.push(path)
      if (path === '/api/version') return { ok: true, json: async () => ({ version: '0.40.15' }) }
      if (path === '/api/show') {
        const model = (JSON.parse(init?.body ?? '{}') as { model: string }).model
        return model.startsWith('hackdev/') ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ model_info: { 'qwen3.context_length': 40_960 } }) }
      }
      return { ok: true, json: async () => ({ status: 'success' }) }
    }
    const context = new OllamaContext(fetchImpl)
    // Without the route's name, a server on another port is left alone and never asked.
    expect(await context.modelFor('http://192.168.1.20:8080/v1', 'qwen3:8b')).toBe('qwen3:8b')
    expect(calls).toEqual([])
    expect(await context.modelFor('http://192.168.1.20:8080/v1', 'qwen3:8b', undefined, true)).toBe('hackdev/qwen3:8b')
    expect(calls).toContain('/api/create')
  })

  it('asks a server that is not Ollama only once in a while', async () => {
    const { calls, fetchImpl } = ollama({}, false)
    const context = new OllamaContext(fetchImpl)
    expect(await context.modelFor('http://127.0.0.1:1234/v1', 'local-model', undefined, true)).toBe('local-model')
    expect(await context.modelFor('http://127.0.0.1:1234/v1', 'local-model', undefined, true)).toBe('local-model')
    expect(await context.modelFor('http://127.0.0.1:1234/v1', 'other-model', undefined, true)).toBe('other-model')
    expect(calls).toEqual(['/api/version'])
  })
})

describe('what Ollama says about its models', () => {
  it('reads each model\'s trained context and capabilities', async () => {
    const { fetchImpl } = ollama({
      'qwen3:8b': { trained: 40_960, capabilities: ['completion', 'tools', 'thinking'] },
      'llava:7b': { trained: 4_096, capabilities: ['completion', 'vision'] },
      'old:latest': { trained: 8_192 },
    })
    const facts = await describeOllamaModels('http://127.0.0.1:11434/v1', ['qwen3:8b', 'llava:7b', 'old:latest', 'gone:latest'], false, fetchImpl)
    expect(facts.get('qwen3:8b')).toEqual({ trained: 40_960, capabilities: ['completion', 'tools', 'thinking'] })
    expect(facts.get('llava:7b')).toEqual({ trained: 4_096, capabilities: ['completion', 'vision'] })
    expect(facts.get('old:latest')).toEqual({ trained: 8_192 })
    expect(facts.has('gone:latest')).toBe(false)
  })

  it('says nothing about a server that is not Ollama, is elsewhere, or does not answer', async () => {
    const other = ollama({ 'm:latest': { trained: 8_192 } }, false)
    expect((await describeOllamaModels('http://127.0.0.1:11434/v1', ['m:latest'], false, other.fetchImpl)).size).toBe(0)
    const elsewhere = ollama({ 'm:latest': { trained: 8_192 } })
    expect((await describeOllamaModels('https://api.example.com/v1', ['m:latest'], false, elsewhere.fetchImpl)).size).toBe(0)
    expect(elsewhere.calls).toEqual([])
    const down: OllamaFetch = () => Promise.reject(new Error('connect ECONNREFUSED'))
    expect((await describeOllamaModels('http://127.0.0.1:11434/v1', ['m:latest'], false, down)).size).toBe(0)
  })

  it('completes a listing: real context, image input, tool calling, and no embedding models', async () => {
    const { fetchImpl } = ollama({
      'qwen3:8b': { trained: 40_960, capabilities: ['completion', 'tools'] },
      'tinyllama:latest': { trained: 2_048, capabilities: ['completion'] },
      'llava:7b': { trained: 131_072, capabilities: ['completion', 'vision'] },
      'nomic-embed-text:latest': { trained: 8_192, capabilities: ['embedding'] },
    })
    vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => fetchImpl(url, init))
    const listed = ['qwen3:8b', 'tinyllama:latest', 'llava:7b', 'nomic-embed-text:latest', 'unknown:latest', 'hackdev/qwen3:8b'].map(id => ({ id, name: id }))
    expect(await withOllamaFacts(listed, 'http://127.0.0.1:11434/v1')).toEqual([
      // Capped to the context Hack Dev Code serves an Ollama model with.
      { id: 'qwen3:8b', name: 'qwen3:8b', contextWindow: 32_768, inputModalities: ['text'], toolCalling: true },
      // A small model keeps its real, small context, so compaction happens before the prompt overflows.
      { id: 'tinyllama:latest', name: 'tinyllama:latest', contextWindow: 2_048, inputModalities: ['text'], toolCalling: false },
      { id: 'llava:7b', name: 'llava:7b', contextWindow: 32_768, inputModalities: ['text', 'image'], toolCalling: false },
      { id: 'unknown:latest', name: 'unknown:latest' },
    ])
    // Another kind of server on another port is not asked at all.
    expect(await withOllamaFacts(listed, 'http://127.0.0.1:1234/v1')).toBe(listed)
  })
})

const TOOLS = new Set(['read_file', 'bash'])

describe('tool calls written as text', () => {
  it('reads the formats local models use', () => {
    expect(recoverInlineToolCalls('<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>', TOOLS))
      .toEqual({ text: '', calls: [{ name: 'read_file', arguments: '{"path":"a.ts"}' }] })
    expect(recoverInlineToolCalls('I will look.\n<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>\n<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>', TOOLS))
      .toEqual({ text: 'I will look.', calls: [{ name: 'read_file', arguments: '{"path":"a"}' }, { name: 'bash', arguments: '{"command":"ls"}' }] })
    // An unclosed tag at the end of the answer still counts.
    expect(recoverInlineToolCalls('<tool_call>{"name":"bash","arguments":{"command":"ls"}}', TOOLS)?.calls).toHaveLength(1)
    expect(recoverInlineToolCalls('<|python_tag|>{"name": "bash", "parameters": {"command": "pwd"}}<|eom_id|>', TOOLS))
      .toEqual({ text: '', calls: [{ name: 'bash', arguments: '{"command":"pwd"}' }] })
    expect(recoverInlineToolCalls('[TOOL_CALLS] [{"name": "bash", "arguments": {"command": "pwd"}}]', TOOLS)?.calls)
      .toEqual([{ name: 'bash', arguments: '{"command":"pwd"}' }])
    expect(recoverInlineToolCalls('```json\n{"name": "bash", "arguments": {"command": "pwd"}}\n```', TOOLS)?.calls).toHaveLength(1)
    expect(recoverInlineToolCalls('{"function": {"name": "bash", "arguments": "{\\"command\\": \\"pwd\\"}"}}', TOOLS)?.calls)
      .toEqual([{ name: 'bash', arguments: '{"command":"pwd"}' }])
    expect(recoverInlineToolCalls('{"name": "bash"}', TOOLS)?.calls).toEqual([{ name: 'bash', arguments: '{}' }])
  })

  it('leaves prose, examples and unknown tools alone', () => {
    expect(recoverInlineToolCalls('The answer is 4.', TOOLS)).toBeUndefined()
    expect(recoverInlineToolCalls('{"name": "delete_everything", "arguments": {}}', TOOLS)).toBeUndefined()
    expect(recoverInlineToolCalls('Here is the config:\n```json\n{"name": "bash", "arguments": {"command": "ls"}}\n```\nUse it like that.', TOOLS)).toBeUndefined()
    expect(recoverInlineToolCalls('{"name": "bash", "arguments": [1, 2]}', TOOLS)).toBeUndefined()
    expect(recoverInlineToolCalls('{"name": "bash", "arguments": "not json"}', TOOLS)).toBeUndefined()
    expect(recoverInlineToolCalls('[{"name": "bash", "arguments": {}}, {"note": "x"}]', TOOLS)).toBeUndefined()
    expect(recoverInlineToolCalls('<tool_call>not json</tool_call>', TOOLS)).toBeUndefined()
    expect(recoverInlineToolCalls('{"name": "bash", "arguments": {}}', new Set())).toBeUndefined()
    expect(recoverInlineToolCalls('[]', TOOLS)).toBeUndefined()
  })

  function message(over: Partial<AssistantMessage>): AssistantMessage {
    const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    return {
      role: 'assistant', content: [], api: 'openai-completions', provider: 'ollama', model: 'qwen3:8b',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost },
      stopReason: 'stop', timestamp: 0, ...over,
    }
  }

  async function chunks(text: string, inlineTools?: ReadonlySet<string>): Promise<StreamChunk[]> {
    const done = message({ content: [{ type: 'text', text }] })
    async function* feed(): AsyncGenerator<AssistantMessageEvent> {
      yield { type: 'text_start', contentIndex: 0, partial: done }
      yield { type: 'text_delta', contentIndex: 0, delta: text, partial: done }
      yield { type: 'text_end', contentIndex: 0, content: text, partial: done }
      yield { type: 'done', reason: 'stop', message: done }
    }
    const out: StreamChunk[] = []
    for await (const chunk of toStreamChunks(feed(), 32_768, undefined, 'qwen3:8b', inlineTools)) out.push(chunk)
    return out
  }

  it('turns them into real tool calls for a locally served model', async () => {
    const out = await chunks('Let me check.\n<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>', TOOLS)
    expect(out.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'text')).toMatchObject({ block: { text: 'Let me check.' } })
    const call = out.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    expect(call).toMatchObject({ index: 1, block: { type: 'tool-call', name: 'read_file', arguments: '{"path":"a.ts"}' } })
    const finish = out.at(-1)
    expect(finish).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(out.at(-2)?.type).toBe('usage')
  })

  it('keeps the text as it is for a hosted provider and for an ordinary answer', async () => {
    const hosted = await chunks('<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>')
    expect(hosted.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')).toBe(false)
    expect(hosted.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    const plain = await chunks('All tests pass.', TOOLS)
    expect(plain.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect((plain.at(-1) as { replayState?: unknown }).replayState).toBeDefined()
  })

  it('explains what to do when Ollama says a model cannot call tools', () => {
    const reason = mapStopReason(message({ stopReason: 'error', errorMessage: '400 registry.ollama.ai/library/gemma3:4b does not support tools' }))
    expect(reason).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect((reason as { failure: { message: string } }).failure.message).toContain('needs a model that can call tools')
  })
})

describe('tool calls written in Gemma syntax', () => {
  const OFFERED = new Set(['structured_output', 'read'])
  const Q = '<|"|>'

  it('turns a bare Gemma call with strings, numbers, booleans, lists and objects into a tool call', () => {
    const text = `structured_output{created:false,path:${Q}.hackdev/w1{x}${Q},count:2,tags:[${Q}a${Q},3],meta:{ok:true,none:null}}
-- signed`
    expect(recoverGemmaToolCalls(text, OFFERED)).toEqual({
      text: '-- signed',
      calls: [{ name: 'structured_output', arguments: JSON.stringify({ created: false, path: '.hackdev/w1{x}', count: 2, tags: ['a', 3], meta: { ok: true, none: null } }) }],
    })
  })

  it('accepts the call: prefix and the tool_call wrapper, and finds it through recoverInlineToolCalls', () => {
    const text = `Reading it.
<|tool_call>call:read{file_path:${Q}a.ts${Q}}<tool_call|>`
    expect(recoverInlineToolCalls(text, OFFERED)).toEqual({ text: 'Reading it.', calls: [{ name: 'read', arguments: '{"file_path":"a.ts"}' }] })
  })

  it('leaves tools that were not offered, JSON-keyed objects and broken syntax alone', () => {
    expect(recoverGemmaToolCalls(`bash{command:${Q}ls${Q}}`, OFFERED)).toBeUndefined()
    expect(recoverGemmaToolCalls('read{"file_path": "a.ts"}', OFFERED)).toBeUndefined()
    expect(recoverGemmaToolCalls(`read{file_path:${Q}a.ts}`, OFFERED)).toBeUndefined()
    expect(recoverGemmaToolCalls('function read{ return 1 }', OFFERED)).toBeUndefined()
  })
})
