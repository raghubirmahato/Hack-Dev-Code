import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HACKDEV_REVIEW_SCRIPT, HACKDEV_SCRIPT } from '../src/script.ts'
import { agentBudget, DELEGATION_REFUSAL, ENGINE_AGENT_CEILING, isNotesPath, namedToolNote, READ_ONLY_REFUSAL, READ_ONLY_ROLE, readOnlyRefusal, readReport, resolveCap } from '../src/index.ts'
import { boundText, compactReport, PRESENTATION_VERSION, renderReport } from '../src/render.ts'
import type { HackDevReport } from '../src/render.ts'

interface AgentCall {
  prompt: string
  label: string
  phase?: string | undefined
  schema?: unknown
  model?: string | undefined
  cwd?: string | undefined
}
type AgentImpl = (call: AgentCall, n: number) => unknown

interface RunGate {
  gate: string
  verdict: string
  rounds: number
  fixedIssues: number
  issues: { status: string; title: string }[]
  uiVerified: boolean
  uiEvidence: { artifact: string }[]
  limitations: string[]
}
interface RunTask {
  id: string
  status: string
  role?: string
  wave?: number
  verified?: boolean | null
  replaced?: boolean
  subtasks?: number
  summary: string
}
interface RunReport {
  status: string
  planFallback: boolean
  recorded: boolean
  needsHuman: string[]
  waves: number
  tasks: RunTask[]
  criteria: { criterion: string; met: boolean }[]
  gates: RunGate[]
}

