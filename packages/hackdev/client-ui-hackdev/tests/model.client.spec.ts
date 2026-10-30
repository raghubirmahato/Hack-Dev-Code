import { describe, expect, it } from 'vitest'
import { compactReport } from '@hackdevcode/dsh-tool-hackdev/src/render.ts'
import type { HackDevReport } from '@hackdevcode/dsh-tool-hackdev/src/render.ts'
import { attentionItems, headerCounts, missionFromArgs, PRESENTATION_VERSION, readHackDevMeta } from '../src/client/model.ts'
import { PRESENTATION_VERSION as PRODUCER_VERSION } from '@hackdevcode/dsh-tool-hackdev/src/render.ts'
import { en } from '../src/client/locales.ts'

const REPORT: HackDevReport = {
  status: 'needs-attention',
  mission: 'Build a notes app',
  planFallback: false,
  plan: { summary: 'Three parallel tasks', stack: 'node', requirements: [], acceptanceCriteria: [] },
  waves: 2,
  tasks: [
    { id: 'api', title: 'API', role: 'backend', wave: 1, verified: true, status: 'done', summary: 'built', filesChanged: ['server.js', 'lib.js'], evidence: ['npm test: pass'], followUps: [], needsHuman: [] },
    { id: 'ui', title: 'UI', role: 'frontend', wave: 1, verified: false, status: 'partial', summary: 'no styles yet', filesChanged: [], evidence: [], followUps: [], needsHuman: [] },
    { id: 'old', title: 'Old', status: 'failed', summary: 'superseded', filesChanged: [], evidence: [], followUps: [], needsHuman: [], replaced: true },
  ],
  criteria: [{ criterion: 'notes persist', met: false, evidence: 'reload loses notes' }, { criterion: 'list renders', met: true, evidence: 'screenshot' }],
  gates: [
    {
      gate: 'Verifier', verdict: 'pass', rounds: 1, fixedIssues: 2, summary: 'ok',
      checks: [{ name: 'npm test', outcome: 'pass', detail: '12 passed' }, { name: 'lint', outcome: 'skipped', detail: '' }],
      issues: [{ severity: 'high', title: 'type error', status: 'fixed' }],
      hasUi: false, uiVerified: false, limitations: [],
    },
    {
      gate: 'Security reviewer', verdict: 'fail', rounds: 3, fixedIssues: 0, summary: 'xss found',
      checks: [{ name: 'audit', outcome: 'fail', detail: 'boom' }],
      issues: [
        { severity: 'high', title: 'stored xss', status: 'open' },
        { severity: 'medium', title: 'add TLS in front', status: 'deferred' },
      ],
      hasUi: true, uiVerified: true, uiEvidence: [{ viewport: '390x844', artifact: '.hackdev/screenshots/m.png', observation: 'fits' }], limitations: ['no browser'],
    },
  ],
  needsHuman: ['approve deploy'],
  memoryEntries: 7,
  recorded: true,
}

