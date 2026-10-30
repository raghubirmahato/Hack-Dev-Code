/** Parent-facing markdown rendering and bounded Web presentation payload of a Hack Dev Code run report. */

import type { JsonValue } from '@hackdevcode/dsh-util-values'

export interface HackDevTask {
  id: string
  title: string
  status: 'done' | 'partial' | 'blocked' | 'failed' | 'skipped'
  summary: string
  filesChanged: string[]
  evidence: string[]
  followUps: string[]
  needsHuman: string[]
  /** Specialist role the planner assigned. */
  role?: string
  /** Wave the task ran in (1 for the initial plan). */
  wave?: number
  /** Fact-check outcome: true verified, false failed, null/absent not checked. */
  verified?: boolean | null
  /** A later-wave follow-up task completed this unfinished task. */
  replaced?: boolean
  /** Number of subtasks the task was re-split into after it did not finish. */
  subtasks?: number
}

export interface HackDevUiEvidence {
  viewport: string
  artifact: string
  observation: string
}

export interface HackDevGate {
  gate: string
  verdict: 'pass' | 'fail'
  rounds: number
  fixedIssues: number
  summary: string
  checks: { name: string; outcome: 'pass' | 'fail' | 'skipped'; detail: string }[]
  issues: { severity: 'critical' | 'high' | 'medium' | 'low'; title: string; status: 'fixed' | 'open' | 'deferred' }[]
  hasUi: boolean
  uiVerified: boolean
  /** Screenshots the gate captured and actually viewed. */
  uiEvidence?: HackDevUiEvidence[]
  limitations: string[]
}

export interface HackDevCriterion {
  criterion: string
  met: boolean
  evidence: string
}

export interface HackDevReport {
  status: 'complete' | 'needs-attention'
  mission: string
  planFallback: boolean
  plan: { summary: string; stack: string; requirements: string[]; acceptanceCriteria: string[]; complexity?: string }
  /** Number of build waves the run used. */
  waves?: number
  tasks: HackDevTask[]
  /** Acceptance criteria as judged by the integrator. */
  criteria?: HackDevCriterion[]
  gates: HackDevGate[]
  needsHuman: string[]
  memoryEntries: number
  recorded?: boolean
}

const TRUNCATION_NOTICE = '\n… [truncated]'