/** Execute a guest script with the same hook surface the workflow engine provides. */
async function runScript(
  script: string,
  args: Record<string, unknown>,
  impl: AgentImpl,
): Promise<{ value: RunReport; calls: AgentCall[] }> {
  const calls: AgentCall[] = []
  const hooks = {
    args,
    phase: () => {},
    log: () => {},
    agent: async (prompt: string, opts: { label?: string; phase?: string; schema?: unknown; model?: string; cwd?: string } = {}) => {
      const call: AgentCall = { prompt, label: opts.label ?? '', phase: opts.phase, schema: opts.schema, model: opts.model, cwd: opts.cwd }
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
  const context = vm.createContext(hooks)
  const value: unknown = await vm.runInContext(`(async () => {\n${script}\n})()`, context)
  // Materialize to plain data like the engine does.
  return { value: JSON.parse(JSON.stringify(value)) as RunReport, calls }
}

const ARGS = { mission: 'Build a todo app', maxTasks: 8, maxFixRounds: 2, maxMemoryChars: 6000, maxParallel: 4, maxWaves: 2, visionModel: '', focus: '' }

const passCheck = { name: 'npm test', outcome: 'pass', detail: '12 passed' }
function gate(over: Record<string, unknown> = {}) {
  return {
    verdict: 'pass', summary: 'all good', checks: [passCheck], issues: [], filesChanged: [],
    hasUi: false, uiVerified: false, uiEvidence: [], limitations: [], needsHuman: [], memoryNotes: [], ...over,
  }
}
function task(id: string, dependsOn: string[] = [], role = 'fullstack') {
  return { id, title: `Task ${id}`, role, description: `do ${id}`, dependsOn, ownedPaths: [`src/${id}`], acceptance: `${id} works` }
}
function plan(tasks: unknown[], over: Record<string, unknown> = {}) {
  return { summary: 'A plan', complexity: 'small', requirements: ['r1'], acceptanceCriteria: ['c1'], stack: 'node', contracts: ['GET /todos returns Todo[]'], tasks, ...over }
}
function worker(over: Record<string, unknown> = {}) {
  return { status: 'done', summary: 'built', filesChanged: ['a.ts'], evidence: ['ran tests: pass'], handoff: '', memoryNotes: [], followUps: [], needsHuman: [], ...over }
}
const PROJECT_MAP = {
  summary: 'Empty workspace', stack: 'node 22', hasUi: true, entryPoints: ['index.html'], commands: ['npm test'],
  conventions: ['ESM'], keyFiles: ['package.json'], risks: [], priorProgress: 'none',
}
function integrator(over: Record<string, unknown> = {}) {
  return { summary: 'all met', criteria: [{ criterion: 'c1', met: true, evidence: 'npm test: 12 passed' }], followUpTasks: [], ...over }
}

/** Default behaviour for each agent role; individual tests override what they need (first matching prefix wins). */
function defaultImpl(overrides: Partial<Record<string, (call: AgentCall, n: number) => unknown>> = {}, tasks: unknown[] = [task('a'), task('b', ['a']), task('c')]): AgentImpl {
  return (call, n) => {
    for (const [prefix, fn] of Object.entries(overrides)) {
      if (call.label.startsWith(prefix) && fn !== undefined) return fn(call, n)
    }
    if (call.label.startsWith('Council: requirements')) return 'requirements text'
    if (call.label.startsWith('Council: codebase')) return PROJECT_MAP
    if (call.label.startsWith('Council: planner')) return plan(tasks)
    if (call.label.startsWith('Builder')) return worker()
    if (call.label.startsWith('Fact-checker')) return { tasks: [], commandsRun: [] }
    if (call.label.startsWith('Gate')) return gate()
    if (call.label.startsWith('Integrator')) return integrator()
    if (call.label === 'Chronicler') return 'recorded.'
    throw new Error(`unexpected agent ${call.label}`)
  }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('HACKDEV_SCRIPT', () => {
  it('plans, builds the dependency graph in parallel, fact-checks, gates, integrates and records the run', async () => {
    const order: string[] = []
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      Builder: async (call) => {
        const id = call.label.split(': ')[1]!
        order.push(`start:${id}`)
        await delay(id === 'a' ? 30 : 1)
        order.push(`end:${id}`)
        return worker()
      },
    }))
    expect(value.status).toBe('complete')
    expect(value.tasks.map(t => t.status)).toEqual(['done', 'done', 'done'])
    // a and c are independent so both start before a ends; b waits for a.
    expect(order.indexOf('start:c')).toBeLessThan(order.indexOf('end:a'))
    expect(order.indexOf('start:b')).toBeGreaterThan(order.indexOf('end:a'))
    expect(value.gates.map(g => g.gate)).toEqual(['Verifier', 'Quality and UX reviewer', 'Security reviewer'])
    expect(value.waves).toBe(1)
    expect(value.criteria).toEqual([{ criterion: 'c1', met: true, evidence: 'npm test: 12 passed' }])
    expect(value.recorded).toBe(true)
    expect(calls.filter(c => c.label.startsWith('Council')).length).toBe(3)
    expect(calls.some(c => c.label.startsWith('Fact-checker'))).toBe(true)
    expect(calls.some(c => c.label.startsWith('Integrator'))).toBe(true)
    expect(calls.at(-1)!.label).toBe('Chronicler')
  })

  it('sizes a specialist team: the planner gets sizing rules and builders get their role focus', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({}, [task('ui', [], 'frontend'), task('api', [], 'backend'), task('readme', [], 'not-a-role')]))
    const planner = calls.find(c => c.label.startsWith('Council: planner'))!
    expect(planner.prompt).toContain('Size the team to the mission')
    expect(planner.prompt).toContain('up to 4 at a time')
    expect(calls.find(c => c.label === 'Builder: ui')!.prompt).toContain('senior FRONTEND engineer')
    expect(calls.find(c => c.label === 'Builder: api')!.prompt).toContain('senior BACKEND engineer')
    // An unknown role falls back to full-stack instead of failing the plan.
    expect(value.tasks.find(t => t.id === 'readme')!.role).toBe('fullstack')
  })

  it('accepts the dependency shorthand weaker models write instead of rejecting the plan', async () => {
    const loose = [
      { ...task('logic'), dependsOn: ['-'] },
      { title: 'Write the tests', role: 'test', dependsOn: ['Task logic', 'none', ''], ownedPaths: [] },
    ]
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({}, loose))
    expect(calls.filter(c => c.label.startsWith('Council: planner'))).toHaveLength(1)
    expect(value.tasks.map(t => t.id).sort()).toEqual(['logic', 'write-the-tests'])
    // The tests task waits for the task its title named, so its builder starts after that one.
    const labels = calls.map(c => c.label)
    expect(labels.indexOf('Builder: write-the-tests')).toBeGreaterThan(labels.indexOf('Builder: logic'))
  })

  it('never runs more builders at once than maxParallel', async () => {
    let active = 0
    let peak = 0
    const many = Array.from({ length: 6 }, (_, i) => task(`t${i}`))
    await runScript(HACKDEV_SCRIPT, { ...ARGS, maxParallel: 2 }, defaultImpl({
      Builder: async () => {
        active += 1
        peak = Math.max(peak, active)
        await delay(5)
        active -= 1
        return worker()
      },
    }, many))
    expect(peak).toBe(2)
  })

  it('injects the scout project map into every agent and resumes from prior progress', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Council: codebase': () => ({ ...PROJECT_MAP, commands: ['npm run verify-all'], priorProgress: 'tasks a and b done; c remains' }),
    }))
    expect(calls.find(c => c.label.startsWith('Council: codebase'))!.schema).toBeDefined()
    expect(calls.find(c => c.label.startsWith('Council: planner'))!.prompt).toContain('tasks a and b done; c remains')
    for (const c of calls.filter(x => x.label.startsWith('Builder') || x.label.startsWith('Gate'))) {
      expect(c.prompt).toContain('npm run verify-all')
    }
  })

  it('shares memory: contracts are pinned, duplicates dropped, and notes reach later builders and the gates', async () => {
    const note = { kind: 'contract', text: 'API returns {id,title}' }
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: a': () => worker({ memoryNotes: [note, note] }),
      'Builder: c': () => worker({ memoryNotes: [note] }),
    }))
    const b = calls.find(c => c.label === 'Builder: b')!
    expect(b.prompt).toContain('[contract] (a) API returns {id,title}')
    expect(b.prompt.split('API returns {id,title}').length - 1).toBe(1)
    expect(b.prompt).toContain('GET /todos returns Todo[]')
    expect(calls.find(c => c.label.startsWith('Gate 1'))!.prompt).toContain('API returns {id,title}')
    expect(b.prompt).toContain('.hackdev/MEMORY.md')
  })

  it('gives the custom instructions to every builder and gate prompt', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, customInstructions: 'Use tabs and never add dependencies.' }, defaultImpl())
    const builder = calls.find(c => c.label === 'Builder: a')!
    expect(builder.prompt).toContain('How you work on this mission.')
    expect(builder.prompt).toContain('<how_you_work>')
    expect(builder.prompt).toContain('Use tabs and never add dependencies.')
    expect(calls.find(c => c.label.startsWith('Gate 1'))!.prompt).toContain('Use tabs and never add dependencies.')
  })

  it('lets the fact-check sample size be configured and defaults to eight commands', async () => {
    const wide = await runScript(HACKDEV_SCRIPT, { ...ARGS, maxFactChecks: 20 }, defaultImpl())
    expect(wide.calls.find(c => c.label.startsWith('Fact-checker'))!.prompt).toContain('at most 20 commands')
    const normal = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl())
    expect(normal.calls.find(c => c.label.startsWith('Fact-checker'))!.prompt).toContain('at most 8 commands')
  })

  it('gives each builder its own worktree when isolation is on and merges every task back one at a time', async () => {
    const order: string[] = []
    let merging = 0
    const { value, calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, builderIsolation: 'worktree' }, defaultImpl({
      'Worktree: ': (call) => {
        const id = call.label.split(': ')[1]!
        return { created: true, path: `.hackdev/worktrees/w1-${id}`, reason: '' }
      },
      'Merge: ': async (call) => {
        merging += 1
        expect(merging).toBe(1)
        order.push(`merge:${call.label.split(': ')[1]!}`)
        await delay(2)
        merging -= 1
        return { merged: true, conflicts: [], summary: 'merged' }
      },
      Builder: (call) => {
        order.push(`build:${call.label.split(': ')[1]!}`)
        return worker()
      },
    }))
    const builders = calls.filter(c => c.label.startsWith('Builder'))
    expect(builders.map(c => c.cwd).sort()).toEqual(['.hackdev/worktrees/w1-a', '.hackdev/worktrees/w1-b', '.hackdev/worktrees/w1-c'])
    expect(builders.every(c => c.prompt.includes('isolated git worktree'))).toBe(true)
    // b depends on a, so a is merged before b's worktree is even created.
    expect(order.indexOf('merge:a')).toBeLessThan(order.indexOf('build:b'))
    expect(order.filter(entry => entry.startsWith('merge:'))).toHaveLength(3)
    expect(value.tasks.every(t => t.status === 'done')).toBe(true)
  })

  it('falls back to the shared workspace when a worktree cannot be created, and flags a failed merge', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, builderIsolation: 'worktree' }, defaultImpl({
      'Worktree: a': () => ({ created: false, path: '', reason: 'not a git repository' }),
      'Worktree: ': call => ({ created: true, path: `.hackdev/worktrees/w1-${call.label.split(': ')[1]!}`, reason: '' }),
      'Merge: c': () => ({ merged: false, conflicts: ['src/c.ts'], summary: 'patch did not apply' }),
      'Merge: ': () => ({ merged: true, conflicts: [], summary: 'merged' }),
    }))
    expect(calls.find(c => c.label === 'Builder: a')!.cwd).toBeUndefined()
    expect(calls.some(c => c.label === 'Merge: a')).toBe(false)
    const c = value.tasks.find(t => t.id === 'c')!
    expect(c.status).toBe('partial')
    expect(c.summary).toContain('patch did not apply')
  })

  it('keeps every builder in the shared workspace by default', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl())
    expect(calls.some(c => c.label.startsWith('Worktree') || c.label.startsWith('Merge'))).toBe(false)
    expect(calls.filter(c => c.label.startsWith('Builder')).every(c => c.cwd === undefined)).toBe(true)
  })

  it('adds no custom-instruction block when none is set', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl())
    expect(calls.every(c => !c.prompt.includes('User custom instructions'))).toBe(true)
  })

  it('keeps pinned contracts visible even when many facts crowd the board', async () => {
    const facts = Array.from({ length: 60 }, (_, i) => ({ kind: 'fact', text: `fact number ${i} ${'x'.repeat(80)}` }))
    const { calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, maxMemoryChars: 1200 }, defaultImpl({
      'Builder: a': () => worker({ memoryNotes: [{ kind: 'contract', text: 'POST /todos takes {title}' }, ...facts] }),
    }))
    const prompt = calls.find(c => c.label === 'Builder: b')!.prompt
    expect(prompt).toContain('POST /todos takes {title}')
    expect(prompt).toContain('fact number 59')
    expect(prompt).not.toContain('fact number 0 ')
  })

  it('hands a dependency\'s handoff note to its dependents and to the gates, with open questions', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: a': () => worker({ handoff: 'exports createTodo(title) from src/a/model.ts', memoryNotes: [{ kind: 'question', text: 'should titles be unique?' }] }),
    }))
    expect(calls.find(c => c.label === 'Builder: b')!.prompt).toContain('handoff: exports createTodo(title) from src/a/model.ts')
    const gatePrompt = calls.find(c => c.label.startsWith('Gate 1'))!.prompt
    expect(gatePrompt).toContain('exports createTodo(title)')
    expect(gatePrompt).toContain('should titles be unique?')
  })

  it('retries a planner whose graph has a cycle and shows it the reasons', async () => {
    let attempts = 0
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Council: planner': () => {
        attempts += 1
        return attempts === 1 ? plan([task('a', ['b']), task('b', ['a'])]) : plan([task('a'), task('b', ['a'])])
      },
    }))
    expect(attempts).toBe(2)
    expect(calls.filter(c => c.label.startsWith('Council: planner'))[1]!.prompt).toContain('cycle')
    expect(value.planFallback).toBe(false)
    expect(value.tasks.length).toBe(2)
  })

  it('rejects plans with unknown dependencies, duplicate ids and bad ids, then falls back to one task', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Council: planner': (_c, n) => n % 2 === 0
        ? plan([task('a'), task('a'), task('Bad ID'), task('x', ['nope'])])
        : plan([]),
    }))
    expect(value.planFallback).toBe(true)
    expect(value.tasks.map(t => t.id)).toEqual(['mission'])
    const retryPrompt = calls.filter(c => c.label.startsWith('Council: planner'))[1]!.prompt
    expect(retryPrompt).toContain('at least one task')
  })

  it('enforces the task cap', async () => {
    const many = Array.from({ length: 9 }, (_, i) => task(`t${i}`))
    const { value } = await runScript(HACKDEV_SCRIPT, { ...ARGS, maxTasks: 8 }, defaultImpl({ 'Council: planner': () => plan(many) }))
    expect(value.planFallback).toBe(true)
  })

  it('survives a failed advisor and uses a placeholder', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Council: requirements': () => { throw new Error('boom') },
    }))
    expect(value.status).toBe('complete')
    expect(calls.find(c => c.label.startsWith('Council: planner'))!.prompt).toContain('(analyst unavailable)')
  })

  it('re-splits an unfinished task into ordered subtasks and aggregates them', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: a-model': () => worker({ filesChanged: ['src/a/model.ts'], handoff: 'model ready' }),
      'Builder: a-api': () => worker({ filesChanged: ['src/a/api.ts'] }),
      'Builder: a': () => worker({ status: 'partial', summary: 'ran out of room' }),
      'Splitter: a': () => ({ reason: 'too big', subtasks: [task('model'), task('api', ['model'])] }),
    }))
    const order = calls.map(c => c.label).filter(l => l.startsWith('Builder: a') || l.startsWith('Splitter'))
    expect(order).toEqual(['Builder: a', 'Splitter: a', 'Builder: a-model (subtask)', 'Builder: a-api (subtask)'])
    // The second subtask depends on the first, so it receives the first one's handoff.
    expect(calls.find(c => c.label === 'Builder: a-api (subtask)')!.prompt).toContain('model ready')
    const a = value.tasks.find(t => t.id === 'a')!
    expect(a.status).toBe('done')
    expect(a.subtasks).toBe(2)
    expect(value.tasks.find(t => t.id === 'b')!.status).toBe('done')
  })

  it('does not re-split a task blocked on a human decision', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: c': () => worker({ status: 'blocked', needsHuman: ['choose a payment provider'] }),
    }))
    expect(calls.some(c => c.label.startsWith('Splitter: c'))).toBe(false)
    expect(value.tasks.find(t => t.id === 'c')!.status).toBe('blocked')
    expect(value.needsHuman).toContain('choose a payment provider')
  })

  it('falls back to one retry when no split is possible, then fails it and skips dependents', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: a': () => { throw new Error('crash') },
    }))
    expect(calls.map(c => c.label).filter(l => l.includes(': a'))).toEqual(['Builder: a', 'Splitter: a', 'Builder: a (retry)'])
    const byId = Object.fromEntries(value.tasks.map(t => [t.id, t])) as Record<string, RunTask>
    expect(byId.a!.status).toBe('failed')
    expect(byId.b!.status).toBe('skipped')
    expect(byId.c!.status).toBe('done')
    expect(value.status).toBe('needs-attention')
  })

  it('recovers when the first builder attempt crashes but the retry works', async () => {
    let tries = 0
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: c': () => { tries += 1; if (tries === 1) throw new Error('flake'); return worker() },
    }))
    expect(value.status).toBe('complete')
    expect(calls.some(c => c.label === 'Builder: c (retry)')).toBe(true)
  })

  it('downgrades a done task without evidence to partial', async () => {
    const { value } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: c': () => worker({ evidence: [] }),
    }))
    expect(value.tasks.find(t => t.id === 'c')?.status).toBe('partial')
    expect(value.status).toBe('needs-attention')
  })

  it('fact-checks claims: missing files or unreproduced evidence downgrade a done task and warn the gates', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Fact-checker': () => ({
        tasks: [
          { id: 'a', missingFiles: [], evidenceConfirmed: true, note: '' },
          { id: 'b', missingFiles: ['src/b/ghost.ts'], evidenceConfirmed: true, note: '' },
          { id: 'c', missingFiles: [], evidenceConfirmed: false, note: 'npm test fails' },
        ],
        commandsRun: ['npm test'],
      }),
    }))
    const byId = Object.fromEntries(value.tasks.map(t => [t.id, t])) as Record<string, RunTask>
    expect(byId.a!.verified).toBe(true)
    expect(byId.a!.status).toBe('done')
    expect(byId.b!.verified).toBe(false)
    expect(byId.b!.status).toBe('partial')
    expect(byId.b!.summary).toContain('missing src/b/ghost.ts')
    expect(byId.c!.status).toBe('partial')
    expect(byId.c!.summary).toContain('evidence not reproduced')
    expect(value.status).toBe('needs-attention')
    expect(calls.find(c => c.label.startsWith('Gate 1'))!.prompt).toContain('fact-check failed')
    expect(calls.find(c => c.label.startsWith('Fact-checker'))!.prompt).toContain('ran tests: pass')
  })

  it('starts a follow-up wave for unmet criteria and lets it replace the unfinished task', async () => {
    let wave = 0
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: c': () => worker({ status: 'partial', evidence: [] }),
      'Integrator': () => {
        wave += 1
        return wave === 1
          ? integrator({ criteria: [{ criterion: 'c1', met: false, evidence: 'search is missing' }], followUpTasks: [{ ...task('finish-c'), replaces: ['c'] }] })
          : integrator()
      },
    }))
    expect(calls.some(c => c.label === 'Builder: finish-c')).toBe(true)
    expect(calls.filter(c => c.label.startsWith('Integrator')).map(c => c.label)).toEqual(['Integrator (wave 1)', 'Integrator (wave 2)'])
    expect(calls.filter(c => c.label.startsWith('Gate 1 Verifier round 1')).length).toBe(2)
    expect(value.waves).toBe(2)
    const byId = Object.fromEntries(value.tasks.map(t => [t.id, t])) as Record<string, RunTask>
    expect(byId.c!.replaced).toBe(true)
    expect(byId['finish-c']!.wave).toBe(2)
    expect(value.status).toBe('complete')
  })

  it('stops at maxWaves, tells the integrator it is the last wave and reports unmet criteria', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, maxWaves: 1 }, defaultImpl({
      'Integrator': () => integrator({ criteria: [{ criterion: 'c1', met: false, evidence: 'no' }], followUpTasks: [{ ...task('more'), replaces: [] }] }),
    }))
    expect(calls.find(c => c.label.startsWith('Integrator'))!.prompt).toContain('last allowed wave')
    expect(calls.some(c => c.label === 'Builder: more')).toBe(false)
    expect(value.waves).toBe(1)
    expect(value.criteria[0]!.met).toBe(false)
    expect(value.status).toBe('needs-attention')
  })

  it('ignores an invalid follow-up wave', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Integrator': () => integrator({ followUpTasks: [{ ...task('a'), replaces: [] }] }),
    }))
    // "a" is already taken by the first wave.
    expect(calls.filter(c => c.label === 'Builder: a').length).toBe(1)
    expect(value.waves).toBe(1)
  })

  it('runs the quality/UX and security audits in parallel before their serialized fix rounds', async () => {
    const order: string[] = []
    await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Gate 2 Quality+UX audit': async () => { order.push('q:start'); await delay(10); order.push('q:end'); return gate({ verdict: 'fail', checks: [], issues: [{ severity: 'low', title: 'spacing', status: 'open' }] }) },
      'Gate 3 Security audit': async () => { order.push('s:start'); await delay(10); order.push('s:end'); return gate({ verdict: 'fail', checks: [], issues: [{ severity: 'high', title: 'xss', status: 'open' }] }) },
      'Gate 2 Quality+UX round': async () => { order.push('q:fix'); await delay(5); order.push('q:fixed'); return gate() },
      'Gate 3 Security round': async () => { order.push('s:fix'); return gate() },
    }))
    expect(order.indexOf('s:start')).toBeLessThan(order.indexOf('q:end'))
    expect(order.indexOf('s:fix')).toBeGreaterThan(order.indexOf('q:fixed'))
  })

  it('does not accept a gate pass without a passing check or with open issues', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Gate 3': () => gate({ checks: [] }),
      'Gate 2': () => gate({ issues: [{ severity: 'low', title: 'tiny nit', status: 'open' }] }),
    }))
    expect(value.status).toBe('needs-attention')
    const byGate = Object.fromEntries(value.gates.map(g => [g.gate, g])) as Record<string, RunGate>
    expect(byGate['Security reviewer']!.verdict).toBe('fail')
    expect(byGate['Security reviewer']!.rounds).toBe(4) // audit + maxFixRounds + 1 fix rounds
    expect(byGate['Quality and UX reviewer']!.verdict).toBe('fail')
    expect(calls.filter(c => c.label.startsWith('Gate 3')).length).toBe(4)
  })

  it('skips the fix loop when an audit already passes', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl())
    expect(calls.filter(c => c.label.startsWith('Gate 2')).map(c => c.label)).toEqual(['Gate 2 Quality+UX audit'])
    expect(calls.filter(c => c.label.startsWith('Gate 3')).map(c => c.label)).toEqual(['Gate 3 Security audit'])
    // Nothing changed, so no regression pass.
    expect(calls.some(c => c.label.startsWith('Gate 4'))).toBe(false)
  })

  it('feeds open issues back into the next round and stops once the gate passes', async () => {
    let round = 0
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Gate 1': () => {
        round += 1
        return round === 1
          ? gate({ verdict: 'fail', checks: [{ name: 'build', outcome: 'fail', detail: 'tsc error' }], issues: [{ severity: 'high', title: 'type error in api.ts', status: 'open' }] })
          : gate({ issues: [{ severity: 'high', title: 'type error in api.ts', status: 'fixed' }] })
      },
    }))
    const g1 = calls.filter(c => c.label.startsWith('Gate 1'))
    expect(g1.length).toBe(2)
    expect(g1[1]!.prompt).toContain('type error in api.ts')
    expect(value.gates[0]!.verdict).toBe('pass')
    expect(value.gates[0]!.fixedIssues).toBe(1)
    expect(value.status).toBe('complete')
  })

  it('runs a regression verifier when later gates changed code and lets it supersede gate 1', async () => {
    let verifierRuns = 0
    const { value, calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Gate 1': () => { verifierRuns += 1; return gate({ verdict: 'fail', checks: [{ name: 'build', outcome: 'fail', detail: 'x' }], issues: [{ severity: 'high', title: 'stuck', status: 'open' }] }) },
      'Gate 3 Security audit': () => gate({ verdict: 'fail', filesChanged: ['ignored.ts'], issues: [{ severity: 'high', title: 'xss', status: 'open' }] }),
      'Gate 3 Security round': () => gate({ filesChanged: ['server.ts'], issues: [{ severity: 'high', title: 'xss', status: 'fixed' }] }),
      'Gate 4': () => gate(),
    }))
    const regression = calls.find(c => c.label.startsWith('Gate 4'))!
    expect(regression.prompt).toContain('server.ts')
    // An audit is read-only: files it lists are not counted as gate changes.
    expect(regression.prompt).not.toContain('ignored.ts')
    expect(value.gates.length).toBe(4)
    expect(value.gates[3]!.gate).toBe('Regression verifier')
    expect(verifierRuns).toBe(3)
    // The failed first verifier is superseded by the passing regression pass.
    expect(value.status).toBe('complete')
  })

  it('lets a gate pass with deferred issues and tells every gate about scope discipline and grounding', async () => {
    const { value, calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, autonomy: 'bounded' }, defaultImpl({
      'Gate 3': () => gate({ issues: [{ severity: 'medium', title: 'add TLS termination in front of the app', status: 'deferred' }], needsHuman: ['approve TLS proxy'] }),
    }))
    expect(value.gates[2]!.verdict).toBe('pass')
    expect(value.gates[2]!.issues[0]!.status).toBe('deferred')
    expect(value.status).toBe('complete')
    expect(value.needsHuman).toContain('approve TLS proxy')
    for (const c of calls.filter(x => x.label.startsWith('Gate'))) {
      expect(c.prompt).toContain('Scope discipline')
      expect(c.prompt).toContain('Grounding rules')
    }
  })

  it('requires viewed screenshots before counting a UI as visually verified', async () => {
    const shot = { viewport: '390x844', artifact: '.hackdev/screenshots/mobile.png', observation: 'form fits, no overflow' }
    const claimOnly = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({ 'Gate 2': () => gate({ hasUi: true, uiVerified: true, uiEvidence: [] }) }))
    expect(claimOnly.value.gates[1]!.uiVerified).toBe(false)
    expect(claimOnly.value.gates[1]!.limitations.join(' ')).toContain('without any viewed screenshot')
    const withShots = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({ 'Gate 2': () => gate({ hasUi: true, uiVerified: true, uiEvidence: [shot] }) }))
    expect(withShots.value.gates[1]!.uiVerified).toBe(true)
    expect(withShots.value.gates[1]!.uiEvidence[0]!.artifact).toBe('.hackdev/screenshots/mobile.png')
    const qualityPrompt = withShots.calls.find(c => c.label.startsWith('Gate 2'))!.prompt
    expect(qualityPrompt).toContain('VISUAL VERIFICATION protocol')
    expect(qualityPrompt).toContain('read_image')
    expect(qualityPrompt).toContain('--screenshot=')
    expect(withShots.calls.find(c => c.label.startsWith('Gate 3'))!.prompt).not.toContain('VISUAL VERIFICATION protocol')
  })

  it('routes only the visual gate to the configured vision model', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, visionModel: 'deepseek-v4-flash-vision-exp' }, defaultImpl())
    expect(calls.filter(c => c.label.startsWith('Gate 2')).every(c => c.model === 'deepseek-v4-flash-vision-exp')).toBe(true)
    expect(calls.filter(c => !c.label.startsWith('Gate 2')).every(c => c.model === undefined)).toBe(true)
  })

  it('surfaces needsHuman from builders and gates', async () => {
    const { value } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: a': () => worker({ needsHuman: ['approve deploy to prod'] }),
      'Gate 3': () => gate({ needsHuman: ['rotate the leaked API key'] }),
    }))
    expect(value.needsHuman).toEqual(expect.arrayContaining(['approve deploy to prod', 'rotate the leaked API key']))
  })

  it('treats a crashed gate agent as an open high issue, not a pass', async () => {
    const { value } = await runScript(HACKDEV_SCRIPT, { ...ARGS, maxFixRounds: 0 }, defaultImpl({
      'Gate 2': () => { throw new Error('gate crashed') },
    }))
    expect(value.gates[1]!.verdict).toBe('fail')
    expect(value.gates[1]!.issues[0]!.title).toContain('crashed')
    expect(value.status).toBe('needs-attention')
  })

  it('requests structured output from the scout, builders, fact-checker, gates and integrator but not the analyst', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl())
    for (const prefix of ['Council: codebase', 'Builder', 'Fact-checker', 'Gate', 'Integrator']) {
      expect(calls.filter(c => c.label.startsWith(prefix)).every(c => c.schema !== undefined)).toBe(true)
    }
    expect(calls.find(c => c.label.startsWith('Council: requirements'))!.schema).toBeUndefined()
  })

  it('gives every builder and gate full-autonomy rules by default, with secrets still private', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl())
    for (const c of calls.filter(x => x.label.startsWith('Builder') || x.label.startsWith('Gate'))) {
      expect(c.prompt).toContain('You have full authority on this machine')
      expect(c.prompt).toContain('Never print, log, commit or hard-code secrets')
      expect(c.prompt).not.toContain('Never run destructive')
    }
  })

  it('gives every builder and gate the bounded-autonomy and grounding rules', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, autonomy: 'bounded' }, defaultImpl())
    for (const c of calls.filter(x => x.label.startsWith('Builder') || x.label.startsWith('Gate'))) {
      expect(c.prompt).toContain('needsHuman')
      expect(c.prompt).toContain('Never run destructive')
      expect(c.prompt).toContain('Read a file before you edit it')
    }
  })

  it('pins the planner, builders and gates to the model configured for their role', async () => {
    const { calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, visionModel: 'eyes', models: { planner: 'big', builder: 'small', verifier: 'strict' } }, defaultImpl())
    expect(calls.find(c => c.label.startsWith('Council: planner'))!.model).toBe('big')
    expect(calls.find(c => c.label.startsWith('Integrator'))!.model).toBe('big')
    expect(calls.filter(c => c.label.startsWith('Builder')).every(c => c.model === 'small')).toBe(true)
    expect(calls.find(c => c.label.startsWith('Gate 1 Verifier'))!.model).toBe('strict')
    expect(calls.find(c => c.label.startsWith('Fact-checker'))!.model).toBe('strict')
    // The vision model still wins for the visual gate.
    expect(calls.find(c => c.label.startsWith('Gate 2'))!.model).toBe('eyes')
  })

  it('runs tasks that own the same path one after the other instead of side by side', async () => {
    let active = 0
    let peak = 0
    const tasks = [{ ...task('a'), ownedPaths: ['src/shared/'] }, { ...task('b'), ownedPaths: ['./src/shared/util.ts'] }, task('c')]
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      Builder: async (call) => {
        if (call.label === 'Builder: a' || call.label === 'Builder: b') { active += 1; peak = Math.max(peak, active) }
        await new Promise(resolve => setTimeout(resolve, 5))
        if (call.label === 'Builder: a' || call.label === 'Builder: b') active -= 1
        return worker()
      },
    }, tasks))
    expect(peak).toBe(1)
    expect(calls.find(c => c.label === 'Builder: b')!.prompt).toContain('after: a')
  })

  it('gives the planner three attempts', async () => {
    let attempts = 0
    const { value } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Council: planner': () => { attempts += 1; return attempts < 3 ? plan([task('a', ['a'])]) : plan([task('a')]) },
    }))
    expect(attempts).toBe(3)
    expect(value.planFallback).toBe(false)
  })

  it('stops the follow-up waves when a wave makes no progress', async () => {
    let wave = 0
    const { value, calls } = await runScript(HACKDEV_SCRIPT, { ...ARGS, maxWaves: 6 }, defaultImpl({
      Integrator: () => {
        wave += 1
        return integrator({ criteria: [{ criterion: 'c1', met: false, evidence: 'still failing' }], followUpTasks: [{ ...task(`fix-${wave}`), replaces: [] }] })
      },
    }))
    // Wave 1 sets the baseline, wave 2 leaves as much undone: the run stops there instead of using all six waves.
    expect(calls.filter(c => c.label.startsWith('Integrator'))).toHaveLength(2)
    expect((value as unknown as { stalled: boolean }).stalled).toBe(true)
    expect(value.status).toBe('needs-attention')
  })

  it('keeps the earlier gate verdicts when a follow-up wave changed nothing', async () => {
    const { calls, value } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      'Builder: fix': () => { throw new Error('crash') },
      Splitter: () => null,
      Integrator: (_call, n) => n < 12
        ? integrator({ criteria: [{ criterion: 'c1', met: false, evidence: '' }], followUpTasks: [{ ...task('fix'), replaces: [] }] })
        : integrator({ criteria: [{ criterion: 'c1', met: false, evidence: '' }] }),
    }))
    expect(value.waves).toBe(2)
    // The gates ran once, for wave 1; wave 2 finished nothing, so they were not run again.
    expect(calls.filter(c => c.label.startsWith('Gate 1 Verifier'))).toHaveLength(1)
    expect(value.gates).toHaveLength(3)
  })

  it('never exceeds the agent budget on the worst path', async () => {
    let wave = 0
    const budget = agentBudget(ARGS.maxTasks, ARGS.maxFixRounds, true, ARGS.maxWaves)
    const { calls } = await runScript(HACKDEV_SCRIPT, ARGS, defaultImpl({
      Gate: () => gate({ verdict: 'fail', checks: [], filesChanged: ['f.ts'] }),
      Splitter: () => ({ reason: 'r', subtasks: [task('s1'), task('s2'), task('s3'), task('s4'), task('s5')] }),
      Builder: () => worker({ status: 'partial', evidence: [] }),
      'Council: planner': () => plan(Array.from({ length: ARGS.maxTasks }, (_, i) => task(`t${i}`))),
      Integrator: () => {
        wave += 1
        return integrator({ criteria: [{ criterion: 'c1', met: false, evidence: '' }], followUpTasks: Array.from({ length: 12 }, (_, i) => ({ ...task(`w${wave}-${i}`), replaces: [] })) })
      },
    }))
    expect(calls.length).toBeLessThanOrEqual(budget)
  })
})

