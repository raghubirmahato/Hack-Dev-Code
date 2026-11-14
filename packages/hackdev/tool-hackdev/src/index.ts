/**
 * Hack Dev Code mission tools. `hackdev` runs a fixed multi-agent pipeline
 * (planning council that sizes a specialist team, waves of parallel builders
 * with a shared blackboard, fact-check, verifier, quality/UX and security gates,
 * and an integrator that turns unmet acceptance criteria into the next wave)
 * over the workflow and subagent seams; `hackdev_swarm` runs a coordinator, named
 * workers and adversarial verifiers that coordinate on one shared message board;
 * `hackdev_review` runs only the gates on the current workspace.
 * @module @hackdevcode/dsh-tool-hackdev
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@hackdevcode/cordis'
import z from '@hackdevcode/schemastery'
import type { JsonValue } from '@hackdevcode/dsh-util-values'
import type { SubagentProvider } from '@hackdevcode/dsh-subagent'
import { delegationDepthOf } from '@hackdevcode/dsh-subagent'
import { defineTool } from '@hackdevcode/dsh-tools'
import type { ToolCallView, ToolResultView } from '@hackdevcode/dsh-tools'
import type { WorkflowResult, WorkflowRun } from '@hackdevcode/dsh-workflow'
import type { Agent } from '@hackdevcode/dsh-agent'
import { createWorkflowRecorder } from '@hackdevcode/dsh-tool-workflow'
import { createUserMessage } from '@hackdevcode/dsh-llm'
import type { ContextFormed } from '@hackdevcode/dsh-llm'
import { MAX_CUSTOM_INSTRUCTIONS_CHARS, parseCustomRules, renderCustomInstructions } from '@hackdevcode/dsh-system-prompt'
import { HACKDEV_META, HACKDEV_REVIEW_META, HACKDEV_REVIEW_SCRIPT, HACKDEV_SCRIPT } from './script.ts'
import { HACKDEV_SWARM_META, HACKDEV_SWARM_SCRIPT } from './swarm.ts'
import { compactReport, renderReport } from './render.ts'
import { describeHost, detectHost } from './host.ts'

import type { HackDevReport } from './render.ts'

/**
 * The script that gives a builder its own git worktree in one command, so the agent that isolates a task runs one
 * `node` command instead of several git steps in whatever shell it has. It ships beside this package's `lib`.
 */
const WORKTREE_HELPER = fileURLToPath(new URL('../bin/hackdev-worktree.mjs', import.meta.url))

/** The host is detected once, when the app starts, and described to every agent. */
const HOST_DESCRIPTION = describeHost(detectHost())

/**
 * The mission tools are offered only to an agent the person talks to. An agent inside a mission or swarm, or any other
 * delegated agent, does its own part directly: starting a mission of its own would run the whole pipeline again.
 */
const MISSION_TOOL_OPTIONS = { when: ({ agent }: { agent: Agent }) => delegationDepthOf(agent) === 0 }

/**
 * Labels of the pipeline roles that plan, check or report: the council, the splitter, the fact-checker, the
 * integrator, the chronicler, the swarm coordinator and the worktree manager (which only runs one command). Builders,
 * gates, verifiers and the merge manager change files and are not listed.
 */
export const READ_ONLY_ROLE = /^(?:Council: |Splitter: |Fact-checker |Integrator |Chronicler$|@coordinator: |Worktree: )/u

/** What a read-only role is told when it tries to edit a project file. */
export const READ_ONLY_REFUSAL = 'Your role does not change the project\'s files: only notes under .hackdev may be '
  + 'written. Finish your own part and report; the builders make the changes.'

/** What a read-only role is told when it tries to hand work to other agents. */
export const DELEGATION_REFUSAL = 'Your role does not start other agents or workflows. Finish your own part and '
  + 'report; the pipeline starts the builders.'

/** Tools that start other agents, through which a read-only role could still have the project changed. */
const DELEGATION_TOOLS = new Set(['workflow', 'subagent', 'subagent_fork'])

/**
 * Why a read-only role may not make a tool call: editing a file outside `.hackdev`, or starting other agents.
 * @param tool - the tool's name.
 * @param args - the call's arguments.
 * @returns the refusal, or `undefined` when the call is allowed.
 */
export function readOnlyRefusal(tool: string, args: unknown): string | undefined {
  if (DELEGATION_TOOLS.has(tool)) return DELEGATION_REFUSAL
  if (tool !== 'write' && tool !== 'edit') return undefined
  const path = (args as { file_path?: unknown } | null)?.file_path
  return typeof path === 'string' && isNotesPath(path) ? undefined : READ_ONLY_REFUSAL
}

