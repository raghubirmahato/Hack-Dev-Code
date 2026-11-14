/**
 * Child-scoped structured-output tool, prompt instruction, terminal guard, and authoritative
 * result capture for in-process subagents. Each child registers its real schema on its own
 * scope, so concurrent runs do not interact and disposal leaves no global residue. The prompt
 * contribution is ordinary reconstructed request state.
 *
 * Capture commits only after the authoritative `tools/result` succeeds; PTC mode capture also
 * waits for the enclosing `run_code` result. The terminal result marker and monotonic tool
 * guard prevent later calls from reopening a completed structured run.
 * @module @hackdevcode/dsh-subagent/structured
 */

import type { Context } from '@hackdevcode/cordis'
import type { ContextFormed, ToolSchema } from '@hackdevcode/dsh-llm'
import { createUserMessage } from '@hackdevcode/dsh-llm'
import type { Agent } from '@hackdevcode/dsh-agent'
import type { ToolExecution, ToolRunContext } from '@hackdevcode/dsh-tools'
import { ToolArgsError, validateJsonSchemaValue, type JsonSchemaNode, type ObjectJsonSchema } from '@hackdevcode/dsh-tools'

/** The model-facing tool name a structured child must call to finish. */
export const STRUCTURED_OUTPUT_TOOL = 'structured_output'

/**
 * The instruction registered as the child's trailing scoped prompt section:
 * the demand travels with the
 * tool, as ordinary prompt state of exactly one agent.
 */
export const STRUCTURED_OUTPUT_INSTRUCTION
  = 'When you have your final answer, you MUST report it by calling the '
    + `\`${STRUCTURED_OUTPUT_TOOL}\` tool with arguments matching its parameter schema exactly. `
    + 'Do not finish with a plain text answer: only the tool call counts as your result.'

/** One structured run's live handle: read the captured value once the child settles. */
export interface StructuredAttachment {
  /**
   * Input stays closed from capture staging through its final result, including
   * an enclosing PTC execution. A failed result discards its capture and reopens input.
   * @returns whether the activation can accept another message.
   */
  acceptsInput(): boolean
  /**
   * The captured value, once the child called the tool with valid arguments
   * and the authoritative final tool result accepted that call.
   * @returns the committed value, or undefined while none was accepted.
   */
  captured(): { value: unknown } | undefined
  /**
   * The result a child wrote as its final text instead of calling the tool, which small models often do: the last
   * JSON object in the text, fenced or bare, that matches the schema.
   * @param text - the child's final answer text.
   * @returns the matching value, or undefined when the text holds none.
   */
  recover(text: string): { value: unknown } | undefined
}

/** Message source of the reminder a child gets when it ends its turn without reporting its result. */
const STRUCTURED_REMINDER_SOURCE = 'structured-reminder'

declare module '@hackdevcode/dsh-llm' {
  interface MessageSourceMap {
    'structured-reminder': { kind: 'structured-reminder' } & ContextFormed
  }
}

/**
 * The text of the child's newest assistant message, where a result written as text would be.
 * @param agent - the child agent.
 * @returns its text blocks joined, or an empty string.
 */
function lastAnswerText(agent: Agent): string {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    return event.data.message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
  }
  return ''
}

/** Times a child that ends its turn without a result is asked to report it before the run counts as failed. */
export const MAX_STRUCTURED_REMINDERS = 2

/**
 * The message a child gets when it ends its turn without reporting its result.
 * @param violations - what was wrong with its last `structured_output` call, if it made one.
 * @returns the reminder text.
 */
export function structuredReminder(violations: readonly string[]): string {
  const problem = violations.length === 0
    ? 'You ended your turn without reporting your result, so it was not received.'
    : `Your last \`${STRUCTURED_OUTPUT_TOOL}\` call was rejected: ${violations.slice(0, 6).join('; ')}.`
  return `${problem} Call the \`${STRUCTURED_OUTPUT_TOOL}\` tool now with arguments matching its parameter schema, `
    + 'filling every required field; use an empty list or false where you have nothing to report. Do not redo your work.'
}