describe('HACKDEV_REVIEW_SCRIPT', () => {
  it('runs only the gates and the chronicler', async () => {
    const { value, calls } = await runScript(HACKDEV_REVIEW_SCRIPT, { ...ARGS, focus: 'src/server.ts' }, defaultImpl())
    expect(value.status).toBe('complete')
    expect(value.tasks).toEqual([])
    expect(calls.some(c => /^(Council|Builder|Fact-checker|Integrator)/.test(c.label))).toBe(false)
    expect(calls.find(c => c.label.startsWith('Gate 1'))!.prompt).toContain('src/server.ts')
  })

  it('reviews the whole workspace when no focus is given', async () => {
    const { calls } = await runScript(HACKDEV_REVIEW_SCRIPT, ARGS, defaultImpl())
    expect(calls.find(c => c.label.startsWith('Gate 1'))!.prompt).toContain('whole workspace')
  })

  it('stays within its own budget on the worst path', async () => {
    const { calls } = await runScript(HACKDEV_REVIEW_SCRIPT, ARGS, defaultImpl({ Gate: () => gate({ verdict: 'fail', checks: [], filesChanged: ['f.ts'] }) }))
    expect(calls.length).toBeLessThanOrEqual(agentBudget(1, ARGS.maxFixRounds, false))
  })
})

