/**
 * pi-ai assistant event translation into the Harness streaming protocol.
 *
 * pi-ai tool-call arguments are parsed objects while the Harness keeps their
 * raw JSON representation. pi-ai also reports failures as terminal stream
 * events, which this module maps into Harness finish chunks.
 *
 * @module dsh-llm-pi-ai/stream
 */

import { brandString } from '@hackdevcode/dsh-brand'
import { CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, isContextWindowExceededError, isQuotaExceededError, LlmError, QUOTA_EXCEEDED_CODE } from '@hackdevcode/dsh-llm'
import type { FinishReason, StreamChunk, TokenUsage, ToolCallId } from '@hackdevcode/dsh-llm'
import { isContextOverflow } from '@earendil-works/pi-ai/utils/overflow'
import type { AssistantMessage, AssistantMessageEvent, Usage as PiUsage } from '@earendil-works/pi-ai'
import { toPiReplayState } from './replay.ts'

/**
 * Map pi-ai usage (reasoning folded into output by pi-ai).
 * @param usage - cumulative usage from the terminal pi-ai event.
 * @returns harness counts with pi-ai's exact total; cache fields appear only
 *   when non-zero (pi-ai reports zeros, not absence).
 */
export function mapUsage(usage: PiUsage): TokenUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
    ...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {},
  }
}

