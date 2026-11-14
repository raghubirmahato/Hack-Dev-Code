/**
 * The swarm script: one prompt becomes a named team that works in parallel and coordinates on a single shared
 * message board. A coordinator splits the mission into workers, each with a brief that says what it owns, what it
 * must not touch and what done means. Workers never message each other privately: every assignment, question, diff
 * summary, test result and problem is a post addressed to `@name`, `@all` or `@coordinator`. One adversarial
 * verifier per two to four workers reviews diffs, runs the tests and sends each problem back to the worker that
 * wrote the code, which wakes that worker for another round. A monitor rule ends a swarm that has gone quiet
 * without finishing. Like the mission script, this runs inside the workflow engine's confined guest, so it is plain
 * JavaScript over the `agent`/`parallel`/`phase`/`log` hooks, and the model supplies data only.
 * @module @hackdevcode/dsh-tool-hackdev/swarm
 */

import { LIBRARY, PLANNING } from './script.ts'

/** Swarm: coordinator, rounds of named workers and verifiers over one board, final report, chronicle. */
export const HACKDEV_SWARM_SCRIPT = LIBRARY + PLANNING + String.raw`

BUILD_PHASE = 'Swarm'
const POST_KINDS = ['assignment', 'question', 'answer', 'diff', 'test', 'problem', 'status', 'decision']
const RESERVED_NAMES = ['coordinator', 'monitor', 'all', 'user', 'verifiers', 'workers']
const WORKERS_PER_VERIFIER = 3
const missionText = clip(args.mission, 6000)
const maxRounds = Number.isInteger(args.maxRounds) && args.maxRounds > 0 ? args.maxRounds : 3
const maxWorkers = Number.isInteger(args.maxWorkers) && args.maxWorkers > 0 ? args.maxWorkers : 8

// ------------------------------------------------------------------ Board
const board = []
const roster = []

function member(name) { return roster.find(function (m) { return m.name === name }) }

function addMember(name, kind, role, model) {
  const m = { name: name, kind: kind, role: role, model: isText(model) ? model.trim() : '', state: 'waiting', rounds: 0 }
  roster.push(m)
  return m
}

/** Normalize one addressee: a member name, a group, or all. Unknown names go to the coordinator. */
function addressee(raw) {
  let name = String(raw).trim().toLowerCase()
  while (name.charAt(0) === '@') name = name.slice(1)
  if (name === 'all' || name === 'workers' || name === 'verifiers') return name
  return member(name) === undefined ? 'coordinator' : name
}

function post(from, to, kind, text, round) {
  if (!isText(text)) return null
  const list = unique((Array.isArray(to) ? to : [to]).map(addressee))
  const entry = {
    n: board.length + 1,
    round: round,
    from: from,
    to: list.length === 0 ? ['all'] : list,
    kind: POST_KINDS.indexOf(kind) >= 0 ? kind : 'status',
    text: clip(text.trim(), 600),
  }
  board.push(entry)
  log('[board #' + entry.n + '] @' + entry.from + ' -> ' + entry.to.map(function (t) { return '@' + t }).join(' ') + ' (' + entry.kind + '): ' + clip(entry.text, 160))
  return entry
}

function addPosts(from, posts, round) {
  if (!Array.isArray(posts)) return
  for (const p of posts.slice(0, 12)) {
    if (p === null || typeof p !== 'object' || !isText(p.text)) continue
    post(from, isText(p.to) ? p.to.split(/[\s,]+/).filter(isText) : ['all'], p.kind, p.text, round)
  }
}

function isFor(entry, m) {
  return entry.to.indexOf(m.name) >= 0 || entry.to.indexOf('all') >= 0
    || (m.kind === 'worker' && entry.to.indexOf('workers') >= 0)
    || (m.kind === 'verifier' && entry.to.indexOf('verifiers') >= 0)
}

function postLine(e) {
  return '#' + e.n + ' [round ' + e.round + '] @' + e.from + ' -> ' + e.to.map(function (t) { return '@' + t }).join(' ') + ' (' + e.kind + '): ' + e.text
}

function linesWithin(entries, budget) {
  const lines = []
  let used = 0
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const line = postLine(entries[i])
    if (used + line.length > budget) break
    used += line.length + 1
    lines.unshift(line)
  }
  return { lines: lines, used: used }
}

/** What one member reads: every post addressed to it first, then the newest posts of the rest of the board. */
function boardFor(m) {
  if (board.length === 0) return '(the board is empty)'
  const mine = board.filter(function (e) { return isFor(e, m) || e.from === m.name })
  const rest = board.filter(function (e) { return !isFor(e, m) && e.from !== m.name })
  const first = linesWithin(mine, Math.floor(args.maxMemoryChars * 2 / 3))
  const second = linesWithin(rest, args.maxMemoryChars - first.used)
  const out = []
  if (first.lines.length > 0) out.push('Posts to you, to everyone, and from you:\n' + first.lines.join('\n'))
  if (second.lines.length > 0) out.push('Other recent posts:\n' + second.lines.join('\n'))
  return out.join('\n')
}

const postSchema = {
  type: 'object',
  properties: {
    to: { type: 'string' },
    kind: { type: 'string', enum: POST_KINDS },
    text: { type: 'string' },
  },
  required: ['to', 'kind', 'text'],
  additionalProperties: false,
}

const BOARD_PROTOCOL = [
  'Message board protocol: the swarm has ONE shared board and no private messages. Everything another member needs goes into posts: each post has to (a member name such as parser, or all, workers, verifiers, coordinator), kind (question, answer, diff, test, problem, status, decision) and a short text.',
  '- Post a diff summary (what you changed and where) and a test result (the command and its outcome) when you finish a piece of work.',
  '- Ask the coordinator about scope, priorities or anything outside your brief with a question to coordinator; ask another worker about its interface with a question to that worker. Do not guess and do not edit files another worker owns.',
  '- Answer every question on the board that is addressed to you.',
].join('\n')

// ------------------------------------------------------------ Coordinator
const swarmPlanSchema = {
  type: 'object',
  properties: {
    swarmName: { type: 'string' },
    summary: { type: 'string' },
    stack: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    contracts: { type: 'array', items: { type: 'string' } },
    workers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ROLES },
          brief: { type: 'string' },
          owns: { type: 'array', items: { type: 'string' } },
          mustNotTouch: { type: 'array', items: { type: 'string' } },
          done: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'role', 'brief', 'owns', 'mustNotTouch', 'done', 'dependsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['swarmName', 'summary', 'stack', 'acceptanceCriteria', 'contracts', 'workers'],
  additionalProperties: false,
}

function toTasks(workers) {
  return workers.map(function (w) {
    const name = w !== null && typeof w === 'object' && isText(w.name) ? w.name.trim().toLowerCase() : ''
    return {
      id: name,
      title: w !== null && typeof w === 'object' && isText(w.brief) ? clip(w.brief.trim().split('\n')[0], 120) : '',
      role: w !== null && typeof w === 'object' ? w.role : 'other',
      description: w !== null && typeof w === 'object' && isText(w.brief) ? w.brief.trim() : '',
      dependsOn: w !== null && typeof w === 'object' && Array.isArray(w.dependsOn) ? w.dependsOn.filter(isText).map(function (d) { return d.trim().toLowerCase().replace(/^@/, '') }) : [],
      ownedPaths: w !== null && typeof w === 'object' ? textList(w.owns) : [],
      mustNotTouch: w !== null && typeof w === 'object' ? textList(w.mustNotTouch) : [],
      acceptance: w !== null && typeof w === 'object' && isText(w.done) ? w.done.trim() : '',
    }
  })
}

function validateSwarm(raw) {
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.workers)) return { errors: ['the plan has no workers array'], tasks: [] }
  const tasks = toTasks(raw.workers)
  const errors = validateTasks(tasks, maxWorkers, {})
  for (const t of tasks) {
    if (RESERVED_NAMES.indexOf(t.id) >= 0 || t.id.indexOf('verify') === 0) errors.push('worker name "' + t.id + '" is reserved; name workers by their task, such as parser or api-tests')
    if (t.id.length > 24) errors.push('worker name "' + t.id + '" is longer than 24 characters')
  }
  return { errors: errors, tasks: tasks }
}

phase('Coordinator')
addMember('coordinator', 'coordinator', 'coordinator', args.models !== null && typeof args.models === 'object' ? args.models.planner : '')
if (isText(args.notes)) post('user', ['all'], 'decision', args.notes, 0)

let plan = null
let tasks = []
let planErrors = []
for (let attempt = 1; attempt <= 3 && plan === null; attempt += 1) {
  const raw = await agent([
    'You are the COORDINATOR of a swarm: a team of named agents that work in parallel and coordinate on one shared message board. You split the mission, brief the workers and report; you do not do the technical work yourself. Read-only: inspect the workspace, but the only file you may write is .hackdev/PROJECT_MAP.md.',
    'Mission:\n' + missionText,
    'First inspect the workspace: what the project is, its stack, the exact install, build, test and run commands, its conventions and its key files. Read .hackdev/PROJECT_MAP.md, .hackdev/MEMORY.md and .hackdev/PROGRESS.md if they exist and plan only the remaining work. Write what you found to .hackdev/PROJECT_MAP.md.',
    'Then form the swarm, with at most ' + maxWorkers + ' workers (up to ' + args.maxParallel + ' run at once). Rules:',
    '- Name the swarm, and name each worker by its task in lowercase kebab-case, such as parser, api-tests or docs. For a pool of similar workers use numbered names such as fix-1, fix-2.',
    '- Size the swarm to the mission: two or three workers for a small job, more only when the work really splits. Every worker is a full agent and costs as much as one.',
    '- Each worker starts with a clean context, so its brief must stand on its own: what to build and how it fits the whole, owns (the files or directories only this worker may edit), mustNotTouch (files and areas it must leave alone, such as another worker\'s directory or shared config), and done (what done means, checkable by running something).',
    '- Keep owns disjoint so workers never collide. Shared files (package manifests, route tables, config) belong to exactly one worker; workers that need its output list it in dependsOn. Use dependsOn only for real ordering needs and keep the graph wide and acyclic.',
    '- Include workers for tests and documentation where the mission needs them. Do not add reviewers: verifiers are added for you, one per two to four workers.',
    '- Put every shared interface (routes, data shapes, file formats, commands) in contracts and measurable outcomes in acceptanceCriteria.',
    planErrors.length === 0 ? '' : 'Your previous plan was rejected for these reasons; fix them:\n- ' + planErrors.join('\n- '),
    GROUNDING,
    // Last, where small models weigh text most: they otherwise start building the mission themselves.
    'Your part ends with the swarm plan. Do not carry out the mission: do not create or edit the project\'s files (notes under .hackdev are not project files); the workers do that.',
  ].filter(function (s) { return s.length > 0 }).join('\n\n'), forRole('planner', { label: '@coordinator: form the swarm (attempt ' + attempt + ')', phase: 'Coordinator', schema: swarmPlanSchema }))
  if (raw === null) { planErrors = ['the coordinator agent failed']; continue }
  const checked = validateSwarm(raw)
  if (checked.errors.length === 0) { plan = raw; tasks = checked.tasks } else planErrors = checked.errors
}
let planFallback = false
if (plan === null) {
  planFallback = true
  log('The coordinator could not form a valid swarm (' + planErrors.join('; ') + '); falling back to one worker')
  plan = { swarmName: 'solo', summary: 'Fallback single-worker swarm', stack: 'as appropriate to the mission', acceptanceCriteria: [], contracts: [] }
  tasks = [{ id: 'builder', title: 'Complete the mission', role: 'fullstack', description: missionText, dependsOn: [], ownedPaths: [], mustNotTouch: [], acceptance: 'The mission requirements are met and verified.' }]
}
if (!Array.isArray(plan.contracts)) plan.contracts = []
if (!Array.isArray(plan.acceptanceCriteria)) plan.acceptanceCriteria = []
const swarmName = isText(plan.swarmName) ? clip(plan.swarmName.trim(), 60) : 'swarm'
const orderedOverlaps = serializeOverlaps(tasks)
if (orderedOverlaps.length > 0) log('Workers that own the same paths now run in order: ' + orderedOverlaps.join('; '))
projectMap.text = 'Summary: ' + clip(plan.summary, 800) + '\nStack: ' + clip(plan.stack, 300)

const workerModel = args.models !== null && typeof args.models === 'object' ? args.models.builder : ''
const verifierModel = args.models !== null && typeof args.models === 'object' ? args.models.verifier : ''
for (const t of tasks) addMember(t.id, 'worker', t.role, workerModel)
for (const c of textList(plan.contracts).slice(0, 20)) post('coordinator', ['all'], 'decision', 'Contract: ' + c, 0)
for (const t of tasks) {
  post('coordinator', [t.id], 'assignment', t.description + ' Owns: ' + (t.ownedPaths.length === 0 ? 'keep changes tightly scoped' : t.ownedPaths.join(', '))
    + '. Must not touch: ' + (t.mustNotTouch.length === 0 ? 'files other workers own' : t.mustNotTouch.join(', ')) + '. Done means: ' + t.acceptance, 0)
}

// Verifiers: one per two to four workers, each with a fixed group so a worker always answers to the same reviewer.
const verifierCount = Math.ceil(tasks.length / WORKERS_PER_VERIFIER)
const groups = []
for (let i = 0; i < verifierCount; i += 1) groups.push({ name: verifierCount === 1 ? 'verify' : 'verify-' + (i + 1), workers: [], issues: [], checks: [], rounds: 0, summary: '', crashed: false })
tasks.forEach(function (t, i) { groups[i % verifierCount].workers.push(t.id) })
for (const g of groups) addMember(g.name, 'verifier', 'verifier', verifierModel)
function groupOf(name) { return groups.find(function (g) { return g.workers.indexOf(name) >= 0 }) }

// ---------------------------------------------------------------- Workers
const swarmWorkerSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    posts: { type: 'array', items: postSchema },
    needsHuman: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'filesChanged', 'evidence', 'posts', 'needsHuman'],
  additionalProperties: false,
}

const results = {}
const verdicts = {}
const limit = makeLimiter(args.maxParallel)

function rosterText(current) {
  return tasks.map(function (t) {
    const r = results[t.id]
    return '- @' + t.id + (t.id === current ? ' (YOU)' : '') + ' [' + t.role + (r === undefined ? '' : ', ' + r.status) + ']: ' + t.title + ' | owns: ' + (t.ownedPaths.length === 0 ? 'unspecified' : t.ownedPaths.join(', '))
  }).join('\n') + '\n' + groups.map(function (g) { return '- @' + g.name + ' [verifier]: reviews ' + g.workers.map(function (w) { return '@' + w }).join(', ') }).join('\n')
}

function workerPrompt(task, round, tree) {
  const previous = results[task.id]
  const m = member(task.id)
  return [
    (ROLE_FOCUS[task.role] || ROLE_FOCUS.other) + ' You are @' + task.id + ', a WORKER in the swarm "' + swarmName + '". You own one piece of a larger mission and finish it completely and correctly.',
    'Overall mission:\n' + missionText,
    'Project:\n' + clip(projectMapText(), 2000),
    'YOUR BRIEF: ' + task.description + '\nYou own (only you may edit these): ' + (task.ownedPaths.length === 0 ? 'nothing was listed, so keep changes minimal and tightly scoped' : task.ownedPaths.join(', '))
      + '\nYou must not touch: ' + (task.mustNotTouch.length === 0 ? 'files other workers own' : task.mustNotTouch.join(', ')) + '\nDone means: ' + task.acceptance,
    'The swarm:\n' + rosterText(task.id),
    previous === undefined
      ? 'This is your first turn (round ' + round + ').'
      : 'You were woken for round ' + round + '. Your last report was ' + previous.status + ': ' + clip(previous.summary, 500) + '\nRead the posts addressed to you below: resolve every problem a verifier sent you, use the answers to your questions, then re-run your checks.',
    'The message board:\n' + boardFor(m),
    tree === null ? '' : 'You work in your own isolated git worktree at ' + tree + ' (it is your current directory and holds the whole project). Edit and test only there; your changes are merged back into the main workspace automatically when you finish.',
    'Method: inspect the workspace first, implement production-quality code (input validation, error handling, no placeholders or TODO stubs), write tests for it, then VERIFY it by running it or its tests.',
    BOARD_PROTOCOL,
    BOUNDED_AUTONOMY,
    GROUNDING,
    'Return status done only when your done-definition is met and you ran something to prove it; list the evidence (command and observed outcome) and every file you changed. Use partial when work remains, and blocked only when you cannot progress without an answer or a human decision (post the question).',
  ].filter(function (s) { return s.length > 0 }).join('\n\n')
}

/** Board posts a member has already been shown, so a continued conversation is told only what is new. */
const shownUpTo = {}

/** Posts addressed to a member (or to everyone) since it last saw the board, as text. */
function newPostsFor(m) {
  const since = shownUpTo[m.name] || 0
  const fresh = board.filter(function (e) { return e.n > since && e.from !== m.name && isFor(e, m) })
  return fresh.length === 0 ? '(nothing new is addressed to you)' : fresh.map(postLine).join('\n')
}

/**
 * What a worker that keeps its conversation is told when it is woken: only what changed since its last turn. Its
 * brief, the plan and everything it did are already in its own history.
 */
function continuePrompt(task, round) {
  const previous = results[task.id]
  return [
    'You were woken for round ' + round + ' of the swarm "' + swarmName + '". Your last report was ' + (previous === undefined ? 'missing' : previous.status) + '.',
    'New on the message board for you since your last turn:\n' + newPostsFor(member(task.id)),
    'Resolve every problem a verifier sent you, answer every question addressed to you, use the answers to your own questions, then re-run your checks. Your brief, what you own and what done means are unchanged.',
    'Return the same structured report as before: status, summary, every file you changed this round, evidence (command and observed outcome), posts and needsHuman.',
  ].join('\n\n')
}

async function runWorker(task, round, isolated) {
  const m = member(task.id)
  m.state = 'active'
  m.rounds += 1
  const tree = isolated ? await isolate(task, round) : null
  const options = forRole('builder', { label: '@' + task.id + ' (round ' + round + ')', phase: 'Swarm', schema: swarmWorkerSchema })
  if (tree !== null) options.cwd = tree
  // In the shared workspace a worker keeps one conversation across rounds: a woken worker continues it and is told
  // only what is new. A worker in its own worktree gets a new folder each round, so it starts afresh there.
  const shared = tree === null
  const continues = shared && round > 1 && typeof m.session === 'string'
  const raw = await limit(async function () {
    if (continues) {
      try {
        const prompt = continuePrompt(task, round)
        shownUpTo[task.id] = board.length
        return await agent(prompt, Object.assign({}, options, { session: m.session }))
      } catch (error) {
        log('@' + task.id + ' could not continue its conversation (' + String(error && error.message ? error.message : error) + '); starting it afresh')
      }
    }
    const prompt = workerPrompt(task, round, tree)
    shownUpTo[task.id] = board.length
    if (!shared) return agent(prompt, options)
    // A worker that could not continue starts a new conversation under a new name, and later rounds continue that one.
    m.session = 'worker:' + task.id + (round > 1 ? ':' + round : '')
    return agent(prompt, Object.assign({}, options, { session: m.session }))
  })

  let merge = null
  if (tree !== null) merge = await mergeBack(task, tree)
  m.state = 'waiting'
  const before = results[task.id]
  if (raw === null || typeof raw !== 'object') {
    post('monitor', ['coordinator', task.id], 'problem', '@' + task.id + ' crashed or returned no report in round ' + round + '.', round)
    results[task.id] = before !== undefined ? Object.assign({}, before, { status: before.status === 'done' ? 'partial' : before.status, changedThisRound: false })
      : { status: 'failed', summary: 'The worker crashed or returned no report', filesChanged: [], evidence: [], needsHuman: [], changedThisRound: false }
    return
  }
  const evidence = textList(raw.evidence).map(function (s) { return clip(s, 300) }).slice(0, 20)
  let status = ['done', 'partial', 'blocked'].indexOf(raw.status) >= 0 ? raw.status : 'partial'
  // Evidence-based completion: a worker is only done when it carries evidence.
  if (status === 'done' && evidence.length === 0) status = 'partial'
  const files = textList(raw.filesChanged).slice(0, 60)
  let summary = clip(raw.summary, 1000)
  if (merge !== null && merge.conflicts.length > 0) post('monitor', ['all'], 'status', 'Merging @' + task.id + ' resolved conflicts in: ' + merge.conflicts.join(', '), round)
  if (merge !== null && !merge.merged) {
    if (status === 'done') status = 'partial'
    summary = clip(summary + ' | Merge from its worktree did not complete: ' + merge.summary, 1000)
    post('monitor', ['coordinator', task.id], 'problem', 'Changes of @' + task.id + ' did not fully reach the main workspace: ' + merge.summary, round)
  }
  results[task.id] = {
    status: status,
    summary: summary,
    filesChanged: before === undefined ? files : unique(before.filesChanged.concat(files)).slice(0, 60),
    evidence: evidence.length > 0 || before === undefined ? evidence : before.evidence,
    needsHuman: textList(raw.needsHuman).map(function (s) { return clip(s, 300) }).slice(0, 10),
    changedThisRound: files.length > 0,
  }
  addPosts(task.id, raw.posts, round)
  post(task.id, ['all'], 'status', status + ': ' + clip(summary, 300) + (files.length === 0 ? '' : ' Files: ' + files.slice(0, 12).join(', ')), round)
}

/** Round one follows the dependency graph; later rounds wake only the workers the board calls on. */
async function runRound(names, round) {
  phase('Swarm')
  const isolated = args.builderIsolation === 'worktree' && names.length > 1
  if (round > 1) return Promise.all(names.map(function (n) { return runWorker(tasks.find(function (t) { return t.id === n }), round, isolated) }))
  const promises = {}
  const order = function (task) {
    return Promise.all(task.dependsOn.map(function (d) { return promises[d] })).then(function () {
      const failed = task.dependsOn.find(function (d) { return results[d] === undefined || results[d].status === 'failed' || results[d].status === 'skipped' })
      if (failed !== undefined) {
        results[task.id] = { status: 'skipped', summary: 'Skipped because @' + failed + ' did not produce its part', filesChanged: [], evidence: [], needsHuman: [], changedThisRound: false }
        post('monitor', ['coordinator'], 'problem', '@' + task.id + ' was skipped because @' + failed + ' did not produce its part.', round)
        return
      }
      return runWorker(task, round, isolated)
    })
  }
  for (const task of tasks) promises[task.id] = order(task)
  return Promise.all(tasks.map(function (t) { return promises[t.id] }))
}

// ------------------------------------------------------------ Coordinator steer
const steerSchema = {
  type: 'object',
  properties: { posts: { type: 'array', items: postSchema } },
  required: ['posts'],
  additionalProperties: false,
}

const answered = {}

/** Open questions to the coordinator get one answer turn; the coordinator posts its answers back to the askers. */
async function steer(round) {
  const open = board.filter(function (e) { return e.kind === 'question' && e.to.indexOf('coordinator') >= 0 && !answered[e.n] })
  if (open.length === 0) return
  phase('Coordinator')
  const c = member('coordinator')
  c.state = 'active'
  c.rounds += 1
  const raw = await agent([
    'You are the COORDINATOR of the swarm "' + swarmName + '". Workers asked you the questions below on the message board. Answer each one with a post addressed to the worker that asked (kind answer), deciding scope, priority and interfaces so the worker can continue without asking again. Post a decision to all when an answer changes a shared contract. Read-only: inspect the workspace if you need to, but do not modify files.',
    'Mission:\n' + missionText,
    'Plan: ' + clip(plan.summary, 1500),
    'The swarm:\n' + rosterText(''),
    'Open questions:\n' + open.map(postLine).join('\n'),
    'The message board:\n' + boardFor(c),
    GROUNDING,
  ].join('\n\n'), forRole('planner', { label: '@coordinator: answer questions (round ' + round + ')', phase: 'Coordinator', schema: steerSchema }))
  c.state = 'waiting'
  for (const e of open) answered[e.n] = true
  if (raw !== null && typeof raw === 'object') addPosts('coordinator', raw.posts, round)
}

// -------------------------------------------------------------- Verifiers
const verifySchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          worker: { type: 'string' },
          verdict: { type: 'string', enum: ['pass', 'problems'] },
          checks: { type: 'array', items: checkSchema },
          problems: {
            type: 'array',
            items: {
              type: 'object',
              properties: { severity: { type: 'string', enum: SEVERITIES }, text: { type: 'string' } },
              required: ['severity', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['worker', 'verdict', 'checks', 'problems'],
        additionalProperties: false,
      },
    },
    posts: { type: 'array', items: postSchema },
  },
  required: ['summary', 'reviews', 'posts'],
  additionalProperties: false,
}

async function runVerifier(group, names, round) {
  const m = member(group.name)
  m.state = 'active'
  m.rounds += 1
  group.rounds += 1
  const raw = await agent([
    'You are @' + group.name + ', an adversarial VERIFIER in the swarm "' + swarmName + '". Your job is to find what is wrong with the work, not to confirm that it works. You never fix code yourself: you send each problem back to the worker that wrote it. Read-only: do not modify source files (you may install dependencies, run builds, tests and servers, and write notes under .hackdev/).',
    'Mission:\n' + missionText,
    'Project:\n' + clip(projectMapText(), 2000),
    'Acceptance criteria:\n' + (plan.acceptanceCriteria.length === 0 ? '(none listed: derive them from the mission)' : plan.acceptanceCriteria.map(function (c) { return '- ' + clip(c, 300) }).join('\n')),
    'Review these workers this round:\n' + names.map(function (n) {
      const t = tasks.find(function (x) { return x.id === n })
      const r = results[n]
      return '- @' + n + ' [' + t.role + ', reported ' + r.status + ']: ' + t.description + '\n  done means: ' + t.acceptance + '\n  owns: ' + (t.ownedPaths.length === 0 ? 'unspecified' : t.ownedPaths.join(', '))
        + '\n  its report: ' + clip(r.summary, 500) + '\n  files: ' + r.filesChanged.slice(0, 20).join(', ') + '\n  claimed evidence: ' + r.evidence.slice(0, 6).join(' | ')
    }).join('\n'),
    'For EACH worker: (1) read its diff (git diff and the files it listed) and check it against its brief, its done-definition and the contracts on the board, and that it stayed inside what it owns; (2) re-run its claimed evidence and the project checks (build, typecheck, lint, tests) and report each as a check with its real outcome; (3) try to break it: invalid and empty input, error paths, edge cases, wiring to the other workers\' parts; (4) list every real problem with a severity and enough detail (file, what is wrong, how to reproduce) for the worker to fix it without asking. verdict=pass only when at least one check you ran passes and you found no problem.',
    round > 1 ? 'Problems you reported earlier that are still unresolved must be reported again; anything you leave out is treated as fixed.' : '',
    'The message board:\n' + boardFor(m),
    BOARD_PROTOCOL,
    BOUNDED_AUTONOMY,
    GROUNDING,
  ].filter(function (s) { return s.length > 0 }).join('\n\n'), forRole('verifier', { label: '@' + group.name + ' (round ' + round + ')', phase: 'Verify', schema: verifySchema }))
  m.state = 'waiting'
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.reviews)) {
    group.crashed = true
    post('monitor', ['coordinator'], 'problem', '@' + group.name + ' crashed in round ' + round + '; its workers stay unverified.', round)
    for (const n of names) verdicts[n] = null
    return
  }
  group.crashed = false
  group.summary = clip(isText(raw.summary) ? raw.summary : '', 1200)
  for (const n of names) {
    const review = raw.reviews.find(function (r) { return r !== null && typeof r === 'object' && isText(r.worker) && addressee(r.worker) === n })
    // Everything this verifier held open against the worker is settled by its newest review.
    for (const i of group.issues) if (i.worker === n && i.status === 'open') i.status = 'fixed'
    if (review === undefined) { verdicts[n] = null; continue }
    const checks = (Array.isArray(review.checks) ? review.checks : []).filter(function (c) { return c !== null && typeof c === 'object' && isText(c.name) })
      .slice(0, 12).map(function (c) { return { name: clip('@' + n + ': ' + c.name, 160), outcome: ['pass', 'fail', 'skipped'].indexOf(c.outcome) >= 0 ? c.outcome : 'skipped', detail: clip(isText(c.detail) ? c.detail : '', 300) } })
    const problems = (Array.isArray(review.problems) ? review.problems : []).filter(function (p) { return p !== null && typeof p === 'object' && isText(p.text) }).slice(0, 12)
    group.checks = group.checks.filter(function (c) { return c.name.indexOf('@' + n + ': ') !== 0 }).concat(checks)
    // A pass must be earned: a passing check, no failing check and no problem.
    const earned = review.verdict === 'pass' && problems.length === 0
      && checks.some(function (c) { return c.outcome === 'pass' }) && !checks.some(function (c) { return c.outcome === 'fail' })
    verdicts[n] = earned
    for (const p of problems) {
      const severity = SEVERITIES.indexOf(p.severity) >= 0 ? p.severity : 'medium'
      group.issues.push({ worker: n, severity: severity, title: clip('@' + n + ': ' + p.text.trim(), 300), status: 'open' })
      post(group.name, [n], 'problem', '[' + severity + '] ' + p.text, round)
    }
    if (!earned && problems.length === 0) {
      group.issues.push({ worker: n, severity: 'medium', title: '@' + n + ': not verified — no passing check was reported', status: 'open' })
      post(group.name, [n], 'problem', 'Your work could not be verified: no check passed. Run your tests and post the command and its result.', round)
    }
    if (earned) post(group.name, [n], 'test', 'Verified: ' + checks.filter(function (c) { return c.outcome === 'pass' }).length + ' check(s) passed, no problems.', round)
  }
  addPosts(group.name, raw.posts, round)
}

async function verify(names, round) {
  const reviewable = names.filter(function (n) { const r = results[n]; return r !== undefined && r.status !== 'failed' && r.status !== 'skipped' })
  if (reviewable.length === 0) return
  phase('Verify')
  await parallel(groups.map(function (g) {
    const mine = reviewable.filter(function (n) { return g.workers.indexOf(n) >= 0 })
    return function () { return mine.length === 0 ? null : runVerifier(g, mine, round) }
  }))
}

// ----------------------------------------------------------------- Rounds
function needsWake(name) {
  const r = results[name]
  if (r === undefined || r.status === 'skipped') return false
  // Blocked on a person: another round cannot help.
  if (r.status === 'blocked' && r.needsHuman.length > 0) return false
  if (verdicts[name] === false) return true
  return r.status !== 'done'
}

let round = 1
let stalled = false
let running = tasks.map(function (t) { return t.id })
let lastWoken = ''
for (;;) {
  await runRound(running, round)
  await steer(round)
  await verify(running, round)
  const woken = tasks.map(function (t) { return t.id }).filter(needsWake)
  if (woken.length === 0 || round >= maxRounds) break
  // The monitor: the same workers are being woken again and none of them changed a file, so the swarm has gone quiet.
  const quiet = woken.join(',') === lastWoken && !running.some(function (n) { return results[n] !== undefined && results[n].changedThisRound })
  if (quiet) {
    stalled = true
    post('monitor', ['coordinator'], 'problem', 'The swarm went quiet before the work was finished: ' + woken.map(function (n) { return '@' + n }).join(', ') + ' made no further changes.', round)
    break
  }
  lastWoken = woken.join(',')
  running = woken
  round += 1
}
for (const m of roster) if (m.kind !== 'coordinator') m.state = 'done'

// ------------------------------------------------------------------ Report
const finalSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: { criterion: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string' } },
        required: ['criterion', 'met', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'criteria'],
  additionalProperties: false,
}

phase('Report')
member('coordinator').state = 'active'
const final = await agent([
  'You are the COORDINATOR of the swarm "' + swarmName + '", accountable for the mission. The workers and verifiers have settled. Do not modify source files; the only file you may write is .hackdev/PROGRESS.md.',
  'Mission:\n' + missionText,
  'Acceptance criteria:\n' + (plan.acceptanceCriteria.length === 0 ? '(none listed: derive them from the mission)' : plan.acceptanceCriteria.map(function (c) { return '- ' + clip(c, 300) }).join('\n')),
  'Workers:\n' + tasks.map(function (t) { const r = results[t.id]; return '- @' + t.id + ' [' + (r === undefined ? 'not run' : r.status) + (verdicts[t.id] === true ? ', verified' : verdicts[t.id] === false ? ', verifier found problems' : ', unverified') + ']: ' + (r === undefined ? '' : clip(r.summary, 300)) }).join('\n'),
  'Verifiers:\n' + groups.map(function (g) { const open = g.issues.filter(function (i) { return i.status === 'open' }); return '- @' + g.name + ': ' + clip(g.summary, 300) + (open.length === 0 ? '' : '\n' + open.map(function (i) { return '  open [' + i.severity + '] ' + i.title }).join('\n')) }).join('\n'),
  'For EVERY acceptance criterion decide met or unmet, verifying in the workspace (run the check where cheap) and citing evidence. Then write .hackdev/PROGRESS.md: the progress ledger (workers with status, criteria met/unmet, remaining work) a rerun resumes from. In summary, tell the person what was built, what is unfinished and what they should look at.',
  GROUNDING,
].join('\n\n'), forRole('planner', { label: '@coordinator: final report', phase: 'Report', schema: finalSchema }))
member('coordinator').state = 'done'
const criteria = final !== null && typeof final === 'object' && Array.isArray(final.criteria)
  ? final.criteria.filter(function (c) { return c !== null && typeof c === 'object' && isText(c.criterion) }).slice(0, 40)
    .map(function (c) { return { criterion: clip(c.criterion, 300), met: c.met === true, evidence: clip(isText(c.evidence) ? c.evidence : '', 400) } })
  : []

const gates = groups.filter(function (g) { return g.rounds > 0 }).map(function (g) {
  const open = g.issues.filter(function (i) { return i.status === 'open' })
  const unverified = g.workers.some(function (w) { return verdicts[w] !== true && results[w] !== undefined && results[w].status !== 'skipped' })
  return {
    gate: 'Verifier @' + g.name + ' (' + g.workers.map(function (w) { return '@' + w }).join(', ') + ')',
    verdict: g.crashed || open.length > 0 || unverified ? 'fail' : 'pass',
    rounds: g.rounds,
    fixedIssues: g.issues.filter(function (i) { return i.status === 'fixed' }).length,
    summary: g.crashed ? 'the verifier crashed and its workers stay unverified' : g.summary,
    checks: g.checks.slice(0, 40),
    issues: (g.crashed ? [{ severity: 'high', title: '@' + g.name + ' crashed before finishing its review', status: 'open' }] : [])
      .concat(g.issues.slice(-60).map(function (i) { return { severity: i.severity, title: i.title, status: i.status } })),
    hasUi: false, uiVerified: false, uiEvidence: [], limitations: [],
  }
})

// Optional: the three Sentinel Gates review the merged result once the swarm has settled.
if (args.review === true) {
  const reviewed = await runGates([
    'Plan summary: ' + clip(plan.summary, 1500),
    'Acceptance criteria:\n' + plan.acceptanceCriteria.map(function (c) { return '- ' + clip(c, 300) }).join('\n'),
    'Swarm results:\n' + tasks.map(function (t) { const r = results[t.id]; return '- @' + t.id + ' [' + t.role + ', ' + (r === undefined ? 'not run' : r.status) + ']: ' + (r === undefined ? '' : clip(r.summary, 400) + '\n  files: ' + r.filesChanged.slice(0, 12).join(', ')) }).join('\n'),
  ].join('\n\n'))
  for (const g of gateSummaries(reviewed)) gates.push(Object.assign({}, g, { verdict: g.verdict }))
  for (const h of collectNeedsHuman(reviewed)) post('monitor', ['all'], 'status', 'Needs a person: ' + h, round)
}

const needsHuman = []
for (const t of tasks) { const r = results[t.id]; if (r !== undefined) for (const h of r.needsHuman) if (needsHuman.indexOf(h) < 0) needsHuman.push(h) }

const workersOk = tasks.every(function (t) { return results[t.id] !== undefined && results[t.id].status === 'done' })
const report = {
  status: workersOk && gates.every(function (g) { return g.verdict === 'pass' }) && criteria.length > 0 && criteria.every(function (c) { return c.met }) ? 'complete' : 'needs-attention',
  mission: missionText,
  planFallback: planFallback,
  plan: { summary: clip(plan.summary, 2000) + (final !== null && typeof final === 'object' && isText(final.summary) ? '\nOutcome: ' + clip(final.summary, 1200) : ''), stack: isText(plan.stack) ? plan.stack : '', requirements: [], acceptanceCriteria: plan.acceptanceCriteria, complexity: 'swarm' },
  waves: round,
  stalled: stalled,
  tasks: tasks.map(function (t) {
    const r = results[t.id] || { status: 'failed', summary: 'The worker never ran', filesChanged: [], evidence: [], needsHuman: [] }
    return { id: t.id, title: t.title, role: t.role, wave: member(t.id).rounds < 1 ? 1 : member(t.id).rounds, status: r.status, summary: r.summary, filesChanged: r.filesChanged, evidence: r.evidence, verified: verdicts[t.id] === undefined ? null : verdicts[t.id], followUps: [], needsHuman: r.needsHuman }
  }),
  criteria: criteria,
  gates: gates,
  needsHuman: needsHuman,
  memoryEntries: memory.entries.length,
  swarm: {
    name: swarmName,
    rounds: round,
    stalled: stalled,
    members: roster.map(function (m) { return { name: m.name, kind: m.kind, role: m.role, model: m.model, rounds: m.rounds } }),
    posts: board.length,
    board: board.slice(-200),
  },
}
report.recorded = await chronicle(report, '4. Write .hackdev/swarm/BOARD.md: the swarm\'s whole message board as a readable log, one post per line in order (number, round, from, to, kind, text), headed by the swarm name and its members. Use exactly these posts (JSON):\n' + clip(JSON.stringify(board), 30000))
return report
`

/** Meta identity block for the engine's validation and progress UI. */
export const HACKDEV_SWARM_META = {
  name: 'hackdev-swarm',
  description: 'A coordinator splits one prompt into named workers that build in parallel on a shared message board while verifiers challenge every diff.',
  phases: [
    { title: 'Coordinator', detail: 'Maps the project, names the swarm, briefs each worker (owns, must not touch, done) and answers their questions.' },
    { title: 'Swarm', detail: 'Named workers run in parallel, each in its own worktree when isolation is on, posting diffs, tests and questions to the board.' },
    { title: 'Verify', detail: 'One adversarial verifier per two to four workers re-runs tests, challenges diffs and sends problems back to their author.' },
    { title: 'Sentinel Gates', detail: 'Optional: verifier, quality/UX and security gates on the merged result.' },
    { title: 'Report', detail: 'The coordinator checks every acceptance criterion against evidence.' },
    { title: 'Chronicle', detail: 'Run report, progress ledger, long-term memory and the message board written to .hackdev/.' },
  ],
}