const REPORT: HackDevReport = {
  status: 'needs-attention',
  mission: 'm',
  planFallback: false,
  plan: { summary: 'P', stack: 'node', requirements: [], acceptanceCriteria: [], complexity: 'medium' },
  waves: 2,
  tasks: [
    { id: 'a', title: 'A', role: 'frontend', wave: 1, verified: true, status: 'done', summary: 's', filesChanged: ['x'], evidence: ['e'], followUps: [], needsHuman: [] },
    { id: 'b', title: 'B', role: 'backend', wave: 1, verified: false, status: 'failed', summary: 'boom', filesChanged: [], evidence: [], followUps: [], needsHuman: [] },
    { id: 'c', title: 'C', status: 'partial', summary: 'half', filesChanged: [], evidence: [], followUps: [], needsHuman: [], replaced: true },
  ],
  criteria: [{ criterion: 'search works', met: false, evidence: 'no index' }, { criterion: 'list works', met: true, evidence: 'npm test' }],
  gates: [{
    gate: 'Security reviewer', verdict: 'fail', rounds: 3, fixedIssues: 2, summary: 'sum',
    checks: [{ name: 'npm audit', outcome: 'pass', detail: '' }],
    issues: [{ severity: 'high', title: 'open xss', status: 'open' }],
    hasUi: true, uiVerified: false, limitations: ['no browser'],
  }],
  needsHuman: ['approve deploy'],
  memoryEntries: 4,
  recorded: true,
}

