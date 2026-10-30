// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { compactReport } from '@hackdevcode/dsh-tool-hackdev/src/render.ts'
import type { HackDevReport } from '@hackdevcode/dsh-tool-hackdev/src/render.ts'
import { ATTENTION_PREVIEW, HackDevCard, type HackDevCardProps } from '../src/client/HackDevCard.tsx'

afterEach(cleanup)

/** Echo keys and parameters so assertions read structure, not copy. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}${JSON.stringify(params)}`) as HackDevCardProps['t']

const REPORT: HackDevReport = {
  status: 'needs-attention',
  mission: 'm',
  planFallback: true,
  plan: { summary: 'Three tasks', stack: 'node', requirements: [], acceptanceCriteria: [] },
  tasks: [
    { id: 'api', title: 'API', status: 'done', summary: 'built', filesChanged: ['a'], evidence: ['npm test'], followUps: [], needsHuman: [] },
    { id: 'ui', title: 'UI', status: 'failed', summary: 'crashed twice', filesChanged: [], evidence: [], followUps: [], needsHuman: [] },
  ],
  gates: [
    {
      gate: 'Security reviewer', verdict: 'fail', rounds: 2, fixedIssues: 1, summary: 'xss remains',
      checks: [{ name: 'npm audit', outcome: 'pass', detail: 'clean' }, { name: 'probe', outcome: 'fail', detail: 'boom' }],
      issues: [{ severity: 'high', title: 'stored xss', status: 'open' }, { severity: 'low', title: 'headers', status: 'fixed' }],
      hasUi: true, uiVerified: false, limitations: ['no browser available'],
    },
  ],
  needsHuman: ['approve deploy'],
  memoryEntries: 5,
  recorded: false,
}

interface Overrides {
  phase?: 'preparing' | 'start' | 'result'
  toolName?: string
  meta?: unknown
  isError?: boolean
  content?: { type: 'text'; text: string }[]
  argsRaw?: string
  expanded?: boolean
}

function card(o: Overrides = {}): HackDevCardProps {
  const phase = o.phase ?? 'result'
  const block = phase === 'result'
    ? { kind: 'tool-result', callId: 'c1', name: o.toolName ?? 'hackdev', meta: o.meta, isError: o.isError ?? false, content: o.content ?? [] }
    : { phase, callId: 'c1', name: o.toolName ?? 'hackdev', argsRaw: o.argsRaw ?? '{"mission":"Build a notes app"}' }
  let expanded = o.expanded ?? true
  return {
    phase,
    block,
    toolName: o.toolName ?? 'hackdev',
    useDisclosure: () => ({ expanded, setExpanded: (open: boolean) => { expanded = open }, toggle: () => { expanded = !expanded } }),
    t,
  } as never
}

describe('HackDevCard', () => {
  it('shows a running state with the mission and a pointer to the live run node', () => {
    render(<HackDevCard {...card({ phase: 'start' })} />)
    expect(screen.getByText('status.running')).toBeTruthy()
    const running = screen.getByTestId('hackdev-running')
    expect(within(running).getByText('running.hint')).toBeTruthy()
    expect(within(running).getByText('Build a notes app')).toBeTruthy()
  })

  it('shows only a running header while arguments are still preparing', () => {
    render(<HackDevCard {...card({ phase: 'preparing' })} />)
    expect(screen.getByText('status.running')).toBeTruthy()
    expect(screen.queryByTestId('hackdev-running')).toBeNull()
  })

  it('renders attention items first, then plan, tasks, gates and the footer', () => {
    render(<HackDevCard {...card({ meta: compactReport(REPORT) })} />)
    const report = screen.getByTestId('hackdev-report')
    expect(report.getAttribute('data-status')).toBe('needs-attention')
    expect(screen.getByText('status.needsAttention')).toBeTruthy()

    const attention = within(screen.getByTestId('hackdev-attention'))
    expect(attention.getAllByRole('listitem').length).toBe(3)
    expect(attention.getByText(/attention\.task/)).toBeTruthy()
    expect(attention.getByText(/attention\.open/)).toBeTruthy()
    expect(attention.getByText(/attention\.human/)).toBeTruthy()

    const tasks = within(screen.getByTestId('hackdev-tasks')).getAllByRole('listitem')
    expect(tasks.map(li => li.getAttribute('data-status'))).toEqual(['done', 'failed'])

    const gate = screen.getByTestId('hackdev-gate')
    expect(gate.getAttribute('data-verdict')).toBe('fail')
    expect((gate as HTMLDetailsElement).open).toBe(true)
    expect(within(gate).getByText('Security reviewer')).toBeTruthy()
    expect(within(gate).getByText('stored xss')).toBeTruthy()
    expect(within(gate).getByText('gate.uiNotVerified')).toBeTruthy()
    expect(within(gate).getByText('no browser available')).toBeTruthy()

    expect(report.textContent).toContain('planFallback')
    expect(report.textContent).toContain('footer.notRecorded')
  })

  it('previews a long attention list and reveals the rest on request', () => {
    const many: HackDevReport = {
      ...REPORT,
      needsHuman: Array.from({ length: 20 }, (_, i) => `approve step ${i}`),
    }
    render(<HackDevCard {...card({ meta: compactReport(many) })} />)
    const attention = screen.getByTestId('hackdev-attention')
    expect(within(attention).getAllByRole('listitem').length).toBe(ATTENTION_PREVIEW)
    const toggle = within(attention).getByRole('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('attention.showAll{"count":6}')
    fireEvent.click(toggle)
    // 1 unfinished task + 1 open issue + 10 approvals (the host payload caps approvals at 10).
    expect(within(attention).getAllByRole('listitem').length).toBe(12)
    expect(within(attention).getByRole('button').textContent).toBe('attention.showFewer')
    fireEvent.click(within(attention).getByRole('button'))
    expect(within(attention).getAllByRole('listitem').length).toBe(ATTENTION_PREVIEW)
  })

  it('shows no toggle when the attention list fits the preview', () => {
    render(<HackDevCard {...card({ meta: compactReport(REPORT) })} />)
    expect(within(screen.getByTestId('hackdev-attention')).queryByRole('button')).toBeNull()
  })

  it('shows a clean complete run without an attention section', () => {
    const clean: HackDevReport = {
      ...REPORT,
      status: 'complete',
      planFallback: false,
      tasks: [REPORT.tasks[0]!],
      gates: [{ ...REPORT.gates[0]!, verdict: 'pass', issues: [], hasUi: true, uiVerified: true, uiEvidence: [{ viewport: '1280x800', artifact: 'shots/d.png', observation: 'clean layout' }], limitations: [] }],
      needsHuman: [],
      recorded: true,
    }
    render(<HackDevCard {...card({ meta: compactReport(clean) })} />)
    expect(screen.getByText('status.complete')).toBeTruthy()
    expect(screen.queryByTestId('hackdev-attention')).toBeNull()
    expect(screen.getByText('gate.uiVerified{"count":1}')).toBeTruthy()
    expect(within(screen.getByTestId('hackdev-screenshots')).getByText(/clean layout/)).toBeTruthy()
    expect(screen.getByTestId('hackdev-report').textContent).toContain('footer.recorded')
  })

  it('shows waves, acceptance criteria and task roles and fact-check results', () => {
    const waved: HackDevReport = {
      ...REPORT,
      waves: 2,
      tasks: [
        { ...REPORT.tasks[0]!, role: 'backend', wave: 1, verified: true },
        { ...REPORT.tasks[1]!, role: 'frontend', wave: 2, verified: false },
        { ...REPORT.tasks[1]!, id: 'gone', replaced: true },
      ],
      criteria: [{ criterion: 'notes persist', met: false, evidence: 'reload loses notes' }, { criterion: 'list renders', met: true, evidence: '' }],
    }
    render(<HackDevCard {...card({ meta: compactReport(waved) })} />)
    const report = screen.getByTestId('hackdev-report')
    expect(report.textContent).toContain('waves{"count":2}')
    const criteria = screen.getByTestId('hackdev-criteria')
    expect(within(criteria).getAllByRole('listitem').map(li => li.getAttribute('data-met'))).toEqual(['false', 'true'])
    expect(within(criteria).getByText(/reload loses notes/)).toBeTruthy()
    const tasks = within(screen.getByTestId('hackdev-tasks')).getAllByRole('listitem')
    expect(tasks[0]!.textContent).toContain('task.role{"role":"backend"}')
    expect(tasks[0]!.textContent).toContain('task.verified')
    expect(tasks[1]!.textContent).toContain('task.wave{"count":2}')
    expect(tasks[1]!.textContent).toContain('task.unverified')
    expect(tasks[2]!.textContent).toContain('task.replaced')
    const attention = within(screen.getByTestId('hackdev-attention'))
    expect(attention.getByText(/attention\.criterion/)).toBeTruthy()
    // The replaced task is not an attention item.
    expect(attention.queryByText(/"id":"gone"/)).toBeNull()
  })

  it('collapses passed gates to their headline and opens failed ones', () => {
    const mixed: HackDevReport = {
      ...REPORT,
      gates: [{ ...REPORT.gates[0]!, gate: 'Verifier', verdict: 'pass', issues: [] }, REPORT.gates[0]!],
    }
    render(<HackDevCard {...card({ meta: compactReport(mixed) })} />)
    const gates = screen.getAllByTestId('hackdev-gate') as HTMLDetailsElement[]
    expect(gates.map(g => g.getAttribute('data-verdict'))).toEqual(['pass', 'fail'])
    expect(gates.map(g => g.open)).toEqual([false, true])
    // The headline stays visible whether or not the body is open.
    expect(within(gates[0]!).getByText('Verifier')).toBeTruthy()
  })

  it('titles the gate-only tool as a review and reports gates without task counts', () => {
    render(<HackDevCard {...card({ toolName: 'hackdev_review', meta: compactReport({ ...REPORT, tasks: [] }) })} />)
    expect(screen.getByText('title.review')).toBeTruthy()
    expect(screen.getByText(/summary\.gatesOnly/)).toBeTruthy()
  })

  it('falls back to the plain result text when the meta is missing or from another version', () => {
    render(<HackDevCard {...card({ meta: { v: 99 }, content: [{ type: 'text', text: 'Hack Dev Code run: COMPLETE' }] })} />)
    expect(screen.getByTestId('hackdev-fallback').textContent).toContain('Hack Dev Code run: COMPLETE')
    expect(screen.queryByTestId('hackdev-report')).toBeNull()
  })

  it('shows a failed run with its error text', () => {
    render(<HackDevCard {...card({ isError: true, meta: undefined, content: [{ type: 'text', text: 'workflow was cancelled' }] })} />)
    expect(screen.getByText('status.failed')).toBeTruthy()
    expect(screen.getByTestId('hackdev-fallback').textContent).toContain('workflow was cancelled')
  })

  it('collapses its body when the disclosure is closed and toggles from the header', () => {
    render(<HackDevCard {...card({ meta: compactReport(REPORT), expanded: false })} />)
    expect(screen.queryByTestId('hackdev-report')).toBeNull()
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button')[0]!)
  })
})
