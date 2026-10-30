// @vitest-environment jsdom
/**
 * Inline projection of sent user text: decoration adds no block containers,
 * preserves whitespace, and folds wire session forms to their label.
 */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Context } from '@hackdevcode/cordis'
import type { ComponentProps } from 'react'
import { UserText } from '../src/client/user-text/UserText.tsx'
import { UserTextRegistry } from '../src/client/conversation/user-text-registry.ts'
import { createUserTextFixture } from './user-text-component-fixture.client.tsx'

afterEach(cleanup)

function textView(
  text: string,
  labels: readonly string[] = [],
  slashNames: readonly string[] = [],
  slashKind: 'skill' | 'command' = 'skill',
  actions?: Parameters<typeof createUserTextFixture>[0],
) {
  const head = text.split(/\s/u, 1)[0]
  const command = slashNames.find(name => head === `/${name}`)
  const facts = {
    sessionLabels: labels,
    ...(slashKind === 'skill' ? { skillNames: slashNames }
      : { commands: command === undefined ? [] : [{ start: 0, end: command.length + 1, name: command }] }),
  }
  return createUserTextFixture(actions)({ text, facts, interactive: actions !== undefined })
}

const project = (
  text: string,
  labels: readonly string[] = [],
  slashNames: readonly string[] = [],
  slashKind: 'skill' | 'command' = 'skill',
) =>
  render(<div data-host>{textView(text, labels, slashNames, slashKind)}</div>).container.querySelector('[data-host]')!