describe('helpers', () => {
  it('renders unmet criteria, open issues and approvals before the detail', () => {
    const text = renderReport(REPORT, 10_000)
    expect(text).toContain('NEEDS ATTENTION')
    expect(text.indexOf('open issue [high] open xss')).toBeLessThan(text.indexOf('Gates:'))
    expect(text.indexOf('unmet acceptance criterion: search works (no index)')).toBeLessThan(text.indexOf('Tasks ('))
    expect(text).toContain('needs human approval: approve deploy')
    expect(text).toContain('task b is failed')
    // A replaced task is settled by its follow-up and is not an attention item.
    expect(text).not.toContain('task c is partial')
    expect(text).toContain('- b [failed, backend, fact-check FAILED]')
    expect(text).toContain('Plan [medium]')
    expect(text).toContain('Waves: 2')
    expect(text).toContain('Acceptance criteria (1/2 met)')
    expect(renderReport({ ...REPORT, gates: [{ ...REPORT.gates[0]!, issues: [{ severity: 'medium', title: 'add TLS', status: 'deferred' }] }] }, 10_000)).toContain('deferred for human decision [medium] add TLS')
    expect(text).toContain('UI was NOT visually exercised')
    expect(text).toContain('limitation: no browser')
    expect(text).toContain('written to')
  })

  it('renders viewed screenshots for a visually verified UI', () => {
    const text = renderReport({ ...REPORT, gates: [{ ...REPORT.gates[0]!, uiVerified: true, uiEvidence: [{ viewport: '1280x800', artifact: 'shots/d.png', observation: 'clean' }] }] }, 10_000)
    expect(text).toContain('UI was exercised visually (1 screenshot(s) viewed)')
    expect(text).toContain('screenshot 1280x800 shots/d.png: clean')
  })

  it('renders a complete run and the unrecorded and fallback notices', () => {
    const text = renderReport({ ...REPORT, status: 'complete', tasks: [], gates: [], criteria: [], needsHuman: [], planFallback: true, recorded: false, plan: { ...REPORT.plan, stack: '' } }, 10_000)
    expect(text).toContain('COMPLETE')
    expect(text).not.toContain('Needs attention')
    expect(text).toContain('fell back')
    expect(text).toContain('could NOT be written')
  })

  it('bounds text with a truncation marker', () => {
    expect(boundText('abc', 10)).toBe('abc')
    expect(boundText('x'.repeat(100), 50).length).toBe(50)
    expect(boundText('x'.repeat(100), 5).length).toBe(5)
    expect(renderReport(REPORT, 120).endsWith('[truncated]')).toBe(true)
  })

  it('projects a v2 presentation payload with waves, roles, fact-check, criteria and screenshots', () => {
    const shot = { viewport: '390x844', artifact: 'a.png', observation: 'o'.repeat(500) }
    const shots = Array.from({ length: 6 }, () => shot)
    const meta = compactReport({ ...REPORT, gates: [{ ...REPORT.gates[0]!, uiEvidence: shots }] }) as Record<string, unknown>
    expect(meta['v']).toBe(PRESENTATION_VERSION)
    expect(PRESENTATION_VERSION).toBe(3)
    expect(meta['waves']).toBe(2)
    expect(meta['criteriaCount']).toBe(2)
    const tasks = meta['tasks'] as Record<string, unknown>[]
    expect(tasks[0]).toMatchObject({ role: 'frontend', wave: 1, verified: true, replaced: false })
    expect(tasks[2]).toMatchObject({ role: '', verified: null, replaced: true })
    const gates = meta['gates'] as Record<string, unknown>[]
    expect(gates[0]!['screenshotCount']).toBe(6)
    expect((gates[0]!['screenshots'] as { observation: string }[]).length).toBe(4)
    expect((gates[0]!['screenshots'] as { observation: string }[])[0]!.observation.length).toBe(200)
    // Reports from before waves/criteria existed still project.
    const old = { ...REPORT, waves: undefined, criteria: undefined } as unknown as HackDevReport
    const legacy = compactReport(old) as Record<string, unknown>
    expect(legacy['waves']).toBe(1)
    expect(legacy['criteria']).toEqual([])
  })

  it('resolves caps against deployment ceilings', () => {
    expect(resolveCap('maxTasks', undefined, 12, 1)).toBe(12)
    expect(resolveCap('maxTasks', 3, 12, 1)).toBe(3)
    expect(resolveCap('maxFixRounds', 0, 2, 0)).toBe(0)
    expect(() => resolveCap('maxTasks', 13, 12, 1)).toThrow('exceeds the deployment ceiling')
    expect(() => resolveCap('maxTasks', 0, 12, 1)).toThrow('at least 1')
    expect(() => resolveCap('maxTasks', 1.5, 12, 1)).toThrow('safe integer')
  })

  it('computes the worst-case agent budget and clamps it to the engine ceiling', () => {
    // Council 5 + wave(6 per task + fact-check + gates 4*3+2 + integrator) + chronicler.
    expect(agentBudget(12, 2, true)).toBe(5 + (72 + 1 + 14 + 1) + 1)
    expect(agentBudget(24, 2, true, 3)).toBe(5 + 160 + 2 * 64 + 1)
    expect(agentBudget(1, 0, false)).toBe(7)
    expect(agentBudget(12, 2, true, 1, true)).toBe(5 + (96 + 1 + 14 + 1) + 1)
    expect(agentBudget(64, 6, true, 10)).toBe(ENGINE_AGENT_CEILING)
  })

  it('validates the terminal report shape', () => {
    expect(readReport(REPORT)).toBe(REPORT)
    expect(() => readReport(null)).toThrow('malformed')
    expect(() => readReport({ ...REPORT, status: 'weird' })).toThrow('malformed')
    expect(() => readReport({ ...REPORT, tasks: 'no' })).toThrow('malformed')
  })
})

