import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HACKDEV_SWARM_SCRIPT } from '../src/swarm.ts'
import { swarmBudget, ENGINE_AGENT_CEILING } from '../src/index.ts'
import { compactReport, renderReport } from '../src/render.ts'
import type { HackDevReport } from '../src/render.ts'

interface AgentCall {
  prompt: string
  label: string
  phase?: string | undefined
  schema?: unknown
  model?: string | undefined
  cwd?: string | undefined
  session?: string | undefined
}
type AgentImpl = (call: AgentCall, n: number) => unknown
type AgentOptions = { label?: string; phase?: string; schema?: unknown; model?: string; cwd?: string; session?: string }

/**
 * Execute the guest script with the same hook surface the workflow engine provides.
 * @param refuse - conversation names the fake engine cannot continue: like the real one, it throws for them.
 */
async function runSwarm(
  args: Record<string, unknown>, impl: AgentImpl, refuse: ReadonlySet<string> = new Set(),
): Promise<{ value: HackDevReport; calls: AgentCall[]; logs: string[] }> {
  const calls: AgentCall[] = []
  const logs: string[] = []
  const started = new Set<string>()
  const hooks = {
    args,
    phase: () => {},
    log: (message: string) => { logs.push(message) },
    agent: async (prompt: string, opts: AgentOptions = {}) => {
      const call: AgentCall = { prompt, label: opts.label ?? '', phase: opts.phase, schema: opts.schema, model: opts.model, cwd: opts.cwd, session: opts.session }
      calls.push(call)
      if (opts.session !== undefined) {
        if (started.has(opts.session) && refuse.has(opts.session)) throw new Error('subagent is unavailable')
        started.add(opts.session)
      }
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
  const value: unknown = await vm.runInContext(`(async () => {\n${HACKDEV_SWARM_SCRIPT}\n})()`, vm.createContext(hooks))
  return { value: JSON.parse(JSON.stringify(value)) as HackDevReport, calls, logs }
}

const ARGS = {
  mission: 'Build a markdown parser with a CLI', maxWorkers: 8, maxRounds: 3, maxFixRounds: 1, maxMemoryChars: 6000, maxParallel: 4,
  visionModel: '', builderIsolation: 'shared', review: false, notes: '', models: { planner: '', builder: '', verifier: '' },
}

function member(name: string, over: Record<string, unknown> = {}) {
  return { name, role: 'backend', brief: `Build the ${name} module.`, owns: [`src/${name}`], mustNotTouch: ['package.json'], done: `${name} tests pass`, dependsOn: [], ...over }
}
function swarm(workers: unknown[], over: Record<string, unknown> = {}) {
  return { swarmName: 'md-parser', summary: 'A parser and a CLI', stack: 'node', acceptanceCriteria: ['c1'], contracts: ['parse(text) returns Node[]'], workers, ...over }
}
function work(over: Record<string, unknown> = {}) {
  return { status: 'done', summary: 'built it', filesChanged: ['src/a.ts'], evidence: ['npm test: 4 passed'], posts: [], needsHuman: [], ...over }
}
const pass = { name: 'npm test', outcome: 'pass', detail: '4 passed' }
/** A verifier that passes every worker named in its prompt. */
function passAll(call: AgentCall, names: string[]) {
  return { summary: 'all good', reviews: names.filter(n => call.prompt.includes(`- @${n} [`)).map(worker => ({ worker, verdict: 'pass', checks: [pass], problems: [] })), posts: [] }
}
const FINAL = { summary: 'done', criteria: [{ criterion: 'c1', met: true, evidence: 'npm test' }] }

function impl(names: string[], overrides: Partial<Record<string, (call: AgentCall, n: number) => unknown>> = {}): AgentImpl {
  return (call, n) => {
    for (const [prefix, fn] of Object.entries(overrides)) {
      if (call.label.startsWith(prefix) && fn !== undefined) return fn(call, n)
    }
    if (call.label.startsWith('@coordinator: form')) return swarm(names.map(name => member(name)))
    if (call.label.startsWith('@coordinator: answer')) return { posts: [] }
    if (call.label.startsWith('@coordinator: final')) return FINAL
    if (call.label.startsWith('@verify')) return passAll(call, names)
    if (call.label.startsWith('@')) return work()
    if (call.label === 'Chronicler') return 'recorded.'
    throw new Error(`unexpected agent ${call.label}`)
  }
}

describe('HACKDEV_SWARM_SCRIPT', () => {
  it('forms a named swarm, runs the workers in parallel, verifies them and reports complete', async () => {
    const names = ['parser', 'cli', 'docs']
    const { value, calls } = await runSwarm(ARGS, impl(names))
    expect(value.status).toBe('complete')
    expect(value.swarm?.name).toBe('md-parser')
    expect(value.swarm?.members.map(m => m.name)).toEqual(['coordinator', 'parser', 'cli', 'docs', 'verify'])
    expect(value.tasks.map(t => [t.id, t.status, t.verified])).toEqual([['parser', 'done', true], ['cli', 'done', true], ['docs', 'done', true]])
    expect(calls.filter(c => c.phase === 'Swarm').map(c => c.label)).toEqual(['@parser (round 1)', '@cli (round 1)', '@docs (round 1)'])
    // One verifier covers up to three workers; one round was enough.
    expect(calls.filter(c => c.phase === 'Verify').map(c => c.label)).toEqual(['@verify (round 1)'])
    expect(value.gates).toHaveLength(1)
    expect(value.gates[0]).toMatchObject({ verdict: 'pass', rounds: 1 })
    expect(value.recorded).toBe(true)
  })

  it('gives every worker a brief with what it owns, must not touch and what done means, and no private channel', async () => {
    const { calls } = await runSwarm(ARGS, impl(['parser', 'cli']))
    const prompt = calls.find(c => c.label === '@parser (round 1)')!.prompt
    expect(prompt).toContain('You are @parser, a WORKER in the swarm "md-parser"')
    expect(prompt).toContain('You own (only you may edit these): src/parser')
    expect(prompt).toContain('You must not touch: package.json')
    expect(prompt).toContain('Done means: parser tests pass')
    expect(prompt).toContain('ONE shared board and no private messages')
    // The assignment and the shared contract are on the board the worker reads.
    expect(prompt).toContain('@coordinator -> @parser (assignment)')
    expect(prompt).toContain('Contract: parse(text) returns Node[]')
    expect(prompt).not.toContain('@coordinator -> @cli (assignment)\n#')
  })

  it('adds one verifier per three workers and keeps each worker with the same verifier', async () => {
    const names = ['a', 'b', 'c', 'd', 'e']
    const { value, calls } = await runSwarm(ARGS, impl(names))
    expect(value.swarm?.members.filter(m => m.kind === 'verifier').map(m => m.name)).toEqual(['verify-1', 'verify-2'])
    const first = calls.find(c => c.label === '@verify-1 (round 1)')!.prompt
    expect(first).toContain('- @a [')
    expect(first).toContain('- @c [')
    expect(first).not.toContain('- @b [')
    expect(value.gates.map(g => g.gate)).toEqual(['Verifier @verify-1 (@a, @c, @e)', 'Verifier @verify-2 (@b, @d)'])
  })

  it('sends a verifier\'s problem back to the worker that wrote the code and wakes only that worker', async () => {
    let reviews = 0
    const { value, calls } = await runSwarm(ARGS, impl(['parser', 'cli'], {
      '@verify': (call) => {
        reviews += 1
        if (reviews > 1) return passAll(call, ['parser', 'cli'])
        return {
          summary: 'cli is broken',
          reviews: [
            { worker: 'parser', verdict: 'pass', checks: [pass], problems: [] },
            { worker: '@cli', verdict: 'problems', checks: [{ name: 'cli --help', outcome: 'fail', detail: 'exit 1' }], problems: [{ severity: 'high', text: 'src/cli/main.ts crashes on empty input' }] },
          ],
          posts: [],
        }
      },
    }))
    expect(calls.filter(c => c.phase === 'Swarm').map(c => c.label)).toEqual(['@parser (round 1)', '@cli (round 1)', '@cli (round 2)'])
    const woken = calls.find(c => c.label === '@cli (round 2)')!.prompt
    expect(woken).toContain('You were woken for round 2')
    expect(woken).toContain('@verify -> @cli (problem): [high] src/cli/main.ts crashes on empty input')
    // The second review covers only the worker that changed.
    expect(calls.find(c => c.label === '@verify (round 2)')!.prompt).not.toContain('- @parser [')
    expect(value.status).toBe('complete')
    expect(value.waves).toBe(2)
    expect(value.gates[0]).toMatchObject({ verdict: 'pass', rounds: 2, fixedIssues: 1 })
    expect(value.gates[0]!.issues).toEqual([{ severity: 'high', title: '@cli: src/cli/main.ts crashes on empty input', status: 'fixed' }])
  })

  it('continues a woken worker\'s own conversation with only what is new, in the shared workspace', async () => {
    let reviews = 0
    const { calls } = await runSwarm(ARGS, impl(['parser', 'cli'], {
      '@verify': (call) => {
        reviews += 1
        return reviews > 1 ? passAll(call, ['parser', 'cli']) : {
          summary: 'cli is broken',
          reviews: [
            { worker: 'parser', verdict: 'pass', checks: [pass], problems: [] },
            { worker: 'cli', verdict: 'problems', checks: [pass], problems: [{ severity: 'high', text: 'crashes on empty input' }] },
          ],
          posts: [],
        }
      },
    }))
    const first = calls.find(c => c.label === '@cli (round 1)')!
    const second = calls.find(c => c.label === '@cli (round 2)')!
    expect(first.session).toBe('worker:cli')
    // Same conversation, and a short prompt: the brief and the plan are already in the worker's history.
    expect(second.session).toBe('worker:cli')
    expect(second.prompt).toContain('You were woken for round 2')
    expect(second.prompt).toContain('@verify -> @cli (problem): [high] crashes on empty input')
    expect(second.prompt).not.toContain('YOUR BRIEF')
    // Only what is new: the original assignment was shown in round 1.
    expect(second.prompt).not.toContain('(assignment)')
  })

  it('starts a woken worker afresh when its conversation cannot be continued, and continues the new one later', async () => {
    let reviews = 0
    const { calls, logs, value } = await runSwarm({ ...ARGS, maxRounds: 3 }, impl(['cli'], {
      '@verify': () => {
        reviews += 1
        return reviews > 2
          ? { summary: 'fixed', reviews: [{ worker: 'cli', verdict: 'pass', checks: [pass], problems: [] }], posts: [] }
          : { summary: 'still broken', reviews: [{ worker: 'cli', verdict: 'problems', checks: [pass], problems: [{ severity: 'medium', text: `problem ${String(reviews)}` }] }], posts: [] }
      },
    }), new Set(['worker:cli']))
    const round2 = calls.filter(c => c.label === '@cli (round 2)')
    // The continuation was refused, so round 2 ran again with the full brief under a new conversation name.
    expect(round2.map(c => c.session)).toEqual(['worker:cli', 'worker:cli:2'])
    expect(round2[1]!.prompt).toContain('YOUR BRIEF')
    expect(logs.some(line => line.includes('could not continue its conversation'))).toBe(true)
    // Round 3 continues the conversation round 2 started.
    expect(calls.find(c => c.label === '@cli (round 3)')!.session).toBe('worker:cli:2')
    expect(value.status).toBe('complete')
  })

  it('starts each round afresh in its own worktree, where a conversation cannot follow it', async () => {
    const { calls } = await runSwarm({ ...ARGS, builderIsolation: 'worktree', maxRounds: 2 }, impl(['parser', 'cli'], {
      Worktree: call => ({ created: true, path: `.hackdev/worktrees/${call.label}`, reason: '' }),
      Merge: () => ({ merged: true, conflicts: [], summary: 'applied' }),
    }))
    expect(calls.filter(c => c.phase === 'Swarm' && c.label.startsWith('@')).every(c => c.session === undefined)).toBe(true)
  })

  it('does not accept a verifier pass without a passing check', async () => {
    const { value } = await runSwarm({ ...ARGS, maxRounds: 1 }, impl(['parser'], {
      '@verify': () => ({ summary: 'looks fine', reviews: [{ worker: 'parser', verdict: 'pass', checks: [], problems: [] }], posts: [] }),
    }))
    expect(value.tasks[0]!.verified).toBe(false)
    expect(value.gates[0]!.verdict).toBe('fail')
    expect(value.status).toBe('needs-attention')
  })

  it('lets the coordinator answer questions on the board before the next round', async () => {
    let turns = 0
    const { calls, value } = await runSwarm(ARGS, impl(['parser', 'cli'], {
      '@parser': () => {
        turns += 1
        return turns === 1
          ? work({ status: 'blocked', evidence: [], filesChanged: [], posts: [{ to: 'coordinator', kind: 'question', text: 'Should tables be supported?' }] })
          : work()
      },
      '@coordinator: answer': () => ({ posts: [{ to: 'parser', kind: 'answer', text: 'Yes, GFM tables.' }] }),
    }))
    const answer = calls.find(c => c.label.startsWith('@coordinator: answer'))!
    expect(answer.prompt).toContain('Should tables be supported?')
    expect(calls.find(c => c.label === '@parser (round 2)')!.prompt).toContain('@coordinator -> @parser (answer): Yes, GFM tables.')
    // An answered question is not asked again.
    expect(calls.filter(c => c.label.startsWith('@coordinator: answer'))).toHaveLength(1)
    expect(value.status).toBe('complete')
  })

  it('stops a swarm that went quiet before finishing and says so on the board', async () => {
    const { value, calls } = await runSwarm({ ...ARGS, maxRounds: 5 }, impl(['parser'], {
      '@parser': () => work({ status: 'partial', filesChanged: [], evidence: [] }),
    }))
    // Round 1, then one more round that changed nothing: the monitor stops it instead of using all five rounds.
    expect(calls.filter(c => c.phase === 'Swarm')).toHaveLength(2)
    expect(value.swarm?.stalled).toBe(true)
    expect(value.swarm?.board.some(p => p.from === 'monitor' && p.text.includes('went quiet'))).toBe(true)
    expect(value.status).toBe('needs-attention')
  })

  it('stops at maxRounds with the open problems reported', async () => {
    const { value, calls } = await runSwarm({ ...ARGS, maxRounds: 2 }, impl(['parser'], {
      '@verify': () => ({ summary: 'still broken', reviews: [{ worker: 'parser', verdict: 'problems', checks: [pass], problems: [{ severity: 'medium', text: 'no tests for nested lists' }] }], posts: [] }),
    }))
    expect(calls.filter(c => c.phase === 'Swarm')).toHaveLength(2)
    expect(value.gates[0]!.issues.filter(i => i.status === 'open')).toHaveLength(1)
    expect(value.status).toBe('needs-attention')
  })

  it('pins the coordinator, the workers and the verifiers to their own models', async () => {
    const { calls, value } = await runSwarm({ ...ARGS, models: { planner: 'big', builder: 'small', verifier: 'strict' } }, impl(['parser']))
    expect(calls.find(c => c.label.startsWith('@coordinator: form'))!.model).toBe('big')
    expect(calls.find(c => c.label === '@parser (round 1)')!.model).toBe('small')
    expect(calls.find(c => c.label === '@verify (round 1)')!.model).toBe('strict')
    expect(calls.find(c => c.label === '@coordinator: final report')!.model).toBe('big')
    expect(value.swarm?.members.map(m => m.model)).toEqual(['big', 'small', 'strict'])
  })

  it('gives each parallel worker its own worktree when isolation is on and merges it back', async () => {
    const { calls } = await runSwarm({ ...ARGS, builderIsolation: 'worktree' }, impl(['parser', 'cli'], {
      Worktree: call => ({ created: true, path: call.label.endsWith('parser') ? '.hackdev/worktrees/w1-parser' : '.hackdev/worktrees/w1-cli', reason: '' }),
      Merge: () => ({ merged: true, conflicts: [], summary: 'applied' }),
    }))
    expect(calls.find(c => c.label === '@parser (round 1)')!.cwd).toBe('.hackdev/worktrees/w1-parser')
    expect(calls.filter(c => c.label.startsWith('Merge: ')).map(c => c.label).sort()).toEqual(['Merge: cli', 'Merge: parser'])
    expect(calls.filter(c => c.label.startsWith('Worktree: ')).every(c => c.phase === 'Swarm')).toBe(true)
  })

  it('runs a worker after the one it depends on and skips it when that one fails', async () => {
    const order: string[] = []
    const { value } = await runSwarm({ ...ARGS, maxRounds: 1 }, (call, n) => {
      if (call.label.startsWith('@coordinator: form')) return swarm([member('model'), member('api', { dependsOn: ['model'] })])
      if (call.label === '@model (round 1)') { order.push('model'); throw new Error('boom') }
      if (call.label === '@api (round 1)') order.push('api')
      return impl(['model', 'api'])(call, n)
    })
    expect(order).toEqual(['model'])
    expect(value.tasks.map(t => t.status)).toEqual(['failed', 'skipped'])
  })

  it('orders two workers that own the same path instead of letting them collide', async () => {
    const { logs } = await runSwarm(ARGS, impl(['a', 'b'], {
      '@coordinator: form': () => swarm([member('a', { owns: ['src/shared'] }), member('b', { owns: ['src/shared/util.ts'] })]),
    }))
    expect(logs.some(line => line.includes('b after a'))).toBe(true)
  })

  it('rejects reserved and invalid worker names, then falls back to one worker', async () => {
    const { value, calls } = await runSwarm(ARGS, impl(['builder'], {
      '@coordinator: form': () => swarm([member('coordinator'), member('verify-1')]),
    }))
    const attempts = calls.filter(c => c.label.startsWith('@coordinator: form'))
    expect(attempts).toHaveLength(3)
    expect(attempts[1]!.prompt).toContain('is reserved')
    expect(value.planFallback).toBe(true)
    expect(value.tasks.map(t => t.id)).toEqual(['builder'])
  })

  it('posts the person\'s notes to every member and writes the board through the chronicler', async () => {
    const { calls, value } = await runSwarm({ ...ARGS, notes: 'Do not add dependencies.' }, impl(['parser']))
    expect(calls.find(c => c.label === '@parser (round 1)')!.prompt).toContain('@user -> @all (decision): Do not add dependencies.')
    expect(calls.find(c => c.label === 'Chronicler')!.prompt).toContain('.hackdev/swarm/BOARD.md')
    expect(value.swarm?.posts).toBeGreaterThan(3)
  })

  it('runs the gates on the merged result when review is on', async () => {
    const gate = { verdict: 'pass', summary: 'ok', checks: [pass], issues: [], filesChanged: [], hasUi: false, uiVerified: false, uiEvidence: [], limitations: [], needsHuman: [], memoryNotes: [] }
    const { value, calls } = await runSwarm({ ...ARGS, review: true }, impl(['parser'], { Gate: () => gate }))
    expect(calls.some(c => c.label.startsWith('Gate 1 Verifier'))).toBe(true)
    expect(value.gates.map(g => g.gate)).toEqual(['Verifier @verify (@parser)', 'Verifier', 'Quality and UX reviewer', 'Security reviewer'])
  })

  it('never exceeds the swarm budget on the worst path', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `w${i}`)
    let turn = 0
    const { calls } = await runSwarm({ ...ARGS, maxRounds: 3, builderIsolation: 'worktree' }, impl(names, {
      '@coordinator: form': (_call, n) => n < 3 ? swarm([member('coordinator')]) : swarm(names.map(name => member(name))),
      '@w': () => { turn += 1; return work({ status: 'partial', filesChanged: [`f${turn}.ts`], posts: [{ to: 'coordinator', kind: 'question', text: `q${turn}` }] }) },
      Worktree: () => ({ created: true, path: '.hackdev/worktrees/x', reason: '' }),
      Merge: () => ({ merged: true, conflicts: [], summary: '' }),
    }))
    expect(calls.length).toBeLessThanOrEqual(swarmBudget(8, 3, true))
  })
})