/**
 * Fill each required field a model left out when its type says what "nothing" is: an empty list for an array, false
 * for a boolean. Weaker models often omit such fields, and the result would otherwise be rejected for no loss of
 * information. Strings, numbers and objects are never invented.
 * @param schema - the schema node the value should match.
 * @param value - the model's value, not changed in place.
 * @returns the value with those fields added, at every depth.
 */
export function fillEmptyRequired(schema: JsonSchemaNode, value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = schema.items
    return items === undefined ? value : value.map(item => fillEmptyRequired(items, item))
  }
  if (value === null || typeof value !== 'object' || schema.properties === undefined) return value
  const properties = schema.properties
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const [key, child] of Object.entries(properties)) {
    if (key in out) out[key] = fillEmptyRequired(child, out[key])
    else if (schema.required?.includes(key) === true) {
      if (child.type === 'array') out[key] = []
      else if (child.type === 'boolean') out[key] = false
    }
  }
  return out
}

/** Fenced code blocks, with or without a language tag. */
const FENCED = /```[a-z]*\s*\n([\s\S]*?)```/giu

/**
 * The JSON texts a final answer may hold, most likely first: fenced blocks from the last one back, then the span
 * from the first `{` to the last `}`.
 * @param text - the final answer text.
 * @returns candidate JSON texts.
 */
export function jsonCandidates(text: string): string[] {
  const fenced = [...text.matchAll(FENCED)].map(match => match[1] ?? '').reverse()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? [...fenced, text.slice(start, end + 1)] : fenced
}

/**
 * Attach the scoped capture tool, instruction, and enforcement to a child during
 * its creation window. Child disposal removes every registration.
 * @param childCtx - the child agent's scope context (`setup`'s argument).
 * @param schema - the trusted, already-asserted schema subset to enforce (see
 *   `assertObjectJsonSchema` in dsh-tools).
 * @param canComplete - whether accepted input and owned child work have finished.
 * @returns the attachment handle (read `captured()` after the child settles).
 */
