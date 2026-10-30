/** Real business matchers compose by original position through the data-layer scheduler. */
import { Context } from '@hackdevcode/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { UserTextFacts, UserTextRule, UserTextNode, UserTextTransformContext } from '@hackdevcode/dsh-client-ui-conversation/client'
import { UserTextRegistry } from '../src/client/conversation/user-text-registry.ts'
import { sessionReferenceRule } from '../src/client/user-text/session-reference-rule.ts'
import { fileReferenceRule, folderReferenceRule } from '../../ui-reference/src/client/user-text-rules.ts'
import { skillReferenceRule } from '../../ui-skill/src/client/user-text-rules.ts'
import { goalCommandReferenceRule } from '../../ui-goal/src/client/user-text-rules.ts'

const RULES = [sessionReferenceRule, fileReferenceRule, folderReferenceRule, skillReferenceRule, goalCommandReferenceRule]

function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const registry = new UserTextRegistry(ctx)
  const matches = RULES.map((rule) => {
    const match = vi.fn((text: string, from: number, context: UserTextTransformContext) => rule.match(text, from, context))
    registry.register({ ...rule, match } satisfies UserTextRule)
    return { id: rule.id, match }
  })
  return { registry, evaluate: registry.createEvaluator(), matches }
}

function references(text: string, nodes: readonly UserTextNode[]) {
  return nodes.filter(node => node.id !== 'text').map(node => [node.id, text.slice(node.start, node.end), node.data])
}

describe('original-text reference competition', () => {
  it('keeps an earlier complete file instead of a Session label inside its path', () => {
    const { evaluate } = setup()
    const text = '\u304d\u304b @types \u3089\u3075 @src/@types/react/index.d.ts'
    expect(references(text, evaluate({ text, facts: { sessionLabels: ['types'] } }))).toEqual([
      ['session', '@types', { label: 'types' }],
      ['file', '@src/@types/react/index.d.ts', { path: 'src/@types/react/index.d.ts', label: 'index.d.ts' }],
    ])
  })

  it('keeps an earlier complete file instead of a wire Session inside its path', () => {
    const { evaluate } = setup()
    const text = '@src/@[\u3055\u3064\u304a](dsh-session:x)'
    expect(references(text, evaluate({ text, facts: {} }))).toEqual([
      ['file', text, { path: 'src/@[\u3055\u3064\u304a](dsh-session:x)', label: '@[\u3055\u3064\u304a](dsh-session:x)' }],
    ])
  })

  it('keeps the quoted file and only recognizes the outside skill', () => {
    const { evaluate } = setup()
    const text = '/review @"docs /review notes.md"'
    expect(references(text, evaluate({ text, facts: { skillNames: ['review'] } }))).toEqual([
      ['skill', '/review', { name: 'review' }],
      ['file', '@"docs /review notes.md"', { path: 'docs /review notes.md', label: 'review notes.md' }],
    ])
  })

  it.each([
    ['@\u3055\u3064\u304a@src/a.ts', '@src/a.ts'], ['@\u3055\u3064\u304a/plan', '/plan'],
  ])('does not turn the suffix into an original word boundary in %s', (text, tail) => {
    const { evaluate } = setup()
    expect(evaluate({ text, facts: { sessionLabels: ['\u3055\u3064\u304a'], skillNames: ['plan'] } })).toEqual([
      { id: 'session', start: 0, end: 4, data: { label: '\u3055\u3064\u304a' } },
      { id: 'text', start: 4, end: text.length, data: { text: tail } },
    ])
  })

  it('preserves real whitespace boundaries and stable same-start Session precedence', () => {
    const { evaluate } = setup()
    const facts = { sessionLabels: ['\u3055\u3064\u304a', 'types'], skillNames: ['plan'] }
    const text = '@\u3055\u3064\u304a @src/a.ts /plan'
    expect(references(text, evaluate({ text, facts }))).toEqual([
      ['session', '@\u3055\u3064\u304a', { label: '\u3055\u3064\u304a' }], ['file', '@src/a.ts', { path: 'src/a.ts', label: 'a.ts' }],
      ['skill', '/plan', { name: 'plan' }],
    ])
    expect(evaluate({ text: '@types/react/index.d.ts', facts })).toEqual([
      { id: 'session', start: 0, end: 6, data: { label: 'types' } },
      { id: 'text', start: 6, end: 23, data: { text: '/react/index.d.ts' } },
    ])
  })

  it('queries only Skill after its Facts update, reusing file, folder, Session and command searches', () => {
    const { evaluate, matches, registry } = setup()
    const text = '/review @"docs /review notes.md"'
    const before = evaluate({ text, facts: {} })
    for (const { match } of matches) match.mockClear()
    const facts = { skillNames: ['review'] }
    const after = evaluate({ text, facts })
    for (const { id, match } of matches) {
      expect(match.mock.calls.map(([, from]) => from)).toEqual(id === 'skill' ? [0, 7, text.length] : [])
    }
    expect(after.find(node => node.id === 'file')).toBe(before.find(node => node.id === 'file'))
    expect(after).toEqual(registry.createEvaluator()({ text, facts }))
  })

  it('matches a new evaluator through additions and withdrawals of multiple business Facts', () => {
    const { evaluate, registry } = setup()
    const texts = [
      '🙂 @\u3055\u3064\u304a @src/@types/react/index.d.ts /review @docs/',
      '/review @"docs /review notes.md" @types/react/index.d.ts',
      '@\u3055\u3064\u304a@src/a.ts @\u3055\u3064\u304a/plan @src/@[\u3055\u3064\u304a](dsh-session:x)',
      '@\u308b\u3044 /review @src/a.ts /goal',
    ]
    const factsList: readonly Partial<UserTextFacts>[] = [
      {}, { sessionLabels: ['\u3055\u3064\u304a', 'types'] }, { skillNames: ['review', 'plan'] },
      { sessionLabels: ['\u3055\u3064\u304a', 'types'], skillNames: ['review', 'plan'] },
      { sessionLabels: ['\u308b\u3044 /review', '\u3055\u3064\u304a'], skillNames: ['review'], commands: [{ start: 0, end: 7, name: 'review' }] },
      {},
    ]
    for (const text of texts) for (const facts of factsList) {
      expect(evaluate({ text, facts })).toEqual(registry.createEvaluator()({ text, facts }))
    }
  })
})
