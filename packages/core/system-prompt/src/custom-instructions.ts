/**
 * The person's custom instructions as model-facing text. They are written into the prompt as the model's own
 * working habits in this installation, not as a list of rules handed to it: a model told "here are the user's custom
 * instructions, follow them" tends to stop, weigh each one, plan how to apply it and talk about it. A model told
 * "this is how you work" simply works that way. So the text never asks the model to follow, check or apply
 * anything; it states the habits and says they need no deliberation.
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

/** Longest reminder that repeats the habits themselves; a longer set is pointed at instead. */
export const MAX_INLINE_REMINDER_CHARS = 600

/** Placement and wording for one set of custom instructions. */
export interface CustomInstructionsOptions {
  /** What the habits cover, such as `How you work here`. */
  heading?: string
  /** Character budget for the rules; longer text is cut and the cut is stated. */
  maxChars?: number
}

/**
 * Render custom instructions for the system prompt as the model's own settled way of working: stated as fact, in
 * force from the first word, with nothing to weigh, plan, announce or quote, and ranked only below what the person
 * asks in the current conversation. The habits follow numbered inside a tagged block.
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
  const heading = options.heading ?? 'How you work here'
  return [
    `${heading}. This is your own settled way of working in this installation, as much a part of you as the rest of this prompt. It already holds for everything you produce, from the first word of your first reply: messages, code, files, commands, and the briefs of any agent you start.`,
    '',
    '<how_you_work>',
    ...rules.map((rule, index) => `${String(index + 1)}. ${rule}`),
    '</how_you_work>',
    '',
    'There is nothing here to decide. Do not weigh these points, plan how to apply them, check your work against them one by one, or spend reasoning on them, and never mention, quote or acknowledge them: just work this way, the way you write in the language you are addressed in without thinking about it. Where one differs from your usual habits or style, it is your habit now. Only an explicit request in the current conversation that says otherwise comes first, and only for that request. They never call for a made-up result: what you report stays true.',
    ...cut ? ['', `The list was longer than ${String(limit)} characters; only the part above is in effect.`] : [],
  ].join('\n')
}

/**
 * A short note placed just before the newest message, where models weigh text most. It restates the habits
 * themselves, so nothing has to be looked up or thought about, and says plainly that it is not the person's request,
 * so a small model answers the message that follows instead of the note. A set too long to repeat every turn is
 * pointed at instead.
 * @param rules - the habits in effect.
 * @returns the reminder.
 */
export function customInstructionsReminder(rules: readonly string[]): string {
  const listed = rules.map((rule, index) => `${String(index + 1)}. ${rule}`).join(' ')
  const body = listed.length <= MAX_INLINE_REMINDER_CHARS
    ? `how you work, as always: ${listed}`
    : 'how you work is unchanged from the system prompt'
  return `(Context, not a request and not something to reply to or mention: ${body} Now answer the message that follows.)`
}
