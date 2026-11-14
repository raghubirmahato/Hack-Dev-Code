/**
 * Split custom instructions into the numbered rules agents receive, for the live count and preview in Settings.
 * Mirrors `parseCustomRules` in the system-prompt package, which renders them on the Host; a spec keeps the two
 * in step.
 */

const LIST_MARKER = /^\s*(?:[-*•]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/u
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z])/u
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|No|approx)\.$/iu

/**
 * Show how the text being edited splits into rules, the same way agents receive them.
 * @param text - the text being edited.
 * @returns the rules in order.
 */
export function previewRules(text: string): string[] {
  const rules: string[] = []
  for (const raw of text.replace(/\r\n?/gu, '\n').split('\n')) {
    if (raw.trim().length === 0) continue
    const continues = /^\s{2,}\S/u.test(raw) && !LIST_MARKER.test(raw) && rules.length > 0
    const line = raw.replace(LIST_MARKER, '').trim()
    if (continues) rules[rules.length - 1] = `${rules[rules.length - 1] ?? ''} ${line}`
    else rules.push(line)
  }
  if (rules.length !== 1) return rules
  const sentences: string[] = []
  for (const part of (rules[0] ?? '').split(SENTENCE_BREAK)) {
    const previous = sentences.at(-1)
    if (previous !== undefined && ABBREVIATION.test(previous)) sentences[sentences.length - 1] = `${previous} ${part}`
    else sentences.push(part)
  }
  return sentences.map(sentence => sentence.trim()).filter(sentence => sentence.length > 0)
}
