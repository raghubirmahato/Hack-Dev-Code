/**
 * Hack Dev Code mission tools. `hackdev` runs a fixed multi-agent pipeline
 * (planning council that sizes a specialist team, waves of parallel builders
 * with a shared blackboard, fact-check, verifier, quality/UX and security gates,
 * and an integrator that turns unmet acceptance criteria into the next wave)
 * over the workflow and subagent seams; `hackdev_review` runs only the gates on
 * the current workspace.
 * @module @hackdevcode/dsh-tool-hackdev
 */

import type { Context } from '@hackdevcode/cordis'
import z from '@hackdevcode/schemastery'
import type { JsonValue } from '@hackdevcode/dsh-util-values'
import type { SubagentProvider } from '@hackdevcode/dsh-subagent'
import { defineTool } from '@hackdevcode/dsh-tools'
import type { ToolCallView, ToolResultView } from '@hackdevcode/dsh-tools'
import type { WorkflowResult, WorkflowRun } from '@hackdevcode/dsh-workflow'
import type { Agent } from '@hackdevcode/dsh-agent'
import { createWorkflowRecorder } from '@hackdevcode/dsh-tool-workflow'
import { HACKDEV_META, HACKDEV_REVIEW_META, HACKDEV_REVIEW_SCRIPT, HACKDEV_SCRIPT } from './script.ts'
import { compactReport, renderReport } from './render.ts'
import type { HackDevReport } from './render.ts'

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
})

interface ResolvedConfig {
  readonly subagentProvider: string
  readonly maxTasks: number
  readonly maxParallel: number
  readonly maxWaves: number
  readonly visionModel: string
  readonly maxFixRounds: number
  readonly maxMemoryChars: number
  readonly maxResultChars: number
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
  '- For small edits you make yourself, finish by calling hackdev_review so the same three gates check the result before you declare it done.',
  '- Never claim software is finished, secure or unhackable on your own say-so: cite gate evidence, and state residual risk honestly.',
  '- Never take destructive or irreversible actions (deploys, force-pushes, deletions outside the workspace, secret handling) without the human approving them first.',
].join('\n')

const MISSION_DESCRIPTION = 'Run the full Hack Dev Code pipeline for one mission: a planning council maps the project and decomposes the mission '
  + 'into a team of specialist tasks sized to its complexity; parallel builder agents execute the dependency graph with a shared blackboard, '
  + 'unfinished tasks are re-split, and a fact-checker re-verifies claimed files and evidence; three gate agents then verify (syntax, logic and '
  + 'runtime errors), review quality and UI/UX visually with screenshots, and audit and harden security, fixing what they find; an integrator '
  + 'checks every acceptance criterion and starts follow-up waves for unmet ones. Writes .hackdev/RUN_REPORT.md, .hackdev/PROGRESS.md, '
  + '.hackdev/PROJECT_MAP.md and long-term .hackdev/MEMORY.md. Use for any substantial build, feature or multi-file fix. '
  + 'The call blocks until the whole pipeline settles and returns an evidence-based report.'

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

/** Resolve one model-selected cap against its deployment ceiling. */
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
 * Worst-case agent count. Council: analyst, scout, planner and one retry. Gates
 * per wave: verifier and regression with maxFixRounds + 1 rounds each, quality
 * and security with an audit plus maxFixRounds + 1 fix rounds each. Each wave
 * adds a fact-checker and an integrator; follow-up waves plan at most
 * FOLLOW_UP_TASK_CAP tasks. One chronicler at the end.
 */
export function agentBudget(maxTasks: number, maxFixRounds: number, withBuild: boolean, maxWaves = 1): number {
  const rounds = maxFixRounds + 1
  const gates = 4 * rounds + 2
  const chronicle = 1
  if (!withBuild) return Math.min(ENGINE_AGENT_CEILING, gates + chronicle)
  const wave = (tasks: number): number => AGENTS_PER_TASK * tasks + 1 + gates + 1
  const later = Math.min(maxTasks, FOLLOW_UP_TASK_CAP)
  return Math.min(ENGINE_AGENT_CEILING, 4 + wave(maxTasks) + (maxWaves - 1) * wave(later) + chronicle)
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

/** Defensively check the fixed script's terminal value before rendering it. */
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
    text: POLICY,
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
        },
        // Planner retry, splits, fact-checks, integrators and regression passes are inside the budget formula.
        agentBudget(maxTasks, maxFixRounds, true, maxWaves),
      )
    },
    presentCall: presentCall('hackdev'),
    presentResult,
  }))

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
        { mission, focus: (args.focus ?? '').trim(), maxFixRounds, maxMemoryChars: resolved.maxMemoryChars, visionModel: resolved.visionModel },
        agentBudget(1, maxFixRounds, false),
      )
    },
    presentCall: presentCall('hackdev_review'),
    presentResult,
  }))
}