describe('namedToolNote', () => {
  it('names the mission tool a message asks for', () => {
    expect(namedToolNote('Use hackdev to build: a todo app')).toContain('`hackdev`')
    expect(namedToolNote('Use a swarm (hackdev_swarm) to build: a game')).toContain('`hackdev_swarm`')
    expect(namedToolNote('Please call the hackdev_review tool on this repo')).toContain('`hackdev_review`')
    expect(namedToolNote('RUN HACKDEV on it')).toContain('`hackdev`')
  })

  it('leaves other messages alone', () => {
    expect(namedToolNote('Fix the bug in textkit.js')).toBeUndefined()
    expect(namedToolNote('use .hackdev/PROGRESS.md as notes')).toBeUndefined()
    expect(namedToolNote('use hackdev/notes.md')).toBeUndefined()
    expect(namedToolNote('what does hackdev do?')).toBeUndefined()
  })
})

describe('read-only roles', () => {
  it('lists the roles that plan, check or report, and none that build or fix', () => {
    for (const label of ['Council: codebase scout', 'Council: planner (attempt 2)', 'Splitter: api', 'Fact-checker (wave 1)', 'Integrator (wave 1)', 'Chronicler', '@coordinator: form the swarm (attempt 1)', '@coordinator: final report', 'Worktree: api']) {
      expect(READ_ONLY_ROLE.test(label)).toBe(true)
    }
    for (const label of ['Builder: api', 'Verifier', 'Gate 1 Verifier round 1', 'Merge: api', '@parser', 'Chronicler 2']) {
      expect(READ_ONLY_ROLE.test(label)).toBe(false)
    }
  })

  it('lets them write only inside a .hackdev directory', () => {
    expect(isNotesPath('.hackdev/PROJECT_MAP.md')).toBe(true)
    expect(isNotesPath(String.raw`C:\work\app\.hackdev\PROGRESS.md`)).toBe(true)
    expect(isNotesPath('textkit.js')).toBe(false)
    expect(isNotesPath('.hackdev/../textkit.js')).toBe(false)
    expect(isNotesPath('src/.hackdevrc')).toBe(false)
  })
})

describe('readOnlyRefusal', () => {
  it('refuses project edits and delegation, and allows notes and everything else', () => {
    expect(readOnlyRefusal('write', { file_path: 'textkit.js', content: '' })).toBe(READ_ONLY_REFUSAL)
    expect(readOnlyRefusal('edit', { file_path: 'src/a.ts' })).toBe(READ_ONLY_REFUSAL)
    expect(readOnlyRefusal('edit', null)).toBe(READ_ONLY_REFUSAL)
    for (const tool of ['workflow', 'subagent', 'subagent_fork']) expect(readOnlyRefusal(tool, {})).toBe(DELEGATION_REFUSAL)
    expect(readOnlyRefusal('write', { file_path: '.hackdev/PROJECT_MAP.md', content: '' })).toBeUndefined()
    for (const tool of ['read', 'glob', 'grep', 'pwsh', 'team_board']) expect(readOnlyRefusal(tool, {})).toBeUndefined()
  })
})