// XXX(pi-ai upstream): pi-ai flattens the caught error to `error.message`
// (api/anthropic-messages.js: `errorMessage = error instanceof Error ?
// error.message : JSON.stringify(error)`), discarding the original Error and its
// `cause` chain before it reaches us. undici carries the actionable transport
// detail on `cause` (e.g. `SocketError: other side closed`) but hands the fetch
// wrapper a bare `terminated`, so we are left pattern-matching terse words here.
// If pi-ai ever forwards the original Error (or a fetch/dispatcher hook that lets
// us capture the cause ourselves), classify on `code`/`cause` instead of text.
function classifyPiAiError(message: string): string {
  // Some providers answer a bad key with HTTP 400 and wording only (Gemini: "API key not valid").
  if (/\b(?:401|403)\b|api[ _]?key (?:not valid|is invalid)|invalid api[ _]?key|API_KEY_INVALID/i.test(message)) return 'AUTH'
  if (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE
  if (/\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  // A rejected request body (gateway or provider size cap): resending the
  // same request cannot succeed, so it is invalid, not transient.
  if (/\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i.test(message)) return 'INVALID_REQUEST'
  if (/\b400\b|invalid.?request/i.test(message)) return 'INVALID_REQUEST'
  if (/\b5\d\d\b/.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  // A stream truncated before the provider's terminal event: each pi-ai provider
  // throws its own wording when the wire closes mid-response without a terminal
  // event (`… stream ended before message_stop`, `… before a terminal response
  // event`, `… ended without a terminal event`, `Stream ended without
  // finish_reason`). The connection dropped mid-response, so this is a transport
  // truncation, not a model-level error.
  if (/stream ended (?:before|without)\b/i.test(message)) return 'TRANSPORT'
  if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message)
    || /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(message)
    // undici renders a mid-stream socket drop as a bare `terminated` (its
    // `cause` — the real SocketError — was flattened away upstream); Node's
    // stream layer says `Premature close`.
    || /\bterminated\b|premature close/i.test(message)) {
    return 'TRANSPORT'
  }
  return 'PI_AI_ERROR'
}

/**
 * Map a terminal pi-ai event to the harness finish reason.
 * @param message - the assistant message carried by the `done` or `error` event.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @returns the mapped harness reason. Recognized error text, `stop` usage above
 *   `contextWindow`, and zero-output `length` usage that fills the window map
 *   to `CONTEXT_WINDOW_EXCEEDED`; a `stop` with no content blocks maps to an
 *   `EMPTY_RESPONSE` error, while terminal `pending` and `deferred` states map
 *   to non-retryable `PI_AI_ERROR` failures.
 */
export function mapStopReason(message: AssistantMessage, contextWindow?: number): FinishReason {
  const piAiOverflow = isContextOverflow(message, contextWindow)
  const harnessOverflow = message.stopReason === 'error'
    && message.errorMessage !== undefined
    && isContextWindowExceededError(message.errorMessage)
  if (piAiOverflow || harnessOverflow) {
    return {
      kind: 'error',
      failure: {
        message: message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    }
  }

  switch (message.stopReason) {
    case 'stop':
      // A terminal stop that produced no content blocks is a degenerate
      // provider completion, not a successful (empty) assistant message.
      if (message.content.length === 0) {
        return {
          kind: 'error',
          failure: {
            message: `model "${message.model}" returned a completed response with no content`,
            code: EMPTY_RESPONSE_CODE,
          },
        }
      }
      return { kind: 'stop' }
    case 'length': return { kind: 'max-tokens' }
    case 'toolUse': return { kind: 'tool-calls' }
    case 'pending': return {
      kind: 'error',
      failure: { message: `pi-ai stream for model "${message.model}" ended pending`, code: 'PI_AI_ERROR' },
    }
    case 'deferred': return {
      kind: 'error',
      failure: { message: `pi-ai deferred response for model "${message.model}" is not supported`, code: 'PI_AI_ERROR' },
    }
    case 'aborted': return {
      kind: 'aborted',
      failure: { message: message.errorMessage ?? 'pi-ai stream aborted', code: 'ABORTED' },
    }
    case 'error': {
      const raw = message.errorMessage ?? 'pi-ai stream error'
      // Ollama's wording names the registry path, not what to do about it.
      const text = NO_TOOL_SUPPORT.test(raw)
        ? `${raw}. Hack Dev Code needs a model that can call tools: choose one whose Ollama page lists "tools" (for example qwen3, llama3.1, mistral-nemo or gpt-oss) in Settings, Models.`
        : raw
      return { kind: 'error', failure: { message: text, code: classifyPiAiError(raw) } }
    }
  }
}

/**
 * Remove reasoning that a model wrote into its answer as a leading `<think>...</think>` section, which R1-style and
 * Qwen3 models do when served through Ollama, LM Studio, vLLM or Together without a separate reasoning field. Left
 * in, it is shown as the answer and sent back on every later request.
 * @param text - the completed text block.
 * @returns the text after the reasoning section, or the text unchanged when it has none.
 */
export function withoutInlineThinking(text: string): string {
  const match = /^\s*<think>[\s\S]*?<\/think>\s*/u.exec(text)
  return match === null ? text : text.slice(match[0].length)
}

/** A tool call a model wrote into its answer as text. */
export interface InlineToolCall {
  name: string
  /** The arguments as JSON text. */
  arguments: string
}

/** One JSON value that may be a tool call: `{"name": ..., "arguments"|"parameters": {...}}`, or an OpenAI-style `{"function": {...}}`. */
function asInlineCall(value: unknown, tools: ReadonlySet<string>): InlineToolCall | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const inner = typeof record['function'] === 'object' && record['function'] !== null ? record['function'] as Record<string, unknown> : record
  const name = inner['name']
  if (typeof name !== 'string' || !tools.has(name)) return undefined
  let args: unknown = inner['arguments'] ?? inner['parameters'] ?? {}
  if (typeof args === 'string') {
    try { args = JSON.parse(args) as unknown } catch { return undefined }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { name, arguments: JSON.stringify(args) }
}

/** Every tool call in one JSON text: an object, or an array of them. All entries must be calls, or none counts. */
function parseInlineCalls(json: string, tools: ReadonlySet<string>): InlineToolCall[] | undefined {
  let value: unknown
  try { value = JSON.parse(json) } catch { return undefined }
  const entries = Array.isArray(value) ? value as unknown[] : [value]
  if (entries.length === 0) return undefined
  const calls = entries.map(entry => asInlineCall(entry, tools))
  return calls.every((call): call is InlineToolCall => call !== undefined) ? calls : undefined
}

/** Gemma's string delimiter in its own tool-call syntax. */
const GEMMA_QUOTE = '<|"|>'

/**
 * Read one value of Gemma's tool-call syntax: a `<|"|>`-delimited string, an object with bare keys, a list, or a bare
 * number, `true`, `false` or `null`.
 * @param src - the text.
 * @param start - where the value begins.
 * @returns the value and the index after it, or undefined when the text is not that syntax.
 */
function readGemmaValue(src: string, start: number): { value: unknown; end: number } | undefined {
  let i = start
  while (/\s/u.test(src[i] ?? '')) i += 1
  if (src.startsWith(GEMMA_QUOTE, i)) {
    const close = src.indexOf(GEMMA_QUOTE, i + GEMMA_QUOTE.length)
    return close < 0 ? undefined : { value: src.slice(i + GEMMA_QUOTE.length, close), end: close + GEMMA_QUOTE.length }
  }
  if (src[i] === '{' || src[i] === '[') {
    const isObject = src[i] === '{'
    const closer = isObject ? '}' : ']'
    const record: Record<string, unknown> = {}
    const list: unknown[] = []
    i += 1
    for (;;) {
      while (/[\s,]/u.test(src[i] ?? '')) i += 1
      if (src[i] === closer) return { value: isObject ? record : list, end: i + 1 }
      if (i >= src.length) return undefined
      if (isObject) {
        const key = /^([A-Za-z_][\w-]*)\s*:/u.exec(src.slice(i))
        if (key === null) return undefined
        const item = readGemmaValue(src, i + key[0].length)
        if (item === undefined) return undefined
        record[key[1] ?? ''] = item.value
        i = item.end
      } else {
        const item = readGemmaValue(src, i)
        if (item === undefined) return undefined
        list.push(item.value)
        i = item.end
      }
    }
  }
  const bare = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?=[\s,}\]]|$)/u.exec(src.slice(i))
  if (bare === null) return undefined
  return { value: JSON.parse(bare[1] ?? 'null') as unknown, end: i + (bare[1] ?? '').length }
}