export function attachStructuredRuntime(
  childCtx: Context,
  schema: ObjectJsonSchema,
  canComplete: () => boolean,
): StructuredAttachment {
  /**
   * Validated values staged by the capture tool body, awaiting THEIR OWN
   * authoritative `tools/result` notification. The execution object's identity
   * uniquely identifies a trip through the pipeline: adapter call ids may
   * repeat across steps, but another execution can never reach this Map
   * entry. This is distinct from the opaque `ToolExecutionToken` used to
   * correlate nested transports. The final notification always deletes its own
   * stage, whether the result succeeded or failed.
   */
  const staged = new Map<ToolExecution, { value: unknown }>()
  /** Successful nested capture waiting for its enclosing transport to commit. */
  let pending: { parent: ToolExecution['token']; value: unknown } | undefined
  let captured: { value: unknown } | undefined
  /** What was wrong with the last rejected call, quoted in the reminder. */
  let lastViolations: readonly string[] = []
  /** Reminders sent in the current turn. */
  let reminders = { turn: -1, count: 0 }

  const schemaEntry: ToolSchema = {
    name: STRUCTURED_OUTPUT_TOOL,
    description:
      'Report your final structured result. Call this exactly once, when your answer is complete; '
      + 'the arguments must match this tool\'s parameter schema exactly.',
    parameters: { ...schema },
  }

  childCtx.tools.register({
    ...schemaEntry,
    output: {
      schema: {
        type: 'object',
        properties: { recorded: { type: 'boolean', const: true } },
        required: ['recorded'],
        additionalProperties: false,
      },
      render: () => [{ type: 'text', text: 'Structured output recorded.' }],
    },
    execute(raw: unknown, exec: ToolRunContext): Promise<{ recorded: true }> {
      const args = fillEmptyRequired(schema, raw)
      const violations = validateJsonSchemaValue(schema, args)
      // ToolArgsError → isError result with INVALID_ARGS: the model retries
      // within the same turn, exactly like a schema-validated defineTool call.
      if (violations.length > 0) {
        lastViolations = violations
        throw new ToolArgsError(violations)
      }
      if (!canComplete()) throw new Error('Wait for all delegated child tasks to finish and process pending messages before submitting structured output.')
      // Two-phase commit, keyed by THIS execution: later transformable
      // waterfalls may still turn the success into an error. ToolRuntime has
      // already frozen model-bound arguments at the actual input boundary.
      staged.set(exec, { value: args })
      exec.concludeTurn()
      return Promise.resolve({ recorded: true })
    },
  })

  // A child about to end its turn without a result is asked for it, at most MAX_STRUCTURED_REMINDERS times in a turn;
  // a final answer whose text already holds a matching result needs no reminder. Weaker models often finish with
  // prose or with a rejected call they never retried, and the whole run was lost with that one turn.
  childCtx.on('agent/turn-stopping', ({ agent, turn }) => {
    if (captured !== undefined || pending !== undefined || staged.size > 0 || !canComplete()) return
    if (reminders.turn !== turn) reminders = { turn, count: 0 }
    if (reminders.count >= MAX_STRUCTURED_REMINDERS) return
    if (recoverFrom(lastAnswerText(agent)) !== undefined) return
    reminders.count += 1
    const text = structuredReminder(lastViolations)
    lastViolations = []
    agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: STRUCTURED_REMINDER_SOURCE } }))
  })

  childCtx.systemPrompt.section({
    name: `tool:${STRUCTURED_OUTPUT_TOOL}`,
    order: childCtx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    text: STRUCTURED_OUTPUT_INSTRUCTION,
  })

  // Terminal WITHIN the step. Guards run after the whole pre-execute
  // waterfall and compose monotonically (deny or abstain, never allow), so a
  // later prepended listener cannot resurrect dispatch. Calls that precede
  // capture in the same response remain untouched.
  childCtx.tools.guard(exec => captured === undefined && pending === undefined
    ? undefined
    : `structured output already recorded: the run is complete, so \`${exec.name}\` is not executed`)

  // The capture COMMIT observes the immutable, authoritative result after the
  // complete pipeline and outer error normalization. This notification cannot
  // transform the outcome, so there is no wrapper outside the commit verdict.
  childCtx.on('tools/result', function (this: unknown, exec, result) {
    if (exec.name === STRUCTURED_OUTPUT_TOOL) {
      const entry = staged.get(exec)
      if (entry === undefined) return
      staged.delete(exec)
      if (result.isError) return
      if (exec.parent === undefined) {
        /* v8 ignore else -- sequential agent-loop dispatch lets the guard block every later supported call */
        if (captured === undefined) captured = { value: entry.value }
      } else {
        /* v8 ignore else -- PTC mode serializes sub-dispatches, so the guard blocks every later supported call */
        if (captured === undefined && pending === undefined) {
          pending = { parent: exec.parent, value: entry.value }
        }
      }
      return
    }
    if (pending?.parent !== exec.token) return
    const entry = pending
    pending = undefined
    if (result.isError) return
    /* v8 ignore else -- PTC mode serializes outer executions, so the guard blocks every later supported call */
    if (captured === undefined) captured = { value: entry.value }
  })

  return {
    captured: () => captured,
    acceptsInput: () => staged.size === 0 && pending === undefined && captured === undefined,
    recover: recoverFrom,
  }

  function recoverFrom(text: string): { value: unknown } | undefined {
    for (const candidate of jsonCandidates(text)) {
      let value: unknown
      try {
        value = fillEmptyRequired(schema, JSON.parse(candidate.trim()))
      } catch {
        continue
      }
      if (validateJsonSchemaValue(schema, value).length === 0) return { value }
    }
    return undefined
  }
}
