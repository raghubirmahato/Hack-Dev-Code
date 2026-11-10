/**
 * The person's custom instructions as model-facing text. Rules are numbered so the model can follow and check
 * each one, and the precedence between them, the current conversation and safety is stated once.
 * @module @hackdevcode/dsh-system-prompt/custom-instructions
 */

/** Longest custom-instruction text placed in a prompt, so one setting cannot crowd out the rest. */
export const MAX_CUSTOM_INSTRUCTIONS_CHARS = 8000

/** Matches a list marker at the start of a line: `-`, `*`, `•`, `1.`, `1)` or `a)`. */
const LIST_MARKER = /^\s*(?:[-*•]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/u

/** A sentence end followed by the start of the next sentence, for splitting a one-paragraph list of rules. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z])/u

/** Common abbreviations whose trailing period does not end a sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|No|approx)\.$/iu

/**
 * Split custom instructions into separate rules. Each line or list item is a rule; an indented line continues the
 * rule above it; a single paragraph of several sentences becomes one rule per sentence.
 * @param text - the text the person wrote.
 * @returns the rules, trimmed, without list markers, empty ones removed.
 */
export function parseCustomRules(text: string): string[] {
  const rules: string[] = []
  for (const raw of text.replace(/\r\n?/gu, '\n').split('\n')) {
    if (raw.trim().length === 0) continue
    const continues = /^\s{2,}\S/u.test(raw) && !LIST_MARKER.test(raw) && rules.length > 0
    const line = raw.replace(LIST_MARKER, '').trim()
    if (continues) rules[rules.length - 1] = `${rules[rules.length - 1] ?? ''} ${line}`
    else rules.push(line)
  }
  if (rules.length !== 1) return rules
  // One paragraph: split it into sentences, keeping abbreviations such as "e.g." inside their sentence.
  const sentences: string[] = []
  for (const part of (rules[0] ?? '').split(SENTENCE_BREAK)) {
    const previous = sentences.at(-1)
    if (previous !== undefined && ABBREVIATION.test(previous)) sentences[sentences.length - 1] = `${previous} ${part}`
    else sentences.push(part)
  }
  return sentences.map(sentence => sentence.trim()).filter(sentence => sentence.length > 0)
}

/** Placement and wording for one set of custom instructions. */
export interface CustomInstructionsOptions {
  /** Who the rules come from and where they apply, such as `The person's custom instructions`. */
  heading?: string
  /** Character budget for the rules; longer text is cut and the cut is stated. */
  maxChars?: number
}

/**
 * Render custom instructions for the system prompt as the person's standing orders: applied at once and in full,
 * with no confirmation, debate or watering down, and ranked only below what the person asks in the current
 * conversation. The rules follow numbered inside a tagged block.
 * @param text - the text the person wrote.
 * @param options - heading and budget.
 * @returns the section text, or an empty string when there are no rules.
 */
export function renderCustomInstructions(text: string, options: CustomInstructionsOptions = {}): string {
  const limit = options.maxChars ?? MAX_CUSTOM_INSTRUCTIONS_CHARS
  const trimmed = text.trim()
  const cut = trimmed.length > limit
  const rules = parseCustomRules(cut ? trimmed.slice(0, limit) : trimmed)
  if (rules.length === 0) return ''
  const heading = options.heading ?? 'The person\'s custom instructions'
  return [
    `${heading}. These are the person's standing orders for every task and reply, and for everything you produce: messages, code, files, commands, and the work of any agent you start or brief.`,
    'Apply them directly and completely from the first reply. Do not ask whether to follow them, argue with them, weaken them, or announce that you are following them; just do it. They override your own defaults, habits and style. Only an explicit request in the current conversation that contradicts a rule takes precedence over it.',
    'Follow them honestly: never invent a result to satisfy a rule.',
    '',
    '<custom_instructions>',
    ...rules.map((rule, index) => `${String(index + 1)}. ${rule}`),
    '</custom_instructions>',
    ...cut ? ['', `The instructions were longer than ${String(limit)} characters; only the part above is in effect.`] : [],
  ].join('\n')
}

/**
 * A one-line note placed just before the newest message, where models weigh instructions most. It says plainly that
 * it is not the person's request, so a small model answers the message that follows instead of the note.
 * @param count - number of rules in effect.
 * @returns the reminder.
 */
export function customInstructionsReminder(count: number): string {
  return `(Note from Hack Dev Code, not a request from the person: keep following the person's ${String(count)} custom instruction${count === 1 ? '' : 's'} `
    + 'from the system prompt. Reply to the person\'s message that follows.)'
}