describe('swarm helpers', () => {
  it('computes the worst-case swarm budget', () => {
    // Three plan attempts + rounds * (workers + answers + verifiers) + final report + chronicler.
    expect(swarmBudget(6, 3, false)).toBe(3 + 3 * (6 + 1 + 2) + 2)
    expect(swarmBudget(6, 3, true)).toBe(3 + 3 * (18 + 1 + 2) + 2)
    expect(swarmBudget(6, 1, false, true, 2)).toBe(3 + (6 + 1 + 2) + 14 + 2)
    expect(swarmBudget(16, 6, true, true, 6) <= ENGINE_AGENT_CEILING).toBe(true)
  })

  it('renders and projects the swarm with its members and the newest board posts', async () => {
    const { value } = await runSwarm(ARGS, impl(['parser', 'cli']))
    const text = renderReport(value, 16_384)
    expect(text).toContain('Hack Dev Code swarm "md-parser": COMPLETE')
    expect(text).toContain('2 worker(s), 1 verifier(s), 1 round(s)')
    expect(text).toContain('Message board (last')
    const meta = compactReport(value) as { swarm: { members: unknown[]; board: { text: string }[]; posts: number } }
    expect(meta.swarm.members).toHaveLength(4)
    expect(meta.swarm.board.length).toBeLessThanOrEqual(60)
    expect(meta.swarm.posts).toBe(value.swarm?.posts)
  })
})