describe('UserText projection', () => {
  it('retains complete original text, reports a cached matching failure once, and recovers', () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const registry = new UserTextRegistry(ctx)
    const cause = new Error('matching unavailable')
    registry.register({ id: 'session', order: 0, match: (text, from, context) => {
      if (from > 0) return undefined
      if (context.read('sessionLabels') === undefined) throw cause
      return { id: 'session', start: 0, end: text.length, data: { label: 'ready' } }
    } })
    const evaluate = registry.createEvaluator()
    const report = vi.fn()
    const renderSlot = vi.fn(() => <span>recognized output</span>)
    const text = '  complete /original\n@reference  '
    const props = {
      text, facts: {}, createUserTextEvaluator: () => evaluate,
      useUserTextRevision: selector => selector(registry.getSnapshot()),
      reportTransformFailure: report, renderSlot,
    } satisfies Partial<ComponentProps<typeof UserText>>
    const view = render(<UserText {...props as ComponentProps<typeof UserText>} />)
    expect(view.container.textContent).toBe(text)
    expect(renderSlot).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledOnce()
    expect(report.mock.calls[0]?.[0]).toMatchObject({ ruleId: 'session', cause })
    view.rerender(<UserText {...props as ComponentProps<typeof UserText>} facts={{ collapseWhitespace: false }} />)
    expect(view.container.textContent).toBe(text)
    expect(report).toHaveBeenCalledOnce()
    view.rerender(<UserText {...props as ComponentProps<typeof UserText>} facts={{ sessionLabels: ['ready'] }} />)
    expect(view.getByText('recognized output')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledOnce()
  })

  it('keeps decorated text inline and preserves whitespace between references', () => {
    const host = project('\u3064\u3064\u3075\u3075 /dsh-acp-test @\u307b\u306e\u307e\u3042\u3053\u3046\u3057\u3053', ['\u307b\u306e\u307e\u3042\u3053\u3046\u3057\u3053'], ['dsh-acp-test'])
    expect(host.querySelectorAll('div').length).toBe(0)
    expect(host.textContent).toBe('\u3064\u3064\u3075\u3075 /dsh-acp-test \u307b\u306e\u307e\u3042\u3053\u3046\u3057\u3053')
    const chips = host.querySelectorAll('[data-ref-chip]')
    expect([...chips].map(c => c.getAttribute('data-ref-chip'))).toEqual(['skill', 'session'])
    // The whitespace between tokens survives as its own inline run.
    const runs = [...host.querySelectorAll('span')].filter(s =>
      s.childElementCount === 0 && !s.hasAttribute('data-ref-chip') && s.closest('[data-ref-chip]') === null)
    expect(runs.map(r => r.textContent)).toEqual(['\u3064\u3064\u3075\u3075 ', ' '])
  })

  it('folds the wire session form to its label with the session glyph', () => {
    const host = project('\u306d\u306d @[\u3053\u306d\u3080\u306c\u3061\u304d\u3093](dsh-session:InNlc3Npb24tNDM0) \u3072\u3088\u3078')
    const chip = host.querySelector('[data-ref-chip="session"]')!
    expect(chip.textContent).toBe('\u3053\u306d\u3080\u306c\u3061\u304d\u3093')
    expect(chip.getAttribute('title')).toBe('@[\u3053\u306d\u3080\u306c\u3061\u304d\u3093](dsh-session:InNlc3Npb24tNDM0)')
    expect(chip.querySelector('svg')).not.toBeNull()
    expect(host.textContent).toBe('\u306d\u306d \u3053\u306d\u3080\u306c\u3061\u304d\u3093 \u3072\u3088\u3078')
  })

  it('prefers the wire fold over the bare-token scan on the same range', () => {
    const host = project('@[a](dsh-session:x)', [])
    expect(host.querySelectorAll('[data-ref-chip]').length).toBe(1)
    expect(host.querySelector('[data-ref-chip="session"]')!.textContent).toBe('a')
  })

  it('decorates recall-associated labels, files, folders, and quoted paths', () => {
    const host = project('@\u3055\u3064\u304a \u308b @src/deep/file.txt \u3066 @dir/ \u3066 @"a b.md"', ['\u3055\u3064\u304a'])
    const kinds = [...host.querySelectorAll('[data-ref-chip]')].map(c =>
      [c.getAttribute('data-ref-chip'), c.textContent])
    expect(kinds).toEqual([
      ['session', '\u3055\u3064\u304a'],
      ['file', 'file.txt'],
      ['folder', 'dir'],
      ['file', 'a b.md'],
    ])
  })

  it('repeated recall labels decorate every occurrence once', () => {
    const host = project('@\u308a\u306d \u3044\u306f @\u308a\u306d', ['\u308a\u306d', '\u308a\u306d'])
    expect(host.querySelectorAll('[data-ref-chip="session"]').length).toBe(2)
  })

  it('keeps a punctuation-glued slash token plain and skips degenerate tokens', () => {
    // The host skill gesture ends at whitespace or the text end, so `/plan\u3002`
    // never loads a skill; the bubble must not suggest otherwise.
    const host = project('\u3042 /plan\u3002 \u3053\u3053 @\u3002', [], ['plan'])
    expect(host.querySelectorAll('[data-ref-chip]').length).toBe(0)
    expect(host.textContent).toBe('\u3042 /plan\u3002 \u3053\u3053 @\u3002')
  })

  it('decorates a slash token only when the host resolved it as a skill in that step', () => {
    const bare = project('/123')
    expect(bare.querySelectorAll('[data-ref-chip]').length).toBe(0)
    expect(bare.textContent).toBe('/123')
    const unresolved = project('\u3042 /plan \u306d\u306d')
    expect(unresolved.querySelectorAll('[data-ref-chip]').length).toBe(0)
    const resolved = project('\u3042 /plan \u306d\u306d', [], ['plan'])
    expect([...resolved.querySelectorAll('[data-ref-chip]')].map(c => [c.getAttribute('data-ref-chip'), c.textContent]))
      .toEqual([['skill', '/plan']])
  })

  it('marks a resolved slash token as a command chip when the caller says so', () => {
    const host = project('/goal ship it\nsecond line', [], ['goal'], 'command')
    const chips = [...host.querySelectorAll('[data-ref-chip]')]
    expect(chips.map(c => [c.getAttribute('data-ref-chip'), c.textContent])).toEqual([['command', '/goal']])
    expect(host.textContent).toBe('/goal ship it\nsecond line')
  })

  it('leaves slash paths undecorated even for a resolved name: a /name token ends at whitespace', () => {
    const text = '\u3057\u3053\u304a\u305fui\uff0c\u3064\u3042\u3044\u3084\uff1a\n/nfs-hg/xxx/yyy \u3066 /root-dir/ \u306e /plan.md'
    const host = project(text, [], ['nfs-hg', 'root-dir', 'plan'])
    expect(host.querySelectorAll('[data-ref-chip]').length).toBe(0)
    expect(host.textContent).toBe(text)
  })

  it('prefers the longer recall label when one nests inside another', () => {
    const host = project('@\u3055\u3064\u304a \u3059\u3061', ['\u3055\u3064', '\u3055\u3064\u304a'])
    const chips = [...host.querySelectorAll('[data-ref-chip="session"]')]
    expect(chips.map(c => c.textContent)).toEqual(['\u3055\u3064\u304a'])
    expect(host.textContent).toBe('\u3055\u3064\u304a \u3059\u3061')
  })

  it('falls back to the raw quoted label when the path has no basename', () => {
    const host = project('\u306d @"/" \u305f\u306c')
    const chip = host.querySelector('[data-ref-chip="folder"]')!
    expect(chip.textContent).toBe('"/"')
  })

  it('opens decoded files and loaded skills without activating session, folder, or command references', () => {
    const openFile = vi.fn()
    const openSkill = vi.fn()
    const view = render(<div>{textView(
      '@src/a.ts @"notes a.md" /review @history @dir/ @"dir a/"', ['history'], ['review'], 'skill',
      { openFile, openSkill },
    )}</div>)
    fireEvent.click(view.getByRole('button', { name: 'a.ts' }))
    fireEvent.click(view.getByRole('button', { name: 'notes a.md' }))
    fireEvent.click(view.getByRole('button', { name: '/review' }))
    expect(openFile.mock.calls).toEqual([['src/a.ts'], ['notes a.md']])
    expect(openSkill).toHaveBeenCalledWith('review')
    expect(view.container.querySelectorAll('button')).toHaveLength(3)
    const command = render(<div>{textView('/help', [], ['help'], 'command', { openFile, openSkill })}</div>)
    expect(command.container.querySelector('button')).toBeNull()
  })

  it('preserves text-selection gestures and keyboard activation', () => {
    const openFile = vi.fn()
    const view = render(<div>{textView('@notes.md', [], [], 'skill', { openFile, openSkill: vi.fn() })}</div>)
    const button = view.getByRole('button', { name: 'notes.md' })
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(button)
    selection.addRange(range)
    fireEvent.click(button, { detail: 1 })
    expect(openFile).not.toHaveBeenCalled()
    fireEvent.click(button, { detail: 0 })
    expect(openFile).toHaveBeenCalledWith('notes.md')
    selection.removeAllRanges()
    openFile.mockClear()
    fireEvent.click(button, { detail: 2 })
    expect(openFile).not.toHaveBeenCalled()
  })

  it('renders undecorated text as one inline run', () => {
    const host = project('\u3044\u3044\u3051\uff0c\u3092\u304f\u3042')
    expect(host.querySelectorAll('div').length).toBe(0)
    expect(host.querySelectorAll('[data-ref-chip]').length).toBe(0)
    expect(host.textContent).toBe('\u3044\u3044\u3051\uff0c\u3092\u304f\u3042')
  })
})
