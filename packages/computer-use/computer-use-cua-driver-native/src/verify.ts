/**
 * Verify-and-retry for whole-desktop actions: the outcome an action is expected to bring about, checked from fresh
 * state after the action, with a bounded number of repeats when it does not show.
 * @module @hackdevcode/dsh-computer-use-cua-driver-native/verify
 */

/** The `expect` argument of an action, as the model writes it. */
export interface Expectation {
  /** Text the window shows once the action has worked (with `gone`, text it no longer shows). */
  text?: string | undefined
  /** Part of the title of a window that opens once the action has worked (with `gone`, a window that closes). */
  window_title?: string | undefined
  /** The window's text differs from what it showed before the action. */
  changed?: boolean | undefined
  /** Invert `text` or `window_title`. */
  gone?: boolean | undefined
  /** Part of the title of the window whose text is checked; the window in front at each check when omitted. */
  in?: string | undefined
  /** How long the outcome may take to show, 500 to 60000 milliseconds. */
  timeout_ms?: number | undefined
  /** How many times the action is repeated when the outcome does not show. */
  retries?: number | undefined
}

/** One validated expectation. */
export type CheckedExpectation =
  | { readonly kind: 'text'; readonly text: string; readonly gone: boolean; readonly in?: string | undefined; readonly timeoutMs: number; readonly retries: number }
  | { readonly kind: 'window'; readonly title: string; readonly gone: boolean; readonly timeoutMs: number; readonly retries: number }
  | { readonly kind: 'changed'; readonly in?: string | undefined; readonly timeoutMs: number; readonly retries: number }

/** How long an expected outcome may take to show unless told otherwise. */
export const EXPECT_TIMEOUT_MS = 5000

/** Most repeats one action may make. */
export const MAX_RETRIES = 3

/**
 * Validate an `expect` argument before the action runs, so a malformed expectation never sends input.
 * @param raw - the argument, or undefined when the action expects nothing.
 * @param repeatable - true when the action is safe to repeat, else why it is not (`typing again would enter the text twice`).
 * @returns the expectation, or undefined when none was given.
 * @throws when the expectation names no outcome or several, or asks for repeats the action cannot make.
 */
export function checkedExpectation(raw: Expectation | undefined, repeatable: true | string): CheckedExpectation | undefined {
  if (raw === undefined) return undefined
  const text = raw.text?.trim() ?? ''
  const title = raw.window_title?.trim() ?? ''
  const kinds = [text.length > 0, title.length > 0, raw.changed === true].filter(Boolean).length
  if (kinds !== 1) throw new Error('expect needs exactly one of text, window_title or changed: true')
  const timeoutMs = Math.round(raw.timeout_ms ?? EXPECT_TIMEOUT_MS)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 60_000) throw new Error('expect.timeout_ms must be between 500 and 60000')
  const retries = raw.retries ?? 0
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) throw new Error(`expect.retries must be a whole number from 0 to ${String(MAX_RETRIES)}`)
  if (retries > 0 && repeatable !== true) throw new Error(`expect.retries is not available here: ${repeatable}; check the outcome and fix it instead`)
  const where = raw.in?.trim()
  const scope = where === undefined || where.length === 0 ? undefined : where
  const gone = raw.gone === true
  if (title.length > 0) {
    if (scope !== undefined) throw new Error('expect.in applies to text and changed, not to window_title')
    return { kind: 'window', title, gone, timeoutMs, retries }
  }
  if (text.length > 0) return { kind: 'text', text, gone, in: scope, timeoutMs, retries }
  if (gone) throw new Error('expect.gone applies to text and window_title, not to changed')
  return { kind: 'changed', in: scope, timeoutMs, retries }
}

/**
 * Poll a window's text until it differs from what it showed before an action, comparing with runs of white space
 * treated as one space so a reflow alone is no change.
 * @param read - reads the window's current text.
 * @param before - the text before the action.
 * @param timeoutMs - limit in milliseconds.
 * @param signal - cancels the wait.
 * @param intervalMs - polling interval.
 * @returns a description of the change.
 * @throws when the limit passes with the text unchanged.
 */
export async function waitForChange(
  read: () => Promise<string>, before: string, timeoutMs: number, signal?: AbortSignal, intervalMs = 400,
): Promise<string> {
  const squash = (value: string): string => value.replace(/\s+/gu, ' ').trim()
  const original = squash(before)
  const started = Date.now()
  for (;;) {
    signal?.throwIfAborted()
    const waited = Date.now() - started
    if (squash(await read()) !== original) return `The window text changed after ${String(waited)} ms.`
    if (waited >= timeoutMs) throw new Error(`the window text did not change within ${String(timeoutMs)} ms`)
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

/**
 * The expectation in a few words, for the result the model reads.
 * @param expectation - the validated expectation.
 * @returns a phrase such as `"Saved" shown` or `a window titled "Save As" open`.
 */
export function describeExpectation(expectation: CheckedExpectation): string {
  switch (expectation.kind) {
    case 'text':
      return `"${expectation.text}" ${expectation.gone ? 'no longer shown' : 'shown'}${expectation.in === undefined ? '' : ` in "${expectation.in}"`}`
    case 'window':
      return `a window titled "${expectation.title}" ${expectation.gone ? 'closed' : 'open'}`
    case 'changed':
      return `the text of ${expectation.in === undefined ? 'the window in front' : `"${expectation.in}"`} changed`
  }
}