describe('readHackDevMeta', () => {
  it('accepts exactly what the host persists (producer/consumer contract)', () => {
    const view = readHackDevMeta(compactReport(REPORT))
    expect(view).not.toBeNull()
    expect(view!.status).toBe('needs-attention')
    expect(PRESENTATION_VERSION).toBe(PRODUCER_VERSION)
    expect(view!.tasks.map(t => [t.id, t.status, t.files, t.evidenceCount])).toEqual([['api', 'done', 2, 1], ['ui', 'partial', 0, 0], ['old', 'failed', 0, 0]])
    expect(view!.tasks.map(t => [t.role, t.wave, t.verified, t.replaced])).toEqual([['backend', 1, true, false], ['frontend', 1, false, false], ['', 1, null, true]])
    expect(view!.waves).toBe(2)
    expect(view!.criteria.map(c => c.met)).toEqual([false, true])
    expect(view!.criteriaCount).toBe(2)
    expect(view!.gates[1]!.screenshots).toEqual([{ viewport: '390x844', artifact: '.hackdev/screenshots/m.png', observation: 'fits' }])
    expect(view!.gates[1]!.screenshotCount).toBe(1)
    expect(view!.gates[1]!.issues.map(i => i.status)).toEqual(['open', 'deferred'])
    expect(view!.memoryEntries).toBe(7)
    expect(view!.recorded).toBe(true)
  })

  it('still reads a version 1 payload from an earlier run with neutral defaults', () => {
    const v1 = compactReport(REPORT) as Record<string, unknown>
    const legacy: Record<string, unknown> = { ...v1, v: 1 }
    delete legacy['waves']
    delete legacy['criteria']
    delete legacy['criteriaCount']
    legacy['tasks'] = (v1['tasks'] as Record<string, unknown>[]).map(({ role: _r, wave: _w, verified: _v, replaced: _x, ...rest }) => rest)
    legacy['gates'] = (v1['gates'] as Record<string, unknown>[]).map(({ screenshots: _s, screenshotCount: _c, ...rest }) => rest)
    const view = readHackDevMeta(legacy)!
    expect(view.waves).toBe(1)
    expect(view.criteria).toEqual([])
    expect(view.tasks[0]).toMatchObject({ role: '', wave: 1, verified: null, replaced: false })
    expect(view.gates[1]!.screenshots).toEqual([])
  })

  it('accepts a gates-only report with no tasks', () => {
    const view = readHackDevMeta(compactReport({ ...REPORT, tasks: [], status: 'complete' }))
    expect(view?.tasks).toEqual([])
  })

  it.each([
    ['null', null],
    ['a string', 'text'],
    ['an array', []],
    ['a missing version', {}],
    ['a future version', { ...compactReport(REPORT) as object, v: 99 }],
  ])('rejects %s', (_name, meta) => {
    expect(readHackDevMeta(meta)).toBeNull()
  })

  it('rejects a payload whose nested entries are malformed instead of half-trusting it', () => {
    const good = compactReport(REPORT) as Record<string, unknown>
    expect(readHackDevMeta({ ...good, status: 'weird' })).toBeNull()
    expect(readHackDevMeta({ ...good, tasks: [{ id: 'x' }] })).toBeNull()
    expect(readHackDevMeta({ ...good, tasks: 'no' })).toBeNull()
    expect(readHackDevMeta({ ...good, gates: [{ gate: 'g' }] })).toBeNull()
    expect(readHackDevMeta({ ...good, needsHuman: [1] })).toBeNull()
    expect(readHackDevMeta({ ...good, memoryEntries: -1 })).toBeNull()
    expect(readHackDevMeta({ ...good, plan: { summary: 1, stack: '' } })).toBeNull()
    expect(readHackDevMeta({ ...good, recorded: 'yes' })).toBeNull()
    expect(readHackDevMeta({ ...good, waves: 0 })).toBeNull()
    expect(readHackDevMeta({ ...good, criteria: [{ criterion: 'x' }] })).toBeNull()
    const tasks = good['tasks'] as Record<string, unknown>[]
    expect(readHackDevMeta({ ...good, tasks: [{ ...tasks[0], verified: 'yes' }] })).toBeNull()
    expect(readHackDevMeta({ ...good, tasks: [{ ...tasks[0], role: 3 }] })).toBeNull()
    const gates = good['gates'] as Record<string, unknown>[]
    expect(readHackDevMeta({ ...good, gates: [{ ...gates[0], screenshots: [{ viewport: 'x' }] }] })).toBeNull()
  })
})

