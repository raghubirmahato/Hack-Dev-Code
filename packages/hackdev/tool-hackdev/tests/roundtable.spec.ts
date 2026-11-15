import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HACKDEV_ROUNDTABLE_SCRIPT } from '../src/roundtable.ts'
import { namedToolNote, READ_ONLY_ROLE, readRoundtable, roundtableBudget } from '../src/index.ts'
import { renderRoundtable } from '../src/render.ts'
import type { RoundtableReport } from '../src/render.ts'

interface AgentCall {
  prompt: string
  label: string
  phase?: string | undefined
  schema?: unknown
  model?: string | undefined
  session?: string | undefined
}
type AgentImpl = (call: AgentCall, n: number) => unknown
type AgentOptions = { label?: string; phase?: string; schema?: unknown; model?: string; session?: string }

/** Execute the guest script with the hook surface the workflow engine provides. */
async function runRoundtable(args: Record<string, unknown>, impl: AgentImpl): Promise<{ value: RoundtableReport; calls: AgentCall[] }> {
  const calls: AgentCall[] = []
  const hooks = {
    args,
    phase: () => {},
    log: () => {},
    agent: async (prompt: string, opts: AgentOptions = {}) => {
      const call: AgentCall = { prompt, label: opts.label ?? '', phase: opts.phase, schema: opts.schema, model: opts.model, session: opts.session }
      calls.push(call)
      try {
        return await impl(call, calls.length)
      } catch {
        return null
      }
    },
    parallel: (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map(async (t) => {
      try { return await t() } catch { return null }
    })),
  }
  const value: unknown = await vm.runInContext(`(async () => {\n${HACKDEV_ROUNDTABLE_SCRIPT}\n})()`, vm.createContext(hooks))
  return { value: JSON.parse(JSON.stringify(value)) as RoundtableReport, calls }
}

const ARGS = { question: 'Should the cache be keyed by user or by tenant?', agents: 4, rounds: 3, maxMemoryChars: 6000, maxParallel: 4, models: { planner: '', builder: '', verifier: '' } }
const FINAL = { answer: 'Key it by tenant.', confidence: 0.8, agreed: ['tenants share data'], disputes: [{ topic: 'per-user keys', resolution: 'rejected: no per-user data' }], dissent: [], openQuestions: [] }

function scripted(over: Partial<Record<string, AgentImpl>> = {}): AgentImpl {
  return (call, n) => {
    for (const [prefix, fn] of Object.entries(over)) {
      if (call.label.startsWith(prefix) && fn !== undefined) return fn(call, n)
    }
    if (call.label.startsWith('Roundtable: @captain (after')) return { consensus: false, summary: 'still split', posts: [] }
    if (call.label.startsWith('Roundtable: @captain (final')) return FINAL
    if (call.label.startsWith('Roundtable: @')) return { answer: 'Tenant.', confidence: 0.7, posts: [] }
    throw new Error(`unexpected agent ${call.label}`)
  }
}

describe('HACKDEV_ROUNDTABLE_SCRIPT', () => {
  it('runs a captain and three specialists that share one board and continue their own conversations', async () => {
    const { value, calls } = await runRoundtable(ARGS, scripted({
      'Roundtable: @researcher (round 1)': () => ({
        answer: 'Tenant.', confidence: 0.6,
        posts: [{ to: 'logician', kind: 'question', text: 'Is any data per user?' }, { to: 'all', kind: 'finding', text: 'cache.ts:12 keys by tenant id' }],
      }),
      'Roundtable: @logician (round 2)': (call) => {
        // Round 2 shows only what is new, and the question addressed to this member comes first.
        expect(call.prompt).toContain('Posts addressed to you:\n#1 [round 1] @researcher -> @logician (question): Is any data per user?')
        return { answer: 'Tenant.', confidence: 0.9, posts: [{ to: 'researcher', kind: 'answer', ref: 1, text: 'No, sessions are tenant-wide (session.ts:40).' }] }
      },
    }))
    const members = calls.filter(c => c.label.startsWith('Roundtable: @') && !c.label.includes('@captain')).map(c => c.label)
    expect(members.filter(l => l.endsWith('(round 1)'))).toEqual(['Roundtable: @researcher (round 1)', 'Roundtable: @logician (round 1)', 'Roundtable: @contrarian (round 1)'])
    // Every member keeps one conversation across rounds.
    expect(new Set(calls.filter(c => c.label.includes('@logician')).map(c => c.session))).toEqual(new Set(['roundtable:logician']))
    expect(value).toMatchObject({ kind: 'roundtable', answer: 'Key it by tenant.', consensus: false, rounds: 3 })
    expect(value.board.find(p => p.kind === 'answer')).toMatchObject({ from: 'logician', to: ['researcher'], ref: 1 })
    expect(readRoundtable(value)).toBe(value)
  })

  it('stops early when the captain finds agreement, and staffs each angle again for more agents', async () => {
    const { value, calls } = await runRoundtable({ ...ARGS, agents: 7 }, scripted({
      'Roundtable: @captain (after': () => ({ consensus: true, summary: 'all agree on tenant keys', posts: [] }),
    }))
    expect(value.members.map(m => m.name)).toEqual(['captain', 'researcher', 'logician', 'contrarian', 'researcher-2', 'logician-2', 'contrarian-2'])
    expect(value).toMatchObject({ consensus: true, rounds: 1, summaries: ['Round 1: all agree on tenant keys'] })
    expect(calls.filter(c => c.label.endsWith('(round 2)'))).toHaveLength(0)
    expect(calls.length).toBeLessThanOrEqual(roundtableBudget(7, 3))
  })

  it('falls back to the most confident member answer when the captain writes none', async () => {
    const { value } = await runRoundtable(ARGS, scripted({
      'Roundtable: @captain (final': () => null,
      'Roundtable: @contrarian': () => ({ answer: 'Per user, for isolation.', confidence: 0.95, posts: [] }),
    }))
    expect(value.answer).toContain('Per user, for isolation.')
    expect(value.answer).toContain('from @contrarian')
  })

  it('renders the answer, the disputes and the newest posts within the budget', async () => {
    const { value } = await runRoundtable(ARGS, scripted())
    const text = renderRoundtable(value, 4000)
    expect(text).toMatch(/^# Roundtable answer \(confidence 80%, round limit reached after 3 rounds\)\n\nKey it by tenant\./u)
    expect(text).toContain('- per-user keys: rejected: no per-user data')
    expect(renderRoundtable(value, 300).length).toBeLessThanOrEqual(320)
  })
})

describe('roundtable wiring', () => {
  it('keeps members read-only and recognizes the tool by name', () => {
    expect(READ_ONLY_ROLE.test('Roundtable: @researcher (round 1)')).toBe(true)
    expect(namedToolNote('Use a roundtable (hackdev_roundtable) to decide: caching')).toContain('`hackdev_roundtable`')
  })
})
