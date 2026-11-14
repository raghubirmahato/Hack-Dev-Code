import { describe, expect, it } from 'vitest'
import { MAX_CUSTOM_INSTRUCTIONS_CHARS, customInstructionsReminder, parseCustomRules, renderCustomInstructions } from '../src/custom-instructions.ts'

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
  it('states the rules as the model\'s own way of working, numbered in a tagged block', () => {
    const text = renderCustomInstructions('Answer in British English.\nUse tabs.')
    expect(text.startsWith('How you work here. This is your own settled way of working in this installation')).toBe(true)
    expect(text).toContain('It already holds for everything you produce, from the first word of your first reply')
    expect(text).toContain('<how_you_work>\n1. Answer in British English.\n2. Use tabs.\n</how_you_work>')
    expect(text).toContain('There is nothing here to decide.')
    expect(text).toContain('never mention, quote or acknowledge them')
    expect(text).toContain('Only an explicit request in the current conversation that says otherwise comes first')
    expect(text).toContain('what you report stays true')
  })

  it('never frames them as instructions handed over to be followed', () => {
    const text = renderCustomInstructions('Answer in British English.')
    // Wording that makes a model stop and deliberate: who the rules come from, and being told to obey them.
    expect(text).not.toMatch(/custom instruction|standing order|the person's|the user's|you must|follow (?:them|these)|comply/iu)
  })

  it('renders nothing for empty text, states a cut, and uses a custom heading', () => {
    expect(renderCustomInstructions('  \n ')).toBe('')
    const long = renderCustomInstructions('x'.repeat(50), { maxChars: 20, heading: 'Mission rules' })
    expect(long.startsWith('Mission rules. ')).toBe(true)
    expect(long).toContain(`1. ${'x'.repeat(20)}\n`)
    expect(long).toContain('longer than 20 characters')
  })

  it('reminds by restating a short list, and by pointing at a long one', () => {
    expect(customInstructionsReminder(['Answer in British English.', 'Use tabs.']))
      .toBe('(Context, not a request and not something to reply to or mention: how you work, as always: 1. Answer in British English. 2. Use tabs. Now answer the message that follows.)')
    const long = customInstructionsReminder(Array.from({ length: 40 }, (_, index) => `Rule number ${String(index)} about something.`))
    expect(long).toBe('(Context, not a request and not something to reply to or mention: how you work is unchanged from the <how_you_work> list in the system prompt, every point of it. Now answer the message that follows.)')
    expect(long).not.toMatch(/custom instruction/iu)
  })

  it('tells a running task to carry on rather than answer', () => {
    expect(customInstructionsReminder(['Speak as Captain Nova.'], 'task'))
      .toBe('(Context, not a request and not something to reply to or mention: how you work, as always: 1. Speak as Captain Nova. Carry on with the task where you are.)')
  })

  it('keeps a described character for the whole conversation and every agent', () => {
    const text = renderCustomInstructions('You are Captain Nova, a cheerful pirate.')
    expect(text).toContain('It holds for the whole conversation, every turn and every step of every task')
    expect(text).toContain('never drop it, step out of it, or remark on it')
    expect(MAX_CUSTOM_INSTRUCTIONS_CHARS).toBe(400_000)
  })
})
