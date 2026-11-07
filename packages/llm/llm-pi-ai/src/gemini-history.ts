/**
 * Gemini history from another model. Gemini rejects a function call in the current turn that carries no thought
 * signature, and signatures are bound to the model that produced them, so pi-ai drops them for history from any
 * other model. That happens after a fallback model takes over mid-turn, or when a session moves to Gemini from
 * another provider. Google documents a placeholder signature for exactly this case.
 * @module @hackdevcode/dsh-llm-pi-ai/gemini-history
 */

import type { Api, AssistantMessage, Context as PiContext, Model } from '@earendil-works/pi-ai'

/**
 * Google's placeholder that skips signature validation for a function call whose real signature is unavailable,
 * in standard base64 (`skip_thought_signature_validator` with the URL-safe alphabet), which is the form pi-ai
 * forwards.
 */
export const SKIP_THOUGHT_SIGNATURE = 'skip/thought/signature/validator'

/**
 * Whether requests to this model go to a Gemini API that validates thought signatures.
 * @param model - the target model.
 * @returns true for the Google APIs.
 */
export function usesGeminiSignatures(model: Pick<Model<Api>, 'api'>): boolean {
  return String(model.api).startsWith('google')
}

/**
 * A tool-call id in the form Gemini accepts, as pi-ai normalizes ids for its own messages: letters, digits, `_` and
 * `-`, at most 64 characters.
 * @param id - original id, such as `call_1|fc_2` from another provider.
 * @returns the normalized id.
 */
export function geminiToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 64)
}

/**
 * Rewrite assistant messages from another provider or model so the target Gemini model accepts them, the way pi-ai
 * treats such history: their thinking and signatures are dropped (another model's reasoning must not read as part
 * of the visible reply), their tool-call ids are normalized together with the matching tool results, and every
 * function call gets {@link SKIP_THOUGHT_SIGNATURE}. The target model's own messages keep their signatures; only a
 * function call that has none gets the placeholder.
 * @param context - the pi-ai request context.
 * @param model - the model the request goes to.
 * @returns the same context when nothing needed rewriting, otherwise a rewritten copy.
 */
export function adoptForeignGeminiHistory(context: PiContext, model: Pick<Model<Api>, 'api' | 'provider' | 'id'>): PiContext {
  if (!usesGeminiSignatures(model)) return context
  const renamed = new Map<string, string>()
  const adopted = context.messages.map((message) => {
    if (message.role !== 'assistant') return message
    // History rebuilt without replay data is labelled `dsh-foreign` even when it names this model.
    const own = message.provider === model.provider && message.model === model.id && String(message.api) !== 'dsh-foreign'
    if (own) {
      if (!message.content.some(block => block.type === 'toolCall' && (block.thoughtSignature ?? '') === '')) return message
      return {
        ...message,
        content: message.content.map(block => block.type === 'toolCall' && (block.thoughtSignature ?? '') === ''
          ? { ...block, thoughtSignature: SKIP_THOUGHT_SIGNATURE }
          : block),
      }
    }
    const content: AssistantMessage['content'] = []
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text })
      else if (block.type === 'toolCall') {
        const id = geminiToolCallId(block.id)
        if (id !== block.id) renamed.set(block.id, id)
        content.push({ ...block, id, thoughtSignature: SKIP_THOUGHT_SIGNATURE })
      }
    }
    return { ...message, api: model.api, provider: model.provider, model: model.id, content }
  })
  const messages = renamed.size === 0 ? adopted : adopted.map((message) => {
    const id = message.role === 'toolResult' ? renamed.get(message.toolCallId) : undefined
    return id === undefined || message.role !== 'toolResult' ? message : { ...message, toolCallId: id }
  })
  return messages.some((message, index) => message !== context.messages[index]) ? { ...context, messages } : context
}