describe('compactReport', () => {
  it('bounds lists and strings while keeping exact counts', () => {
    const big: HackDevReport = {
      ...REPORT,
      tasks: Array.from({ length: 100 }, (_, i) => ({
        id: `t${i}`, title: 'x'.repeat(500), status: 'done' as const, summary: 'y'.repeat(2000),
        filesChanged: Array.from({ length: 9 }, () => 'f'), evidence: Array.from({ length: 20 }, () => 'e'.repeat(900)), followUps: [], needsHuman: [],
      })),
      gates: Array.from({ length: 4 }, (_, g) => ({
        gate: `G${g}`, verdict: 'fail' as const, rounds: 3, fixedIssues: 9, summary: 's'.repeat(2000),
        checks: Array.from({ length: 40 }, () => ({ name: 'n'.repeat(400), outcome: 'fail' as const, detail: 'd'.repeat(900) })),
        issues: Array.from({ length: 60 }, () => ({ severity: 'high' as const, title: 'i'.repeat(900), status: 'open' as const })),
        hasUi: true, uiVerified: true, limitations: Array.from({ length: 20 }, () => 'l'.repeat(900)),
      })),
      needsHuman: Array.from({ length: 50 }, () => 'h'.repeat(900)),
    }
    const view = readHackDevMeta(compactReport(big))!
    expect(view.tasks.length).toBe(40)
    expect(view.tasks[0]!.title.length).toBeLessThanOrEqual(120)
    expect(view.tasks[0]!.evidence.length).toBe(2)
    expect(view.tasks[0]!.evidenceCount).toBe(20)
    expect(view.tasks[0]!.files).toBe(9)
    expect(view.needsHuman.length).toBe(10)
    // Hard ceiling by construction (40 tasks, 4 gates, every field at its limit); real runs are a few KB.
    expect(JSON.stringify(compactReport(big)).length).toBeLessThan(70_000)
  })
})

describe('attentionItems and headerCounts', () => {
  const view = readHackDevMeta(compactReport(REPORT))!

  it('lists unfinished tasks, unmet criteria, open issues, deferred issues and approvals, in that order', () => {
    // The replaced task is settled by its follow-up, so only "ui" is listed.
    expect(attentionItems(view).map(i => i.kind)).toEqual(['task', 'criterion', 'open', 'deferred', 'human'])
    expect(attentionItems(view)[1]).toEqual({ kind: 'criterion', text: 'notes persist' })
  })

  it('is empty for a clean run', () => {
    const clean = readHackDevMeta(compactReport({
      ...REPORT,
      status: 'complete',
      tasks: REPORT.tasks.map(t => ({ ...t, status: 'done' as const })),
      gates: REPORT.gates.map(g => ({ ...g, verdict: 'pass' as const, issues: g.issues.map(i => ({ ...i, status: 'fixed' as const })) })),
      criteria: REPORT.criteria!.map(c => ({ ...c, met: true })),
      needsHuman: [],
    }))!
    expect(attentionItems(clean)).toEqual([])
  })

  it('counts tasks, gates and attention items', () => {
    expect(headerCounts(view)).toEqual({ tasksDone: 1, tasks: 3, gatesPassed: 1, gates: 2, criteriaMet: 1, criteria: 2, attention: 5 })
  })
})

describe('missionFromArgs', () => {
  it('reads the mission and tolerates streaming or malformed arguments', () => {
    expect(missionFromArgs('{"mission":"  Build it  "}')).toBe('Build it')
    expect(missionFromArgs('{"mission":"   "}')).toBeNull()
    expect(missionFromArgs('{"mission":')).toBeNull()
    expect(missionFromArgs('[]')).toBeNull()
    expect(missionFromArgs(null)).toBeNull()
    expect(missionFromArgs(undefined)).toBeNull()
  })
})

describe('dictionaries', () => {
  const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).sort()

  it('keep every English string non-empty with simple named placeholders', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('')
      expect(text.replace(/\{\w+\}/g, ''), key).not.toMatch(/[{}]/)
      expect(placeholders(text).every(name => /^[a-z]+$/i.test(name)), key).toBe(true)
    }
  })
})