/**
 * Tool calls written in Gemma's own syntax, `call:name{key:<|"|>text<|"|>,count:2}`, with or without the `call:`
 * prefix and the `<|tool_call>` … `<tool_call|>` wrapper, which Gemma models served through Ollama leave in their
 * answer when the server does not parse them.
 * @param text - the answer text.
 * @param tools - names of the offered tools.
 * @returns the text without the calls and the calls, or undefined when it holds none.
 */
export function recoverGemmaToolCalls(text: string, tools: ReadonlySet<string>): { text: string; calls: InlineToolCall[] } | undefined {
  const calls: InlineToolCall[] = []
  let rest = ''
  let from = 0
  const opener = /(?:<\|tool_call>\s*)?(?:call:)?([A-Za-z_][\w.-]*)\{/gu
  for (let match = opener.exec(text); match !== null; match = opener.exec(text)) {
    const name = match[1] ?? ''
    if (!tools.has(name)) continue
    const args = readGemmaValue(text, match.index + match[0].length - 1)
    if (args === undefined || typeof args.value !== 'object' || args.value === null || Array.isArray(args.value)) continue
    calls.push({ name, arguments: JSON.stringify(args.value) })
    const closing = /^\s*<tool_call\|>/u.exec(text.slice(args.end))
    rest += text.slice(from, match.index)
    from = args.end + (closing?.[0].length ?? 0)
    opener.lastIndex = from
  }
  return calls.length === 0 ? undefined : { text: (rest + text.slice(from)).trim(), calls }
}

/**
 * Find tool calls a model wrote into its answer instead of sending them as tool calls. Models served locally
 * (through Ollama, LM Studio, llama.cpp or vLLM) do this when their chat template is not applied: Qwen and Hermes
 * write `<tool_call>{...}</tool_call>`, Llama 3.1 writes `<|python_tag|>{...}`, Mistral writes `[TOOL_CALLS] [...]`,
 * Gemma writes `call:name{key:<|"|>text<|"|>}`,
 * and many write a lone JSON object, sometimes in a code fence. Left as text, the agent stops with a JSON blob for an
 * answer. A call counts only when it names a tool that was offered and its arguments are a JSON object, so prose
 * that merely shows JSON stays prose.
 * @param text - the completed answer text.
 * @param tools - names of the tools offered in the request.
 * @returns the text without the calls and the calls found, or undefined when the text holds none.
 */
export function recoverInlineToolCalls(text: string, tools: ReadonlySet<string>): { text: string; calls: InlineToolCall[] } | undefined {
  if (tools.size === 0 || !/[{[]/u.test(text)) return undefined
  const gemma = recoverGemmaToolCalls(text, tools)
  if (gemma !== undefined) return gemma
  const calls: InlineToolCall[] = []
  // Tagged calls: each tag holds one call or a list; everything outside the tags stays as text.
  let rest = text.replace(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gu, (whole, body: string) => {
    const found = parseInlineCalls(body, tools)
    if (found === undefined) return whole
    calls.push(...found)
    return ''
  })
  if (calls.length > 0) return { text: rest.trim(), calls }
  const marked = /^([\s\S]*?)(?:<\|python_tag\|>|\[TOOL_CALLS\])\s*([\s\S]+?)\s*(?:<\|eom_id\|>|<\|eot_id\|>|<\/s>)?\s*$/u.exec(text)
  if (marked !== null) {
    const found = parseInlineCalls(marked[2] ?? '', tools)
    if (found !== undefined) return { text: (marked[1] ?? '').trim(), calls: found }
  }
  // The whole answer is one JSON value, bare or in a code fence.
  rest = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/u.exec(rest)
  const body = fenced === null ? rest : (fenced[1] ?? '').trim()
  if (!/^[{[]/u.test(body)) return undefined
  const found = parseInlineCalls(body, tools)
  return found === undefined ? undefined : { text: '', calls: found }
}

/** Ollama's refusal when a model without tool support is sent tool definitions. */
const NO_TOOL_SUPPORT = /does not support tools/iu

/**
 * Translate the pi-ai event stream into StreamChunks. pi-ai never throws
 * mid-stream — failures arrive as `error` events, which become error/aborted
 * `finish` chunks (the harness protocol's other error-delivery style).
 * @param events - one assistant turn's pi-ai event stream.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @param callerSignal - caller cancellation state; an aborted caller makes any
 *   in-band terminal error an aborted finish.
 * @param requestedModel - request model identity recorded for durable replay.
 * @param inlineTools - names of the offered tools, for a locally served model: tool calls it wrote into its answer
 *   as text become real tool calls (see {@link recoverInlineToolCalls}). Omitted for hosted providers.
 * @returns the harness chunks, ending with `usage` then `finish`; throws
 *   `LlmError` (`STREAM_CLOSED`) if the source ends without a terminal event. A
 *   tool call whose completed arguments are invalid keeps the text the model sent,
 *   for the tool runtime to repair or answer. Length-limited output retains its
 *   terminal reason so the assembler can discard incomplete calls.
 */
export async function* toStreamChunks(
  events: AsyncIterable<AssistantMessageEvent>,
  contextWindow?: number,
  callerSignal?: AbortSignal,
  requestedModel?: string,
  inlineTools?: ReadonlySet<string>,
): AsyncGenerator<StreamChunk> {
  // pi-ai contentIndex ↔ our block index map 1:1 (both count blocks from 0
  // in stream order), but we track ids per index for tool calls.
  const toolIds = new Map<number, { id: string; name: string }>()
  // Argument text as streamed, kept for a call whose JSON pi-ai could not parse.
  const rawArguments = new Map<number, string>()
  // Tool calls recovered from answer text, emitted as blocks after the last block the model sent.
  const recovered: InlineToolCall[] = []
  let lastIndex = -1

  for await (const event of events) {
    if ('contentIndex' in event) lastIndex = Math.max(lastIndex, event.contentIndex)
    switch (event.type) {
      case 'start':
        break
      case 'text_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'text' }
        break
      case 'text_delta':
        yield { type: 'text-delta', index: event.contentIndex, text: event.delta }
        break
      case 'text_end': {
        const answer = withoutInlineThinking(event.content)
        const inline = inlineTools === undefined ? undefined : recoverInlineToolCalls(answer, inlineTools)
        if (inline !== undefined) recovered.push(...inline.calls)
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'text', text: inline === undefined ? answer : inline.text } }
        break
      }
      case 'thinking_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }
        break
      case 'thinking_delta':
        yield { type: 'reasoning-delta', index: event.contentIndex, text: event.delta }
        break
      case 'thinking_end':
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'reasoning', text: event.content } }
        break
      case 'toolcall_start': {
        // The id/name live on the partial's content at this index.
        const partial = event.partial.content[event.contentIndex]
        const id = partial?.type === 'toolCall' ? partial.id : ''
        const name = partial?.type === 'toolCall' ? partial.name : ''
        toolIds.set(event.contentIndex, { id, name })
        yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        rawArguments.set(event.contentIndex, (rawArguments.get(event.contentIndex) ?? '') + event.delta)
        const known = toolIds.get(event.contentIndex)
        yield {
          type: 'tool-call-delta',
          index: event.contentIndex,
          id: brandString<ToolCallId>(known?.id ?? ''),
          ...known?.name !== undefined && known.name.length > 0 ? { name: known.name } : {},
          argumentsDelta: event.delta,
        }
        break
      }
      case 'toolcall_end':
        if (event.toolCall.argumentsError !== undefined) {
          // The call keeps the text the model sent: the tool runtime repairs common damage or answers with an error
          // the model can act on, instead of the whole step failing over one malformed call.
          yield {
            type: 'block-end',
            index: event.contentIndex,
            block: {
              type: 'tool-call',
              id: brandString<ToolCallId>(event.toolCall.id),
              name: event.toolCall.name,
              // pi-ai appends the authoritative text it received, which can differ from the streamed deltas.
              arguments: /\n\nReceived arguments:\n([\s\S]*)$/u.exec(event.toolCall.argumentsError)?.[1] ?? rawArguments.get(event.contentIndex) ?? '',
            },
          }
          break
        }
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: {
            type: 'tool-call',
            id: brandString<ToolCallId>(event.toolCall.id),
            name: event.toolCall.name,
            // pi-ai hands back the PARSED arguments; the harness vocabulary
            // keeps the raw string.
            arguments: JSON.stringify(event.toolCall.arguments),
          },
        }
        break
      case 'done': {
        // Calls the model sent properly win; text that also looks like a call is then only text.
        const inline = event.message.stopReason === 'stop' && toolIds.size === 0 ? recovered : []
        for (const [offset, call] of inline.entries()) {
          const index = lastIndex + 1 + offset
          const id = brandString<ToolCallId>(`inline_${String(index)}_${Date.now().toString(36)}`)
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: call.arguments } }
        }
        yield { type: 'usage', usage: mapUsage(event.message.usage) }
        if (inline.length > 0) {
          // No replay state: the provider message holds the calls as text, which would not match the blocks above.
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield {
          type: 'finish',
          reason: mapStopReason(event.message, contextWindow),
          replayState: toPiReplayState(event.message, requestedModel),
        }
        return
      }
      case 'error':
        // In-stream error delivery (pi-ai's style) → error finish chunk
        // (the harness's other sanctioned error path besides throwing).
        yield { type: 'usage', usage: mapUsage(event.error.usage) }
        yield {
          type: 'finish',
          reason: mapStopReason(
            callerSignal?.aborted ? { ...event.error, stopReason: 'aborted' } : event.error,
            contextWindow,
          ),
        }
        return
      // no default: AssistantMessageEvent is pi-ai's closed union; a new
      // event type should fail compilation here via tsc's exhaustiveness
      // when one is added (switch covers all current variants).
    }
  }
  throw new LlmError('pi-ai event stream ended without done/error', 'STREAM_CLOSED')
}
