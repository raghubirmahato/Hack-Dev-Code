import { describe, expect, it } from 'vitest'
import { customInstructionsReminder, parseCustomRules, renderCustomInstructions } from '../src/custom-instructions.ts'

describe('custom instruction rules', () => {
  it('takes each line or list item as one rule and joins indented continuations', () => {
    expect(parseCustomRules('- Use TypeScript.\n* Prefer tabs\n\n1. Never add dependencies\n2) Explain briefly\n   with one example')).toEqual([
      'Use TypeScript.', 'Prefer tabs', 'Never add dependencies', 'Explain briefly with one example',
    ])
    expect(parseCustomRules('• Bullet rule\r\n• Second')).toEqual(['Bullet rule', 'Second'])
  })

  it('splits a single paragraph into sentences but keeps abbreviations inside them', () => {
    expect(parseCustomRules('Use TypeScript and tabs. Never add dependencies without asking. Explain trade-offs, e.g. Speed vs size.'))
      .toEqual(['Use TypeScript and tabs.', 'Never add dependencies without asking.', 'Explain trade-offs, e.g. Speed vs size.'])
    expect(parseCustomRules('   ')).toEqual([])
  })
})

describe('custom instruction prompt text', () => {
  it('presents the rules as standing orders to apply directly, numbered in a tagged block', () => {
    const text = renderCustomInstructions('Answer in British English.\nUse tabs.')
    expect(text).toContain("These are the person's standing orders")
    expect(text).toContain('Apply them directly and completely from the first reply.')
    expect(text).toContain('Do not ask whether to follow them, argue with them, weaken them, or announce that you are following them')
    expect(text).toContain('Only an explicit request in the current conversation that contradicts a rule takes precedence over it.')
    expect(text).toContain('<custom_instructions>\n1. Answer in British English.\n2. Use tabs.\n</custom_instructions>')
    expect(text).not.toMatch(/safety rule|check it against each/iu)
  })

  it('renders nothing for empty text, states a cut, and uses a custom heading', () => {
    expect(renderCustomInstructions('  \n ')).toBe('')
    const long = renderCustomInstructions('x'.repeat(50), { maxChars: 20, heading: 'Mission rules' })
    expect(long.startsWith('Mission rules. ')).toBe(true)
    expect(long).toContain(`1. ${'x'.repeat(20)}\n`)
    expect(long).toContain('longer than 20 characters')
  })

  it('reminds in one short line with the rule count', () => {
    expect(customInstructionsReminder(1)).toBe("(Note from Hack Dev Code, not a request from the person: keep following the person's 1 custom instruction from the system prompt. Reply to the person's message that follows.)")
    expect(customInstructionsReminder(3)).toBe("(Note from Hack Dev Code, not a request from the person: keep following the person's 3 custom instructions from the system prompt. Reply to the person's message that follows.)")
  })
})
