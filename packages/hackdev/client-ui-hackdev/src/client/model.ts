/**
 * Pure view model for the Hack Dev Code run card. It narrows the bounded
 * `presentationMeta` payload that `tool-hackdev` persists on `tool/result`;
 * anything that does not match a known version renders as plain text instead
 * of a half-trusted card. Version 2 adds waves, task roles, fact-check results,
 * acceptance criteria and gate screenshots; version 3 adds the swarm (its
 * members and message board) and the stalled flag. Older payloads still render
 * with the newer fields at their neutral defaults.
 */

export const PRESENTATION_VERSION = 3

/** Every payload version this card can narrow. */
export const SUPPORTED_VERSIONS: readonly number[] = [1, 2, 3]

/** How a run ended. */
export type RunStatus = 'complete' | 'needs-attention'
/** How one task or swarm worker ended. */
export type TaskStatus = 'done' | 'partial' | 'blocked' | 'failed' | 'skipped'
/** How serious an issue a gate found is. */
export type Severity = 'critical' | 'high' | 'medium' | 'low'
/** Whether an issue was fixed, is still open, or waits for a person's decision. */
export type IssueStatus = 'fixed' | 'open' | 'deferred'
/** The outcome of one check a gate ran. */
export type CheckOutcome = 'pass' | 'fail' | 'skipped'

/** One task (or swarm worker) as the card shows it. */
export interface ViewTask {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  readonly summary: string
  readonly files: number
  readonly evidence: readonly string[]
  readonly evidenceCount: number
  /** Specialist role, or '' when the payload predates roles. */
  readonly role: string
  readonly wave: number
  /** Fact-check outcome; null when not checked. */
  readonly verified: boolean | null
  /** A later-wave follow-up completed this task. */
  readonly replaced: boolean
}

/** One acceptance criterion and whether it was met. */
export interface ViewCriterion {
  readonly criterion: string
  readonly met: boolean
  readonly evidence: string
}

/** One screenshot a gate captured and viewed. */
export interface ViewScreenshot {
  readonly viewport: string
  readonly artifact: string
  readonly observation: string
}

/** One check a gate ran. */
export interface ViewCheck {
  readonly name: string
  readonly outcome: CheckOutcome
  readonly detail: string
}

/** One issue a gate found. */
export interface ViewIssue {
  readonly severity: Severity
  readonly title: string
  readonly status: IssueStatus
}

/** One gate (or swarm verifier) with its verdict and findings. */
export interface ViewGate {
  readonly gate: string
  readonly verdict: 'pass' | 'fail'
  readonly rounds: number
  readonly fixedIssues: number
  readonly summary: string
  readonly checks: readonly ViewCheck[]
  readonly checkCount: number
  readonly issues: readonly ViewIssue[]
  readonly issueCount: number
  readonly hasUi: boolean
  readonly uiVerified: boolean
  readonly screenshots: readonly ViewScreenshot[]
  readonly screenshotCount: number
  readonly limitations: readonly string[]
}

/** What a swarm member does. */
export type MemberKind = 'coordinator' | 'worker' | 'verifier'

/** One swarm member as the card shows it. */
export interface ViewMember {
  readonly name: string
  readonly kind: MemberKind
  readonly role: string
  /** Pinned model, or '' when the member inherited the conversation's model. */
  readonly model: string
  readonly rounds: number
}

/** One post on the swarm's message board. */
export interface ViewPost {
  readonly n: number
  readonly round: number
  readonly from: string
  readonly to: readonly string[]
  readonly kind: string
  readonly text: string
}

/** The swarm of a run: its members and the newest posts of its board. */
export interface ViewSwarm {
  readonly name: string
  readonly rounds: number
  readonly stalled: boolean
  readonly members: readonly ViewMember[]
  /** Posts made over the whole run; the board holds the newest ones. */
  readonly posts: number
  readonly board: readonly ViewPost[]
}