/** Bound complete parent-facing text, including its truncation marker. */
export function boundText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= TRUNCATION_NOTICE.length) return TRUNCATION_NOTICE.slice(0, maxChars)
  return `${text.slice(0, maxChars - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
}

const MARK = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIP' } as const

/** Whether an unfinished task still needs a human: a later follow-up that replaced it settles it. */
function isUnfinished(task: HackDevTask): boolean {
  return task.status !== 'done' && task.replaced !== true
}

function taskLine(t: HackDevTask): string {
  const tags = [
    t.status,
    t.role,
    t.wave !== undefined && t.wave > 1 ? `wave ${t.wave}` : undefined,
    t.verified === true ? 'fact-checked' : t.verified === false ? 'fact-check FAILED' : undefined,
    t.subtasks !== undefined ? `split into ${t.subtasks}` : undefined,
    t.replaced === true ? 'replaced by a follow-up' : undefined,
  ].filter((tag): tag is string => tag !== undefined)
  return `- ${t.id} [${tags.join(', ')}] ${t.title} — ${t.evidence.length} evidence item(s), ${t.filesChanged.length} file(s)`
}

/** Render the report; open issues, unmet criteria and human-approval items come first so truncation never hides them. */
export function renderReport(report: HackDevReport, maxChars: number): string {
  const lines: string[] = []
  lines.push(`Hack Dev Code run: ${report.status === 'complete' ? 'COMPLETE' : 'NEEDS ATTENTION'}`)
  const open = report.gates.flatMap(g => g.issues.filter(i => i.status === 'open').map(i => `[${i.severity}] ${i.title} (${g.gate})`))
  const deferred = report.gates.flatMap(g => g.issues.filter(i => i.status === 'deferred').map(i => `[${i.severity}] ${i.title} (${g.gate})`))
  const unfinished = report.tasks.filter(isUnfinished)
  const unmet = (report.criteria ?? []).filter(c => !c.met)
  if (open.length > 0 || deferred.length > 0 || unfinished.length > 0 || unmet.length > 0 || report.needsHuman.length > 0) {
    lines.push('', 'Needs attention:')
    for (const t of unfinished) lines.push(`- task ${t.id} is ${t.status}: ${t.summary}`)
    for (const c of unmet) lines.push(`- unmet acceptance criterion: ${c.criterion}${c.evidence === '' ? '' : ` (${c.evidence})`}`)
    for (const o of open) lines.push(`- open issue ${o}`)
    for (const d of deferred) lines.push(`- deferred for human decision ${d}`)
    for (const h of report.needsHuman) lines.push(`- needs human approval: ${h}`)
  }
  const complexity = report.plan.complexity === undefined ? '' : ` [${report.plan.complexity}]`
  lines.push('', `Plan${complexity}: ${report.plan.summary}${report.planFallback ? ' (planner fell back to a single task)' : ''}`)
  if (report.plan.stack !== '') lines.push(`Stack: ${report.plan.stack}`)
  if (report.waves !== undefined && report.waves > 1) lines.push(`Waves: ${report.waves} (follow-up waves closed unmet acceptance criteria)`)
  if (report.tasks.length > 0) {
    lines.push('', `Tasks (${report.tasks.filter(t => t.status === 'done').length}/${report.tasks.length} done):`)
    for (const t of report.tasks) lines.push(taskLine(t))
  }
  const criteria = report.criteria ?? []
  if (criteria.length > 0) {
    lines.push('', `Acceptance criteria (${criteria.filter(c => c.met).length}/${criteria.length} met):`)
    for (const c of criteria) lines.push(`- ${c.met ? 'MET' : 'UNMET'} ${c.criterion}`)
  }
  lines.push('', 'Gates:')
  for (const g of report.gates) {
    const passed = g.checks.filter(c => c.outcome === 'pass').length
    lines.push(`- ${g.gate}: ${g.verdict.toUpperCase()} after ${g.rounds} round(s); ${g.fixedIssues} issue(s) fixed; ${passed}/${g.checks.length} checks passed`)
    lines.push(`  ${g.summary}`)
    for (const c of g.checks.slice(0, 8)) lines.push(`  ${MARK[c.outcome]} ${c.name}`)
    if (g.hasUi) {
      const shots = g.uiEvidence ?? []
      lines.push(`  UI ${g.uiVerified ? `was exercised visually (${shots.length} screenshot(s) viewed)` : 'was NOT visually exercised'}`)
      for (const s of shots.slice(0, 4)) lines.push(`  screenshot ${s.viewport} ${s.artifact}: ${s.observation}`)
    }
    for (const l of g.limitations) lines.push(`  limitation: ${l}`)
  }
  lines.push('', `Shared memory entries: ${report.memoryEntries}. Run record ${report.recorded === true ? 'written to' : 'could NOT be written to'} .hackdev/RUN_REPORT.md, .hackdev/PROGRESS.md and .hackdev/MEMORY.md.`)
  return boundText(lines.join('\n'), maxChars)
}

/** Version of the persisted presentation payload the Web card narrows. */
export const PRESENTATION_VERSION = 2

function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function clipList(items: readonly string[], count: number, max: number): string[] {
  return items.slice(0, count).map(item => clipText(item, max))
}

/**
 * Project a report into the bounded JSON persisted with the tool result for
 * Web presenters. Counts stay exact while lists and strings are clipped, so one
 * large run cannot bloat the session log.
 */
export function compactReport(report: HackDevReport): JsonValue {
  const criteria = report.criteria ?? []
  return {
    v: PRESENTATION_VERSION,
    status: report.status,
    planFallback: report.planFallback,
    plan: { summary: clipText(report.plan.summary, 400), stack: clipText(report.plan.stack, 200) },
    waves: report.waves ?? 1,
    tasks: report.tasks.slice(0, 40).map(t => ({
      id: clipText(t.id, 40),
      title: clipText(t.title, 120),
      status: t.status,
      summary: clipText(t.summary, 240),
      files: t.filesChanged.length,
      evidence: clipList(t.evidence, 2, 160),
      evidenceCount: t.evidence.length,
      role: clipText(t.role ?? '', 24),
      wave: t.wave ?? 1,
      verified: t.verified ?? null,
      replaced: t.replaced === true,
    })),
    criteria: criteria.slice(0, 20).map(c => ({ criterion: clipText(c.criterion, 200), met: c.met, evidence: clipText(c.evidence, 160) })),
    criteriaCount: criteria.length,
    gates: report.gates.slice(0, 4).map(g => ({
      gate: clipText(g.gate, 80),
      verdict: g.verdict,
      rounds: g.rounds,
      fixedIssues: g.fixedIssues,
      summary: clipText(g.summary, 400),
      checks: g.checks.slice(0, 12).map(c => ({ name: clipText(c.name, 100), outcome: c.outcome, detail: clipText(c.detail, 120) })),
      checkCount: g.checks.length,
      issues: g.issues.slice(0, 16).map(i => ({ severity: i.severity, title: clipText(i.title, 180), status: i.status })),
      issueCount: g.issues.length,
      hasUi: g.hasUi,
      uiVerified: g.uiVerified,
      screenshots: (g.uiEvidence ?? []).slice(0, 4).map(s => ({
        viewport: clipText(s.viewport, 40),
        artifact: clipText(s.artifact, 160),
        observation: clipText(s.observation, 200),
      })),
      screenshotCount: (g.uiEvidence ?? []).length,
      limitations: clipList(g.limitations, 4, 180),
    })),
    needsHuman: clipList(report.needsHuman, 10, 200),
    memoryEntries: report.memoryEntries,
    recorded: report.recorded === true,
  }
}
