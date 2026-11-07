import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Context } from '@earendil-works/pi-ai'
import { SKIP_THOUGHT_SIGNATURE, adoptForeignGeminiHistory, geminiToolCallId, usesGeminiSignatures } from '../src/gemini-history.ts'

const flash = { api: 'google-generative-ai', provider: 'google', id: 'gemini-3.5-flash' } as const
const lite = { api: 'google-generative-ai', provider: 'google', id: 'gemini-3.5-flash-lite' } as const

function assistant(model: string, content: AssistantMessage['content'], extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant', content, api: 'google-generative-ai', provider: 'google', model,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse', timestamp: 0, ...extra,
  }
}

function context(...messages: AssistantMessage[]): Context {
  return { messages: [{ role: 'user', content: 'go', timestamp: 0 }, ...messages] }
}

describe('Gemini history from another model', () => {
  it('signs function calls and drops thinking from the model that answered before a fallback', () => {
    const before = context(assistant('gemini-3.5-flash', [
      { type: 'thinking', thinking: 'plan the steps', thinkingSignature: 'AAAA' },
      { type: 'text', text: 'Opening it.', textSignature: 'BBBB' },
      { type: 'toolCall', id: 'c1', name: 'load_tools', arguments: { group: 'desktop' }, thoughtSignature: 'CCCC' },
    ]))
    const after = adoptForeignGeminiHistory(before, lite)
    expect(after.messages[1]).toMatchObject({ provider: 'google', model: 'gemini-3.5-flash-lite', api: 'google-generative-ai' })
    expect((after.messages[1] as AssistantMessage).content).toEqual([
      { type: 'text', text: 'Opening it.' },
      { type: 'toolCall', id: 'c1', name: 'load_tools', arguments: { group: 'desktop' }, thoughtSignature: SKIP_THOUGHT_SIGNATURE },
    ])
    expect(before.messages[1]).toMatchObject({ model: 'gemini-3.5-flash' })
  })

  it('keeps the target model\'s own signatures and signs only unsigned calls', () => {
    const own = context(assistant('gemini-3.5-flash', [
      { type: 'toolCall', id: 'c1', name: 'a', arguments: {}, thoughtSignature: 'REAL' },
      { type: 'toolCall', id: 'c2', name: 'b', arguments: {} },
    ]))
    const after = adoptForeignGeminiHistory(own, flash)
    expect((after.messages[1] as AssistantMessage).content.map(block => block.type === 'toolCall' ? block.thoughtSignature : undefined))
      .toEqual(['REAL', SKIP_THOUGHT_SIGNATURE])
    const signed = context(assistant('gemini-3.5-flash', [{ type: 'toolCall', id: 'c1', name: 'a', arguments: {}, thoughtSignature: 'REAL' }]))
    expect(adoptForeignGeminiHistory(signed, flash)).toBe(signed)
  })

  it('treats history rebuilt without replay data as foreign even when it names the same model', () => {
    const foreign = { api: 'dsh-foreign' as AssistantMessage['api'] }
    const rebuilt = context(assistant('gemini-3.5-flash', [{ type: 'toolCall', id: 'c1', name: 'a', arguments: {} }], foreign))
    const after = adoptForeignGeminiHistory(rebuilt, flash).messages[1] as AssistantMessage
    expect(after.api).toBe('google-generative-ai')
    expect(after.content[0]).toMatchObject({ thoughtSignature: SKIP_THOUGHT_SIGNATURE })
  })

  it('signs calls from another provider and leaves non-Gemini targets alone', () => {
    const deepseek = context(assistant('deepseek-v4', [{ type: 'toolCall', id: 'c1', name: 'a', arguments: {} }], { provider: 'deepseek', api: 'openai-completions' }))
    const adopted = adoptForeignGeminiHistory(deepseek, flash).messages[1] as AssistantMessage
    expect(adopted.content[0]).toMatchObject({ thoughtSignature: SKIP_THOUGHT_SIGNATURE })
    expect(adoptForeignGeminiHistory(deepseek, { api: 'openai-completions', provider: 'deepseek', id: 'deepseek-v4' })).toBe(deepseek)
    expect(usesGeminiSignatures({ api: 'google-vertex' })).toBe(true)
    expect(usesGeminiSignatures({ api: 'anthropic-messages' })).toBe(false)
  })

  it('uses a placeholder that pi-ai forwards as valid base64', () => {
    expect(SKIP_THOUGHT_SIGNATURE.length % 4).toBe(0)
    expect(/^[A-Za-z0-9+/]+={0,2}$/u.test(SKIP_THOUGHT_SIGNATURE)).toBe(true)
    expect(Buffer.from(SKIP_THOUGHT_SIGNATURE, 'base64').equals(Buffer.from('skip_thought_signature_validator', 'base64url'))).toBe(true)
  })
})

describe('tool-call ids from another provider', () => {
  it('normalizes ids on the calls and on their results together', () => {
    const openai = assistant('gpt-5', [{ type: 'toolCall', id: 'call_1|fc_2', name: 'a', arguments: {} }], { provider: 'openai', api: 'openai-responses' })
    const result = { role: 'toolResult' as const, toolCallId: 'call_1|fc_2', toolName: 'a', content: [{ type: 'text' as const, text: 'ok' }], isError: false, timestamp: 0 }
    const before: Context = { messages: [{ role: 'user', content: 'go', timestamp: 0 }, openai, result] }
    const after = adoptForeignGeminiHistory(before, flash)
    expect((after.messages[1] as AssistantMessage).content[0]).toMatchObject({ id: 'call_1_fc_2', thoughtSignature: SKIP_THOUGHT_SIGNATURE })
    expect(after.messages[2]).toMatchObject({ role: 'toolResult', toolCallId: 'call_1_fc_2' })
    expect(geminiToolCallId('x'.repeat(80))).toHaveLength(64)
  })
})