/**
 * Whether a path is one of the mission's notes, inside a `.hackdev` directory, without climbing out of it.
 * @param path - the `file_path` a tool call names.
 * @returns whether a read-only role may write it.
 */
export function isNotesPath(path: string): boolean {
  const parts = path.split(/[\\/]+/u)
  return parts.includes('.hackdev') && !parts.includes('..')
}

/** Message source of the note that tells the agent to call the mission tool the person asked for. */
const NAMED_TOOL_SOURCE = 'hackdev-named-tool'

declare module '@hackdevcode/dsh-llm' {
  interface MessageSourceMap {
    'hackdev-named-tool': { kind: 'hackdev-named-tool' } & ContextFormed
  }
}

/** "use hackdev", "call the hackdev_swarm tool", "use a swarm (hackdev_swarm)": a request for one tool by name. */
const NAMED_TOOL = /\b(?:use|call|run|start)\s+(?:the\s+|a\s+swarm\s+\(\s*)?(hackdev(?:_swarm|_review)?)\b(?![./\\-])/iu

/**
 * The note for a message that asks for a mission tool by name. Small local models often do such work themselves
 * instead; the note, placed just before the message, makes the request an instruction to call the tool.
 * @param text - the person's message.
 * @returns the note, or `undefined` when the message names no mission tool.
 */
export function namedToolNote(text: string): string | undefined {
  const tool = NAMED_TOOL.exec(text)?.[1]?.toLowerCase()
  if (tool === undefined) return undefined
  return `The next message asks for the \`${tool}\` tool by name. Your first action is one call to \`${tool}\`, with `
    + 'the request, in the person\'s own words, as the mission. Do not do the work yourself and do not ask first.'
}

export const name = 'tool-hackdev'
export const inject = ['tools', 'workflowEngine', 'subagents', 'systemPrompt']

/** Deployment policy for the fixed Hack Dev Code pipelines. */
export interface Config {
  /** Fresh structured-output provider used for every pipeline agent (default `spawn`). */
  subagentProvider?: string
  /** Deployment ceiling for planned tasks per wave (default 24). */
  maxTasks?: number
  /** Builder agents that may run at the same time (default 6). */
  maxParallel?: number
  /** Deployment ceiling for build waves per mission (default 3). */
  maxWaves?: number
  /** Optional image-capable model for the quality/UX gate; empty inherits the default route (default ''). */
  visionModel?: string
  /** Deployment ceiling for review-fix rounds after the first review of each gate (default 2). */
  maxFixRounds?: number
  /** Maximum characters of shared memory placed in any one agent prompt (default 6000). */
  maxMemoryChars?: number
  /** Maximum characters in the parent-facing report (default 16384). */
  maxResultChars?: number
  /** Commands the fact-checker may re-run per wave (default 8). */
  maxFactChecks?: number
  /**
   * Where parallel builders work: `shared` (one workspace, disjoint owned paths) or `worktree` (each task in its
   * own git worktree, merged back one at a time; falls back to shared outside a git repository). Default `shared`.
   */
  builderIsolation?: 'shared' | 'worktree'
  /**
   * `full` lets the lead agent and every pipeline agent act without asking for approval; `bounded` keeps them
   * from destructive or irreversible actions and defers large additions to a person. Default `full`.
   */
  autonomy?: 'full' | 'bounded'
  /** Standing instructions from the user that every pipeline agent and the lead agent follow (default ''). */
  customInstructions?: string
  /**
   * Model each role runs on; empty inherits the conversation's model. `planner` leads (council, coordinator,
   * integrator), `builder` builds (builders, swarm workers) and `verifier` audits (gates, fact-checker, swarm
   * verifiers), so a strong model can plan and audit while a lighter one builds.
   */
  models?: RoleModels
  /** Deployment ceiling for workers in one swarm (default 8). */
  maxWorkers?: number
  /** Deployment ceiling for swarm rounds: the first build plus the rounds that wake workers again (default 3). */
  maxSwarmRounds?: number
}

/** A model per pipeline role; empty inherits. */
export interface RoleModels {
  /** Model for the council, splitter, integrator and swarm coordinator (default '', which inherits). */
  planner?: string
  /** Model for builders, worktree and merge managers and swarm workers (default '', which inherits). */
  builder?: string
  /** Model for the gates, the fact-checker and swarm verifiers (default '', which inherits). */
  verifier?: string
}

/** Schemastery configuration for the Hack Dev Code tools. */
export const Config: z<Config> = z.object({
  subagentProvider: z.string().default('spawn'),
  maxTasks: z.number().step(1).min(1).max(64).default(24),
  maxParallel: z.number().step(1).min(1).max(32).default(6),
  maxWaves: z.number().step(1).min(1).max(6).default(3),
  visionModel: z.string().default(''),
  maxFixRounds: z.number().step(1).min(0).max(6).default(2),
  maxMemoryChars: z.number().step(1).min(500).max(100_000).default(6000),
  maxResultChars: z.number().step(1).min(1000).max(Number.MAX_SAFE_INTEGER).default(16_384),
  maxFactChecks: z.number().step(1).min(1).max(40).default(8),
  builderIsolation: z.union(['shared', 'worktree'] as const).default('shared'),
  autonomy: z.union(['full', 'bounded'] as const).default('full'),
  customInstructions: z.string().role('textarea').default(''),
  models: z.object({
    planner: z.string().default(''),
    builder: z.string().default(''),
    verifier: z.string().default(''),
  }),
  maxWorkers: z.number().step(1).min(1).max(16).default(8),
  maxSwarmRounds: z.number().step(1).min(1).max(6).default(3),
})

/** Longest custom instruction text accepted, the same cap as the person's global instructions. */
const MAX_CUSTOM_INSTRUCTIONS = MAX_CUSTOM_INSTRUCTIONS_CHARS

/** Longest numbered list repeated inside each mission agent's task prompt. */
const MAX_INLINE_MISSION_INSTRUCTIONS = 6000

/** What a mission prompt says instead of a list too long to repeat in every task. */
const LONG_INSTRUCTIONS_POINTER = 'Every point of the <how_you_work> list in your system prompt holds on this mission, for every message, file, command and report you produce.'

interface ResolvedConfig {
  readonly subagentProvider: string
  readonly maxTasks: number
  readonly maxParallel: number
  readonly maxWaves: number
  readonly visionModel: string
  readonly maxFixRounds: number
  readonly maxMemoryChars: number
  readonly maxResultChars: number
  readonly maxFactChecks: number
  readonly builderIsolation: 'shared' | 'worktree'
  readonly autonomy: 'full' | 'bounded'
  readonly customInstructions: string
  readonly models: Required<RoleModels>
  readonly maxWorkers: number
  readonly maxSwarmRounds: number
}

interface SwarmArgs {
  mission: string
  maxWorkers?: number
  maxRounds?: number
  review?: boolean
  notes?: string
  coordinatorModel?: string
  workerModel?: string
  verifierModel?: string
}

interface MissionArgs {
  mission: string
  maxTasks?: number
  maxFixRounds?: number
  maxWaves?: number
}

interface ReviewArgs {
  mission: string
  focus?: string
  maxFixRounds?: number
}

const POLICY = [
  'Hack Dev Code operating policy.',
  '- For any substantial build, feature, migration or multi-file bug-fix request, call the hackdev tool with the full mission instead of working alone: it sizes a team of specialist agents to the mission, builds in parallel waves with a shared blackboard and project map, fact-checks every claim, then runs three independent gates (syntax/logic/runtime verifier, quality and UI/UX reviewer with screenshots, security reviewer) that fix what they find, and keeps iterating until every acceptance criterion is met or the wave budget is spent. Relay its report faithfully, including unmet criteria, open issues, limitations and items needing human approval.',
  '- When the person asks for a swarm (or types /swarm), or wants a team of agents working in parallel that they can follow on one message board, call hackdev_swarm instead: a coordinator names the workers and briefs each one (what it owns, what it must not touch, what done means), the workers build in parallel and post diffs, tests and questions to the shared board, and adversarial verifiers send problems back to the worker that wrote the code. If the person names a model for the coordinator, the workers or the verifiers, pass it. Relay the coordinator\'s report and the unresolved problems faithfully.',
  '- For small edits you make yourself, finish by calling hackdev_review so the same three gates check the result before you declare it done.',
  '- Never claim software is finished, secure or unhackable on your own say-so: cite gate evidence, and state residual risk honestly.',
].join('\n')

/** Policy line under bounded autonomy: destructive actions wait for the person. */
const BOUNDED_POLICY = '- Never take destructive or irreversible actions (deploys, force-pushes, deletions outside the workspace, secret handling) without the human approving them first.'
/** Policy line under full autonomy: act without asking, keep secrets private. */
const FULL_POLICY = '- You may act on your own without asking for approval: run any command, change any file and use the desktop and browser as the task needs. Keep secrets private and report what you did.'

const MISSION_DESCRIPTION = 'Run the full Hack Dev Code pipeline for one mission: a planning council maps the project and decomposes the mission '
  + 'into a team of specialist tasks sized to its complexity; parallel builder agents execute the dependency graph with a shared blackboard, '
  + 'unfinished tasks are re-split, and a fact-checker re-verifies claimed files and evidence; three gate agents then verify (syntax, logic and '
  + 'runtime errors), review quality and UI/UX visually with screenshots, and audit and harden security, fixing what they find; an integrator '
  + 'checks every acceptance criterion and starts follow-up waves for unmet ones. Writes .hackdev/RUN_REPORT.md, .hackdev/PROGRESS.md, '
  + '.hackdev/PROJECT_MAP.md and long-term .hackdev/MEMORY.md. Use for any substantial build, feature or multi-file fix. '
  + 'The call blocks until the whole pipeline settles and returns an evidence-based report.'

const SWARM_DESCRIPTION = 'Run a swarm for one mission: a coordinator maps the project, names a team of workers and gives each a brief (what it owns, '
  + 'what it must not touch, what done means); the workers build in parallel, each in its own worktree when isolation is on, and coordinate only '
  + 'through one shared message board (assignments, questions, diff summaries, test results); one adversarial verifier per two to four workers '
  + 're-runs the tests, challenges every diff and sends problems back to the worker that wrote the code, which wakes it for another round; the '
  + 'coordinator answers questions between rounds and finally checks every acceptance criterion. Writes .hackdev/swarm/BOARD.md, '
  + '.hackdev/RUN_REPORT.md and .hackdev/PROGRESS.md. Every worker is a full agent, so a swarm uses far more model quota than one conversation: '
  + 'use it for builds that really split into parallel pieces, or when the person asks for a swarm. The call blocks until the swarm settles.'

const REVIEW_DESCRIPTION = 'Run only the three Hack Dev Code gates on the current workspace: a verifier for syntax, logic and runtime errors, '
  + 'a quality and UI/UX reviewer that captures and views screenshots of the interface, and a security reviewer that hardens weaknesses '
  + '(quality and security audit in parallel, then fix one after the other). Each gate fixes '
  + 'what it finds and re-verifies. Use after small edits you made yourself, before declaring the work complete.'

/** Validate defaults even when a caller invokes apply() without Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    subagentProvider: config.subagentProvider ?? 'spawn',
    maxTasks: config.maxTasks ?? 24,
    maxParallel: config.maxParallel ?? 6,
    maxWaves: config.maxWaves ?? 3,
    visionModel: config.visionModel ?? '',
    maxFixRounds: config.maxFixRounds ?? 2,
    maxMemoryChars: config.maxMemoryChars ?? 6000,
    maxResultChars: config.maxResultChars ?? 16_384,
    maxFactChecks: config.maxFactChecks ?? 8,
    builderIsolation: config.builderIsolation ?? 'shared',
    autonomy: config.autonomy ?? 'full',
    customInstructions: (config.customInstructions ?? '').trim().slice(0, MAX_CUSTOM_INSTRUCTIONS),
    models: {
      planner: (config.models?.planner ?? '').trim(),
      builder: (config.models?.builder ?? '').trim(),
      verifier: (config.models?.verifier ?? '').trim(),
    },
    maxWorkers: config.maxWorkers ?? 8,
    maxSwarmRounds: config.maxSwarmRounds ?? 3,
  }
  if (!Number.isSafeInteger(resolved.maxWorkers) || resolved.maxWorkers < 1) {
    throw new TypeError('maxWorkers must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxSwarmRounds) || resolved.maxSwarmRounds < 1) {
    throw new TypeError('maxSwarmRounds must be a positive safe integer')
  }
  if (resolved.subagentProvider.length === 0 || resolved.subagentProvider !== resolved.subagentProvider.trim()) {
    throw new TypeError('subagentProvider must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(resolved.maxTasks) || resolved.maxTasks < 1) {
    throw new TypeError('maxTasks must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxParallel) || resolved.maxParallel < 1) {
    throw new TypeError('maxParallel must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxWaves) || resolved.maxWaves < 1) {
    throw new TypeError('maxWaves must be a positive safe integer')
  }
  if (resolved.visionModel !== resolved.visionModel.trim()) {
    throw new TypeError('visionModel must be a normalized string')
  }
  if (!Number.isSafeInteger(resolved.maxFixRounds) || resolved.maxFixRounds < 0) {
    throw new TypeError('maxFixRounds must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxMemoryChars) || resolved.maxMemoryChars < 1) {
    throw new TypeError('maxMemoryChars must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxResultChars) || resolved.maxResultChars < 1) {
    throw new TypeError('maxResultChars must be a positive safe integer')
  }
  return resolved
}

/**
 * Resolve one model-selected cap against its deployment ceiling.
 * @param label - the cap's name, for the error.
 * @param requested - what the model asked for, if anything.
 * @param ceiling - the deployment's ceiling, used when nothing was asked.
 * @param min - the smallest value accepted.
 * @returns the cap to run with.
 * @throws {TypeError} when the request is not an integer of at least `min` or exceeds the ceiling.
 */
export function resolveCap(label: string, requested: number | undefined, ceiling: number, min: number): number {
  const value = requested ?? ceiling
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${label} must be a safe integer of at least ${min}`)
  }
  if (value > ceiling) {
    throw new TypeError(`${label} ${value} exceeds the deployment ceiling ${ceiling}`)
  }
  return value
}

/** Follow-up waves plan at most this many tasks (mirrors FOLLOW_UP_CAP in the script). */
export const FOLLOW_UP_TASK_CAP = 8

/** Worst-case agents per task: builder, splitter, then up to four subtasks (or one retry). */
export const AGENTS_PER_TASK = 6

/** The engine's default total-agent ceiling; budgets never ask for more. */
export const ENGINE_AGENT_CEILING = 1000

/**
 * Worst-case agent count. Council: analyst, scout, planner and two retries. Gates
 * per wave: verifier and regression with maxFixRounds + 1 rounds each, quality
 * and security with an audit plus maxFixRounds + 1 fix rounds each. Each wave
 * adds a fact-checker and an integrator; follow-up waves plan at most
 * FOLLOW_UP_TASK_CAP tasks. One chronicler at the end.
 * @param maxTasks - tasks the first wave may plan.
 * @param maxFixRounds - extra review-fix rounds per gate.
 * @param withBuild - false for a gate-only review.
 * @param maxWaves - build waves allowed.
 * @param isolated - whether each task gets a worktree and a merge manager.
 * @returns the agent ceiling for the run, at most the engine's own.
 */
export function agentBudget(maxTasks: number, maxFixRounds: number, withBuild: boolean, maxWaves = 1, isolated = false): number {
  const rounds = maxFixRounds + 1
  const gates = 4 * rounds + 2
  const chronicle = 1
  if (!withBuild) return Math.min(ENGINE_AGENT_CEILING, gates + chronicle)
  // An isolated task adds its worktree manager and its merge manager.
  const perTask = AGENTS_PER_TASK + (isolated ? 2 : 0)
  const wave = (tasks: number): number => perTask * tasks + 1 + gates + 1
  const later = Math.min(maxTasks, FOLLOW_UP_TASK_CAP)
  return Math.min(ENGINE_AGENT_CEILING, 5 + wave(maxTasks) + (maxWaves - 1) * wave(later) + chronicle)
}

/** Workers one swarm verifier reviews (mirrors WORKERS_PER_VERIFIER in the swarm script). */
export const WORKERS_PER_VERIFIER = 3

/**
 * Worst-case agent count of a swarm. The coordinator forms the swarm in at most three attempts; every round runs
 * each worker (plus its worktree and merge managers when isolated), one coordinator answer turn and the verifiers;
 * the coordinator's final report and the chronicler close it. `review` adds the gates' worst case.
 * @param maxWorkers - workers the coordinator may add.
 * @param maxRounds - rounds the swarm may run.
 * @param isolated - whether each worker gets a worktree and a merge manager.
 * @param review - whether the three gates run on the merged result.
 * @param maxFixRounds - extra review-fix rounds per gate, used with `review`.
 * @returns the agent ceiling for the run, at most the engine's own.
 */
export function swarmBudget(maxWorkers: number, maxRounds: number, isolated: boolean, review = false, maxFixRounds = 0): number {
  const perRound = maxWorkers * (isolated ? 3 : 1) + 1 + Math.ceil(maxWorkers / WORKERS_PER_VERIFIER)
  const gates = review ? 4 * (maxFixRounds + 1) + 2 : 0
  return Math.min(ENGINE_AGENT_CEILING, 3 + maxRounds * perRound + gates + 1 + 1)
}

/** Require the configured route to mean a genuinely fresh structured child. */
function requireFreshProvider(ctx: Context, providerName: string): SubagentProvider {
  const provider = ctx.subagents.getProvider(providerName)
  if (provider === undefined) {
    throw new Error(`Hack Dev Code subagent provider "${providerName}" is not registered`)
  }
  if (!provider.capabilities.outputSchema) {
    throw new Error(`Hack Dev Code subagent provider "${providerName}" does not support structured output`)
  }
  if (provider.inheritsParentContext) {
    throw new Error(`Hack Dev Code subagent provider "${providerName}" inherits parent context; a fresh provider is required`)
  }
  return provider
}

/** A non-clean workflow finish is an error, never a partial success. */
function stopReasonError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'cancelled':
      return `Hack Dev Code workflow was cancelled${result.error === undefined ? '' : ` (${result.error})`}`
    case 'error':
      return `Hack Dev Code workflow failed: ${result.error ?? 'unknown error'}`
    /* v8 ignore start -- WorkflowStopReason is closed; a future variant must fail loud here. */
    default:
      return `Hack Dev Code workflow ended abnormally (${String(result.stopReason satisfies never)})`
    /* v8 ignore stop */
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Defensively check the fixed script's terminal value before rendering it.
 * @param value - what the script returned.
 * @returns the report.
 * @throws {Error} when the value is not a report.
 */
export function readReport(value: unknown): HackDevReport {
  if (!isRecord(value)
    || (value['status'] !== 'complete' && value['status'] !== 'needs-attention')
    || !Array.isArray(value['tasks'])
    || !Array.isArray(value['gates'])
    || !Array.isArray(value['needsHuman'])
    || !isRecord(value['plan'])) {
    throw new Error('Hack Dev Code workflow returned a malformed report')
  }
  return value as unknown as HackDevReport
}

const OUTPUT_PROPERTIES = {
  runId: { type: 'string', required: true },
  agentsStarted: { type: 'integer', required: true },
  result: { type: 'json', required: true },
} as const

function presentCall(title: string) {
  return (args: { mission: string }): ToolCallView => ({ card: 'generic', title, rawInput: args.mission })
}

function presentResult(): ToolResultView {
  return { card: 'generic' }
}

/** Register the fixed Hack Dev Code tools and their usage policy. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'policy:hackdev',
    order: ctx.systemPrompt.getSectionOrder('HACKDEV_POLICY'),
    text: `${POLICY}\n${resolved.autonomy === 'full' ? FULL_POLICY : BOUNDED_POLICY}`,
  })
  ctx.systemPrompt.section({
    name: 'environment:host',
    order: ctx.systemPrompt.getSectionOrder('HACKDEV_POLICY'),
    interpolate: false,
    text: HOST_DESCRIPTION,
  })
  if (resolved.customInstructions.length > 0) {
    // Its own name: the person's global instructions from Settings already use policy:custom-instructions.
    ctx.systemPrompt.section({
      name: 'policy:mission-custom-instructions',
      order: ctx.systemPrompt.getSectionOrder('CUSTOM_INSTRUCTIONS'),
      interpolate: false,
      text: renderCustomInstructions(resolved.customInstructions, { heading: 'How you work on missions' }),
    })
  }

  /**
   * This tool's own instructions plus the person's global ones from Settings, read afresh for each mission, as the
   * numbered rules every mission prompt repeats so builders and gates can check their work against each one. A list
   * too long to repeat in every task is pointed at in the system prompt, which every mission agent carries.
   */
  const missionInstructions = (): string => {
    const loop = (ctx as unknown as { get(name: string): unknown }).get('agentLoop') as
      { config?: { customInstructions?: { get(): string } } } | undefined
    const global = (loop?.config?.customInstructions?.get() ?? '').trim()
    const text = [resolved.customInstructions, global].filter(part => part.length > 0).join('\n').slice(0, MAX_CUSTOM_INSTRUCTIONS)
    const numbered = parseCustomRules(text).map((rule, index) => `${String(index + 1)}. ${rule}`).join('\n')
    return numbered.length <= MAX_INLINE_MISSION_INSTRUCTIONS ? numbered : LONG_INSTRUCTIONS_POINTER
  }

  // A message from the person that names a mission tool gets a note before it, at the first step of its turn only.
  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1 || signal.aborted || delegationDepthOf(agent) > 0) return decision
    const typed = decision.messages.filter(message => message.source.kind === 'user')
    const text = typed.flatMap(message => message.content.map(block => block.type === 'text' ? block.text : '')).join('\n')
    const note = namedToolNote(text)
    if (note === undefined) return decision
    const at = decision.messages.indexOf(typed[0] as (typeof typed)[number])
    return {
      ...decision,
      messages: [
        ...decision.messages.slice(0, at),
        createUserMessage({ content: [{ type: 'text', text: note }], source: { kind: NAMED_TOOL_SOURCE, form: 'instructions' } }),
        ...decision.messages.slice(at),
      ],
    }
  })

  // Members of this plugin's runs whose role only plans, checks or reports, by run. Their prompts say so, but small
  // models still build the mission from them, so the guard below refuses their edits to the project's files.
  const readOnlyMembers = new Map<string, Set<string>>()
  ctx.on('workflow/agent-start', (info, member) => {
    const members = readOnlyMembers.get(info.id)
    if (members !== undefined && READ_ONLY_ROLE.test(member.label)) members.add(member.childId)
  })
  ctx.tools.guard((exec) => {
    const id = exec.agent?.session.id
    if (id === undefined || ![...readOnlyMembers.values()].some(members => members.has(id))) return undefined
    return readOnlyRefusal(exec.name, exec.arguments)
  })

  // The same durable run records the generic workflow tool writes, so the existing
  // workflow-run chat node shows this pipeline's phases and agents live.
  const recorder = createWorkflowRecorder(ctx)

  async function runPipeline(
    exec: { agent?: Agent | undefined; parent?: unknown; signal: AbortSignal },
    script: string,
    meta: typeof HACKDEV_META,
    scriptArgs: Record<string, JsonValue>,
    maxTotalAgents: number,
  ): Promise<{ runId: string; agentsStarted: number; result: JsonValue }> {
    const parent = exec.agent
    if (parent === undefined) {
      throw new Error('Hack Dev Code tools require a calling agent (exec.agent was undefined)')
    }
    void requireFreshProvider(ctx, resolved.subagentProvider)
    const run: WorkflowRun = ctx.workflowEngine.start({
      script,
      meta,
      args: scriptArgs,
      subagentProvider: resolved.subagentProvider,
      maxTotalAgents,
      parent,
      signal: exec.signal,
    })
    readOnlyMembers.set(run.id, new Set())
    const recordsRun = exec.parent === undefined
    // The engine publishes member events after start() returns and this record is active.
    if (recordsRun) recorder.start(parent.session, run)
    const onAbort = (): void => { run.cancel('parent step aborted') }
    exec.signal.addEventListener('abort', onAbort, { once: true })
    if (exec.signal.aborted) run.cancel('parent step aborted')
    let settled: WorkflowResult | undefined
    try {
      settled = await run.result
      const error = stopReasonError(settled)
      if (error !== undefined) throw new Error(error)
      const report = readReport(settled.value)
      return { runId: run.id, agentsStarted: settled.agentsStarted, result: report as unknown as JsonValue }
    } finally {
      exec.signal.removeEventListener('abort', onAbort)
      try {
        // Keep member listeners alive through disposal: an engine may synthesize cancelled endings.
        await run.dispose()
        if (recordsRun && settled !== undefined) recorder.finish(run.id, settled.stopReason)
      } finally {
        readOnlyMembers.delete(run.id)
        if (recordsRun) recorder.abandon(run.id)
      }
    }
  }

  ctx.tools.register(defineTool({
    name: 'hackdev',
    description: MISSION_DESCRIPTION,
    parameters: {
      mission: {
        type: 'string',
        required: true,
        description: 'The complete mission: what to build or change, constraints, stack preferences and acceptance expectations.',
      },
      maxTasks: {
        type: 'number',
        description: 'Optional cap on planned tasks per wave, bounded by the deployment ceiling.',
      },
      maxWaves: {
        type: 'number',
        description: 'Optional cap on build waves (follow-up waves close unmet acceptance criteria), bounded by the deployment ceiling.',
      },
      maxFixRounds: {
        type: 'number',
        description: 'Optional cap on extra review-fix rounds per gate, bounded by the deployment ceiling.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: OUTPUT_PROPERTIES },
      render: (_args, value) => [{
        type: 'text',
        text: renderReport(value.result as unknown as HackDevReport, resolved.maxResultChars),
      }],
      presentationMeta: (_args, value) => compactReport(value['result'] as unknown as HackDevReport),
    },
    async execute(args: MissionArgs, exec) {
      const mission = args.mission.trim()
      if (mission.length === 0) throw new Error('Hack Dev Code mission must be a non-empty string')
      const maxTasks = resolveCap('maxTasks', args.maxTasks, resolved.maxTasks, 1)
      const maxFixRounds = resolveCap('maxFixRounds', args.maxFixRounds, resolved.maxFixRounds, 0)
      const maxWaves = resolveCap('maxWaves', args.maxWaves, resolved.maxWaves, 1)
      return runPipeline(
        exec,
        HACKDEV_SCRIPT,
        HACKDEV_META,
        {
          mission, maxTasks, maxFixRounds, maxWaves,
          maxParallel: resolved.maxParallel,
          maxMemoryChars: resolved.maxMemoryChars,
          visionModel: resolved.visionModel,
          maxFactChecks: resolved.maxFactChecks,
          builderIsolation: resolved.builderIsolation,
          worktreeHelper: WORKTREE_HELPER,
          autonomy: resolved.autonomy,
          host: HOST_DESCRIPTION,
          customInstructions: missionInstructions(),
          models: resolved.models,
        },
        // Planner retries, splits, fact-checks, integrators and regression passes are inside the budget formula.
        agentBudget(maxTasks, maxFixRounds, true, maxWaves, resolved.builderIsolation === 'worktree'),
      )
    },
    presentCall: presentCall('hackdev'),
    presentResult,
  }), MISSION_TOOL_OPTIONS)

  ctx.tools.register(defineTool({
    name: 'hackdev_swarm',
    description: SWARM_DESCRIPTION,
    parameters: {
      mission: {
        type: 'string',
        required: true,
        description: 'The complete mission: what to build or change, constraints, stack preferences and acceptance expectations.',
      },
      maxWorkers: {
        type: 'number',
        description: 'Optional cap on the workers the coordinator may add, bounded by the deployment ceiling.',
      },
      maxRounds: {
        type: 'number',
        description: 'Optional cap on rounds (the first build plus the rounds that wake workers to resolve problems), bounded by the deployment ceiling.',
      },
      review: {
        type: 'boolean',
        description: 'Also run the verifier, quality/UX and security gates on the merged result once the swarm settles (default false).',
      },
      notes: {
        type: 'string',
        description: 'Optional instructions from the person posted on the board to every member, such as priorities or things to avoid.',
      },
      coordinatorModel: { type: 'string', description: 'Optional model for the coordinator, when the person names one.' },
      workerModel: { type: 'string', description: 'Optional model for the workers, when the person names one.' },
      verifierModel: { type: 'string', description: 'Optional model for the verifiers, when the person names one.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: OUTPUT_PROPERTIES },
      render: (_args, value) => [{
        type: 'text',
        text: renderReport(value.result as unknown as HackDevReport, resolved.maxResultChars),
      }],
      presentationMeta: (_args, value) => compactReport(value['result'] as unknown as HackDevReport),
    },
    async execute(args: SwarmArgs, exec) {
      const mission = args.mission.trim()
      if (mission.length === 0) throw new Error('Hack Dev Code swarm mission must be a non-empty string')
      const maxWorkers = resolveCap('maxWorkers', args.maxWorkers, resolved.maxWorkers, 1)
      const maxRounds = resolveCap('maxRounds', args.maxRounds, resolved.maxSwarmRounds, 1)
      const review = args.review === true
      const pick = (asked: string | undefined, configured: string): string => (asked ?? '').trim() || configured
      return runPipeline(
        exec,
        HACKDEV_SWARM_SCRIPT,
        HACKDEV_SWARM_META,
        {
          mission, maxWorkers, maxRounds, review,
          notes: (args.notes ?? '').trim().slice(0, 2000),
          maxFixRounds: resolved.maxFixRounds,
          maxParallel: resolved.maxParallel,
          maxMemoryChars: resolved.maxMemoryChars,
          visionModel: resolved.visionModel,
          builderIsolation: resolved.builderIsolation,
          worktreeHelper: WORKTREE_HELPER,
          autonomy: resolved.autonomy,
          host: HOST_DESCRIPTION,
          customInstructions: missionInstructions(),
          models: {
            planner: pick(args.coordinatorModel, resolved.models.planner),
            builder: pick(args.workerModel, resolved.models.builder),
            verifier: pick(args.verifierModel, resolved.models.verifier),
          },
        },
        swarmBudget(maxWorkers, maxRounds, resolved.builderIsolation === 'worktree', review, resolved.maxFixRounds),
      )
    },
    presentCall: presentCall('hackdev_swarm'),
    presentResult,
  }), MISSION_TOOL_OPTIONS)

  ctx.tools.register(defineTool({
    name: 'hackdev_review',
    description: REVIEW_DESCRIPTION,
    parameters: {
      mission: {
        type: 'string',
        required: true,
        description: 'One or two sentences on what the software is meant to do, so the gates know what to verify.',
      },
      focus: {
        type: 'string',
        description: 'Optional: the files or changes the gates should concentrate on.',
      },
      maxFixRounds: {
        type: 'number',
        description: 'Optional cap on extra review-fix rounds per gate, bounded by the deployment ceiling.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: OUTPUT_PROPERTIES },
      render: (_args, value) => [{
        type: 'text',
        text: renderReport(value.result as unknown as HackDevReport, resolved.maxResultChars),
      }],
      presentationMeta: (_args, value) => compactReport(value['result'] as unknown as HackDevReport),
    },
    async execute(args: ReviewArgs, exec) {
      const mission = args.mission.trim()
      if (mission.length === 0) throw new Error('Hack Dev Code review mission must be a non-empty string')
      const maxFixRounds = resolveCap('maxFixRounds', args.maxFixRounds, resolved.maxFixRounds, 0)
      return runPipeline(
        exec,
        HACKDEV_REVIEW_SCRIPT,
        HACKDEV_REVIEW_META,
        { mission, focus: (args.focus ?? '').trim(), maxFixRounds, maxMemoryChars: resolved.maxMemoryChars, visionModel: resolved.visionModel, customInstructions: missionInstructions(), autonomy: resolved.autonomy, host: HOST_DESCRIPTION, models: resolved.models },
        agentBudget(1, maxFixRounds, false),
      )
    },
    presentCall: presentCall('hackdev_review'),
    presentResult,
  }), MISSION_TOOL_OPTIONS)
}
