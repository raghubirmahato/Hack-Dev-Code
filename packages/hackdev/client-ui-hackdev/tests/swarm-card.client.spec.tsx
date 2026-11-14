// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { compactReport } from '@hackdevcode/dsh-tool-hackdev/src/render.ts'
import type { HackDevReport } from '@hackdevcode/dsh-tool-hackdev/src/render.ts'
import { BOARD_PREVIEW, HackDevCard, type HackDevCardProps } from '../src/client/HackDevCard.tsx'
import { readHackDevMeta } from '../src/client/model.ts'

afterEach(cleanup)

/** Echo keys and parameters so assertions read structure, not copy. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}${JSON.stringify(params)}`) as HackDevCardProps['t']

const SWARM: HackDevReport = {
  status: 'needs-attention',
  mission: 'Build a parser',
  planFallback: false,
  plan: { summary: 'A parser and a CLI', stack: 'node', requirements: [], acceptanceCriteria: ['c1'], complexity: 'swarm' },
  waves: 2,
  tasks: [
    { id: 'parser', title: 'Parser', role: 'backend', wave: 1, verified: true, status: 'done', summary: 'built', filesChanged: ['a'], evidence: ['npm test'], followUps: [], needsHuman: [] },
    { id: 'cli', title: 'CLI', role: 'backend', wave: 2, verified: false, status: 'partial', summary: 'crashes', filesChanged: [], evidence: [], followUps: [], needsHuman: [] },
  ],
  criteria: [{ criterion: 'c1', met: false, evidence: 'cli fails' }],
  gates: [{
    gate: 'Verifier @verify (@parser, @cli)', verdict: 'fail', rounds: 2, fixedIssues: 0, summary: 'cli is broken',
    checks: [{ name: '@parser: npm test', outcome: 'pass', detail: '' }],
    issues: [{ severity: 'high', title: '@cli: crashes on empty input', status: 'open' }],
    hasUi: false, uiVerified: false, limitations: [],
  }],
  needsHuman: [],
  memoryEntries: 0,
  recorded: true,
  swarm: {
    name: 'md-parser',
    rounds: 2,
    stalled: true,
    members: [
      { name: 'coordinator', kind: 'coordinator', role: 'coordinator', model: 'big', rounds: 1 },
      { name: 'parser', kind: 'worker', role: 'backend', model: '', rounds: 1 },
      { name: 'cli', kind: 'worker', role: 'backend', model: '', rounds: 2 },
      { name: 'verify', kind: 'verifier', role: 'verifier', model: 'strict', rounds: 2 },
    ],
    posts: 12,
    board: Array.from({ length: 12 }, (_, i) => ({
      n: i + 1, round: i < 6 ? 1 : 2, from: i % 2 === 0 ? 'verify' : 'cli', to: [i % 2 === 0 ? 'cli' : 'all'],
      kind: i % 2 === 0 ? 'problem' : 'status', text: `post ${String(i + 1)}`,
    })),
  },
}

function card(meta: unknown): HackDevCardProps {
  return {
    phase: 'result',
    block: { kind: 'tool-result', callId: 'c1', name: 'hackdev_swarm', meta, isError: false, content: [] },
    toolName: 'hackdev_swarm',
    useDisclosure: () => ({ expanded: true, setExpanded: () => {}, toggle: () => {} }),
    t,
  } as never
}

describe('HackDevCard for a swarm', () => {
  it('narrows the swarm block and rejects a malformed one', () => {
    const meta = compactReport(SWARM) as Record<string, unknown>
    const view = readHackDevMeta(meta)
    expect(view?.swarm?.members.map(m => m.name)).toEqual(['coordinator', 'parser', 'cli', 'verify'])
    expect(view?.swarm?.board).toHaveLength(12)
    expect(view?.stalled).toBe(false)
    expect(readHackDevMeta({ ...meta, swarm: { name: 'x' } })).toBeNull()
    // A mission payload has no swarm.
    expect(readHackDevMeta(compactReport({ ...SWARM, swarm: undefined } as unknown as HackDevReport))?.swarm).toBeNull()
  })

  it('shows the members with their pinned models, workers by @name and the monitor notice', () => {
    render(<HackDevCard {...card(compactReport(SWARM))} />)
    expect(screen.getByText('title.swarm')).toBeTruthy()
    const swarm = screen.getByTestId('hackdev-swarm')
    expect(within(swarm).getByText('swarm{"name":"md-parser"}')).toBeTruthy()
    expect(within(swarm).getByText('swarm.summary{"workers":2,"verifiers":1,"count":2}')).toBeTruthy()
    expect(within(swarm).getByText('swarm.stalled')).toBeTruthy()
    expect(within(swarm).getByText('swarm.kind.coordinator · big · swarm.rounds{"count":1}')).toBeTruthy()
    const tasks = screen.getByTestId('hackdev-tasks')
    expect(within(tasks).getByText('@cli')).toBeTruthy()
    expect(within(tasks).getByText(/task\.unverifiedSwarm/)).toBeTruthy()
    expect(screen.getByText('workers')).toBeTruthy()
    expect(screen.getByText('verifiers')).toBeTruthy()
  })

  it('previews the newest board posts and expands to the whole board', () => {
    render(<HackDevCard {...card(compactReport(SWARM))} />)
    const board = screen.getByTestId('hackdev-board')
    expect(within(board).getByText('board{"count":12}')).toBeTruthy()
    expect(within(board).getAllByRole('listitem')).toHaveLength(BOARD_PREVIEW)
    expect(within(board).queryByText('post 1')).toBeNull()
    expect(within(board).getByText('post 12')).toBeTruthy()
    fireEvent.click(within(board).getByRole('button'))
    expect(within(board).getAllByRole('listitem')).toHaveLength(12)
    expect(within(board).getByText('post 1')).toBeTruthy()
  })
})