/** Everything the run card shows, narrowed from the persisted payload. */
export interface HackDevView {
  readonly status: RunStatus
  readonly planFallback: boolean
  readonly plan: { readonly summary: string; readonly stack: string }
  readonly waves: number
  readonly tasks: readonly ViewTask[]
  readonly criteria: readonly ViewCriterion[]
  readonly criteriaCount: number
  readonly gates: readonly ViewGate[]
  readonly needsHuman: readonly string[]
  readonly memoryEntries: number
  readonly recorded: boolean
  /** Follow-up waves stopped early because a wave made no progress. */
  readonly stalled: boolean
  /** The swarm of a `hackdev_swarm` run; null for a mission or a review. */
  readonly swarm: ViewSwarm | null
}

/** One item the human should look at, derived from the run. */
export type AttentionItem =
  | { readonly kind: 'task'; readonly id: string; readonly status: TaskStatus; readonly text: string }
  | { readonly kind: 'criterion'; readonly text: string }
  | { readonly kind: 'open'; readonly severity: Severity; readonly text: string; readonly gate: string }
  | { readonly kind: 'deferred'; readonly severity: Severity; readonly text: string; readonly gate: string }
  | { readonly kind: 'human'; readonly text: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function readList<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const out: T[] = []
  for (const item of value) {
    const parsed = read(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

function readStrings(value: unknown): string[] | null {
  return readList(value, item => typeof item === 'string' ? item : null)
}

const TASK_STATUSES = ['done', 'partial', 'blocked', 'failed', 'skipped'] as const
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
const ISSUE_STATUSES = ['fixed', 'open', 'deferred'] as const
const CHECK_OUTCOMES = ['pass', 'fail', 'skipped'] as const
const VERDICTS = ['pass', 'fail'] as const
const RUN_STATUSES = ['complete', 'needs-attention'] as const

/** An optional v2 field: absent means the default, present must have the right type. */
function optional<T>(value: unknown, fallback: T, valid: (v: unknown) => v is T): T | null {
  if (value === undefined) return fallback
  return valid(value) ? value : null
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const isVerified = (v: unknown): v is boolean | null => v === null || typeof v === 'boolean'
const isWave = (v: unknown): v is number => isCount(v) && v >= 1

function readTask(value: unknown): ViewTask | null {
  if (!isRecord(value)) return null
  const evidence = readStrings(value['evidence'])
  const role = optional(value['role'], '', isString)
  const wave = optional(value['wave'], 1, isWave)
  const verified = optional<boolean | null>(value['verified'], null, isVerified)
  const replaced = optional(value['replaced'], false, isBoolean)
  if (typeof value['id'] !== 'string' || typeof value['title'] !== 'string' || typeof value['summary'] !== 'string'
    || !oneOf(value['status'], TASK_STATUSES) || !isCount(value['files']) || !isCount(value['evidenceCount'])
    || evidence === null || role === null || wave === null || replaced === null) return null
  // `optional` returns null both for an explicit null verdict and a malformed one; tell them apart.
  if (verified === null && value['verified'] !== undefined && value['verified'] !== null) return null
  return {
    id: value['id'],
    title: value['title'],
    status: value['status'],
    summary: value['summary'],
    files: value['files'],
    evidence,
    evidenceCount: value['evidenceCount'],
    role,
    wave,
    verified,
    replaced,
  }
}

function readCriterion(value: unknown): ViewCriterion | null {
  if (!isRecord(value) || typeof value['criterion'] !== 'string' || typeof value['met'] !== 'boolean'
    || typeof value['evidence'] !== 'string') return null
  return { criterion: value['criterion'], met: value['met'], evidence: value['evidence'] }
}

function readScreenshot(value: unknown): ViewScreenshot | null {
  if (!isRecord(value) || typeof value['viewport'] !== 'string' || typeof value['artifact'] !== 'string'
    || typeof value['observation'] !== 'string') return null
  return { viewport: value['viewport'], artifact: value['artifact'], observation: value['observation'] }
}

function readCheck(value: unknown): ViewCheck | null {
  if (!isRecord(value) || typeof value['name'] !== 'string' || typeof value['detail'] !== 'string'
    || !oneOf(value['outcome'], CHECK_OUTCOMES)) return null
  return { name: value['name'], outcome: value['outcome'], detail: value['detail'] }
}

function readIssue(value: unknown): ViewIssue | null {
  if (!isRecord(value) || typeof value['title'] !== 'string' || !oneOf(value['severity'], SEVERITIES)
    || !oneOf(value['status'], ISSUE_STATUSES)) return null
  return { severity: value['severity'], title: value['title'], status: value['status'] }
}

function readGate(value: unknown): ViewGate | null {
  if (!isRecord(value)) return null
  const checks = readList(value['checks'], readCheck)
  const issues = readList(value['issues'], readIssue)
  const limitations = readStrings(value['limitations'])
  const screenshots = value['screenshots'] === undefined ? [] : readList(value['screenshots'], readScreenshot)
  const screenshotCount = optional(value['screenshotCount'], screenshots?.length ?? 0, isCount)
  if (screenshots === null || screenshotCount === null) return null
  if (typeof value['gate'] !== 'string' || typeof value['summary'] !== 'string'
    || !oneOf(value['verdict'], VERDICTS)
    || !isCount(value['rounds']) || !isCount(value['fixedIssues'])
    || !isCount(value['checkCount']) || !isCount(value['issueCount'])
    || typeof value['hasUi'] !== 'boolean' || typeof value['uiVerified'] !== 'boolean'
    || checks === null || issues === null || limitations === null) return null
  return {
    gate: value['gate'],
    verdict: value['verdict'],
    rounds: value['rounds'],
    fixedIssues: value['fixedIssues'],
    summary: value['summary'],
    checks,
    checkCount: value['checkCount'],
    issues,
    issueCount: value['issueCount'],
    hasUi: value['hasUi'],
    uiVerified: value['uiVerified'],
    screenshots,
    screenshotCount,
    limitations,
  }
}

const MEMBER_KINDS = ['coordinator', 'worker', 'verifier'] as const

function readMember(value: unknown): ViewMember | null {
  if (!isRecord(value) || typeof value['name'] !== 'string' || !oneOf(value['kind'], MEMBER_KINDS)
    || typeof value['role'] !== 'string' || typeof value['model'] !== 'string' || !isCount(value['rounds'])) return null
  return { name: value['name'], kind: value['kind'], role: value['role'], model: value['model'], rounds: value['rounds'] }
}

function readPost(value: unknown): ViewPost | null {
  if (!isRecord(value)) return null
  const to = readStrings(value['to'])
  if (!isCount(value['n']) || !isCount(value['round']) || typeof value['from'] !== 'string' || to === null
    || typeof value['kind'] !== 'string' || typeof value['text'] !== 'string') return null
  return { n: value['n'], round: value['round'], from: value['from'], to, kind: value['kind'], text: value['text'] }
}

/** The swarm block: absent is null; present must be well formed, else the whole payload is rejected. */
function readSwarm(value: unknown): ViewSwarm | null | undefined {
  if (value === undefined) return null
  if (!isRecord(value)) return undefined
  const members = readList(value['members'], readMember)
  const board = readList(value['board'], readPost)
  if (typeof value['name'] !== 'string' || !isWave(value['rounds']) || typeof value['stalled'] !== 'boolean'
    || !isCount(value['posts']) || members === null || board === null) return undefined
  return { name: value['name'], rounds: value['rounds'], stalled: value['stalled'], members, posts: value['posts'], board }
}

/**
 * Narrow a persisted `tool/result` meta payload to the card's view model.
 * @param meta - the opaque `meta` of the settled tool result.
 * @returns the view model, or null when the payload is absent or not this version's shape.
 */
export function readHackDevMeta(meta: unknown): HackDevView | null {
  if (!isRecord(meta) || typeof meta['v'] !== 'number' || !SUPPORTED_VERSIONS.includes(meta['v'])) return null
  const plan = meta['plan']
  const tasks = readList(meta['tasks'], readTask)
  const gates = readList(meta['gates'], readGate)
  const needsHuman = readStrings(meta['needsHuman'])
  const criteria = meta['criteria'] === undefined ? [] : readList(meta['criteria'], readCriterion)
  const criteriaCount = optional(meta['criteriaCount'], criteria?.length ?? 0, isCount)
  const waves = optional(meta['waves'], 1, isWave)
  const stalled = optional(meta['stalled'], false, isBoolean)
  const swarm = readSwarm(meta['swarm'])
  if (stalled === null || swarm === undefined) return null
  if (!oneOf(meta['status'], RUN_STATUSES) || typeof meta['planFallback'] !== 'boolean'
    || !isRecord(plan) || typeof plan['summary'] !== 'string' || typeof plan['stack'] !== 'string'
    || tasks === null || gates === null || needsHuman === null || criteria === null
    || criteriaCount === null || waves === null
    || !isCount(meta['memoryEntries']) || typeof meta['recorded'] !== 'boolean') return null
  return {
    status: meta['status'],
    planFallback: meta['planFallback'],
    plan: { summary: plan['summary'], stack: plan['stack'] },
    waves,
    tasks,
    criteria,
    criteriaCount,
    gates,
    needsHuman,
    memoryEntries: meta['memoryEntries'],
    recorded: meta['recorded'],
    stalled,
    swarm,
  }
}

/**
 * Items a human should act on, most urgent first: unfinished tasks (a task a
 * later wave replaced is settled), unmet acceptance criteria, open issues,
 * deferred issues, approvals.
 * @param view - the run.
 * @returns the items in that order.
 */
export function attentionItems(view: HackDevView): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const task of view.tasks) {
    if (task.status !== 'done' && !task.replaced) items.push({ kind: 'task', id: task.id, status: task.status, text: task.summary })
  }
  for (const criterion of view.criteria) {
    if (!criterion.met) items.push({ kind: 'criterion', text: criterion.criterion })
  }
  for (const gate of view.gates) {
    for (const issue of gate.issues) {
      if (issue.status === 'open') items.push({ kind: 'open', severity: issue.severity, text: issue.title, gate: gate.gate })
    }
  }
  for (const gate of view.gates) {
    for (const issue of gate.issues) {
      if (issue.status === 'deferred') items.push({ kind: 'deferred', severity: issue.severity, text: issue.title, gate: gate.gate })
    }
  }
  for (const text of view.needsHuman) items.push({ kind: 'human', text })
  return items
}

/**
 * Aggregate counts for the collapsed header.
 * @param view - the run.
 * @returns tasks done, gates passed, criteria met and the number of items to review.
 */
export function headerCounts(view: HackDevView): {
  tasksDone: number
  tasks: number
  gatesPassed: number
  gates: number
  criteriaMet: number
  criteria: number
  attention: number
} {
  return {
    tasksDone: view.tasks.filter(t => t.status === 'done').length,
    tasks: view.tasks.length,
    criteriaMet: view.criteria.filter(c => c.met).length,
    criteria: view.criteria.length,
    gatesPassed: view.gates.filter(g => g.verdict === 'pass').length,
    gates: view.gates.length,
    attention: attentionItems(view).length,
  }
}

/**
 * The mission text from a call's raw argument JSON.
 * @param argsRaw - the call's arguments as streamed.
 * @returns the mission, or null when absent or malformed.
 */
export function missionFromArgs(argsRaw: string | null | undefined): string | null {
  if (argsRaw === null || argsRaw === undefined) return null
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (isRecord(parsed) && typeof parsed['mission'] === 'string' && parsed['mission'].trim() !== '') {
      return parsed['mission'].trim()
    }
  } catch {
    // Streaming or malformed arguments: no mission excerpt.
  }
  return null
}
