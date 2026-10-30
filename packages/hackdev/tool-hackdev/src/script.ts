/**
 * Fixed, deployment-owned orchestration scripts for Hack Dev Code. The model
 * supplies data only (mission text and caps); it cannot alter the pipeline,
 * the structured-output schemas, or the gate order. The scripts run inside the
 * workflow engine's confined guest, so they use only plain JavaScript and the
 * `agent`/`parallel`/`phase`/`log` hooks.
 *
 * Pipeline: Shogun's Council (analyst + structured scout project map -> planner
 * that sizes a specialist team) -> waves of: Forge (dependency graph of
 * parallel builders behind a concurrency cap, with a structured blackboard,
 * handoff notes and nested re-splitting of failed tasks) -> Fact-check (claimed
 * files and evidence re-verified) -> Sentinel Gates (verifier, then read-only
 * quality/UX and security audits in parallel, serialized fixes, and a
 * regression re-verify when later gates changed code) -> Integrator (every
 * acceptance criterion checked against evidence; unmet criteria become the next
 * wave) -> Chronicle (evidence report, progress ledger and persistent memory in
 * `.hackdev/`).
 * @module @hackdevcode/dsh-tool-hackdev/script
 */

/** Shared helpers prepended to every Hack Dev Code script. No backticks or template literals: this is guest source. */
const LIBRARY = String.raw`
const SEVERITIES = ['critical', 'high', 'medium', 'low']
const NOTE_KINDS = ['decision', 'contract', 'fact', 'risk', 'warning', 'handoff', 'question']
// Contracts and decisions are pinned: every agent must see them even when the board is large.
const PINNED_KINDS = ['contract', 'decision']

const memory = { entries: [], seen: {} }
const projectMap = { text: '' }

function clip(text, max) {
  const s = typeof text === 'string' ? text : JSON.stringify(text)
  return s.length <= max ? s : s.slice(0, max) + ' …[truncated]'
}

function isText(v) { return typeof v === 'string' && v.trim().length > 0 }
function textList(v) { return Array.isArray(v) ? v.filter(isText).map(function (s) { return s.trim() }) : [] }
function unique(list) { const out = []; for (const x of list) if (out.indexOf(x) < 0) out.push(x); return out }

/** Append validated notes to the shared blackboard. Duplicates (same kind and text) are dropped. */
function addNotes(by, notes) {
  if (!Array.isArray(notes)) return
  for (const n of notes) {
    if (n === null || typeof n !== 'object' || !isText(n.text)) continue
    const kind = NOTE_KINDS.indexOf(n.kind) >= 0 ? n.kind : 'fact'
    const text = clip(n.text.trim(), 400)
    const key = kind + '|' + text.toLowerCase()
    if (memory.seen[key]) continue
    memory.seen[key] = true
    memory.entries.push({ kind: kind, text: text, by: by })
  }
}

function noteLine(e) { return '- [' + e.kind + '] (' + e.by + ') ' + e.text }

/** Newest-first view of a subset of the board within a character budget, rendered oldest-first. */
function boundedLines(entries, budget) {
  const lines = []
  let used = 0
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const line = noteLine(entries[i])
    if (used + line.length > budget) break
    used += line.length + 1
    lines.unshift(line)
  }
  return { lines: lines, used: used }
}

function memoryText() {
  if (memory.entries.length === 0) return '(empty — you are among the first to write to it)'
  const pinned = memory.entries.filter(function (e) { return PINNED_KINDS.indexOf(e.kind) >= 0 })
  const rest = memory.entries.filter(function (e) { return PINNED_KINDS.indexOf(e.kind) < 0 })
  // Pinned contracts and decisions get up to half the budget first; the newest other notes fill the rest.
  const first = boundedLines(pinned, Math.floor(args.maxMemoryChars / 2))
  const second = boundedLines(rest, args.maxMemoryChars - first.used)
  const out = []
  if (first.lines.length > 0) out.push('Pinned contracts and decisions:\n' + first.lines.join('\n'))
  if (second.lines.length > 0) out.push('Latest notes:\n' + second.lines.join('\n'))
  return out.join('\n')
}

function notesOfKind(kind, max) {
  return memory.entries.filter(function (e) { return e.kind === kind }).slice(-max).map(noteLine).join('\n')
}

function projectMapText() {
  return projectMap.text === '' ? '(no project map yet: inspect the workspace yourself, and read .hackdev/PROJECT_MAP.md if it exists)' : projectMap.text
}

/** Concurrency limiter: at most max thunks run at once; the rest queue in order. */
function makeLimiter(max) {
  let active = 0
  const waiting = []
  function next() { if (waiting.length > 0 && active < max) waiting.shift()() }
  return function (fn) {
    return new Promise(function (resolve, reject) {
      function run() {
        active += 1
        Promise.resolve().then(fn).then(
          function (v) { active -= 1; next(); resolve(v) },
          function (e) { active -= 1; next(); reject(e) },
        )
      }
      if (active < max) run(); else waiting.push(run)
    })
  }
}

const BOUNDED_AUTONOMY = [
  'Bounded autonomy rules (non-negotiable):',
  '- Work only inside the current workspace. Never run destructive or irreversible commands (recursive deletes outside build output, force-pushes, database drops, deploys, publishing packages, changing system or security settings).',
  '- If a step needs a human decision or approval, do NOT do it: list it in needsHuman and continue with the safe remainder.',
  '- Never print, log, commit or hard-code secrets. Read credentials from the environment only.',
  '- Never claim something works unless you ran it; evidence entries must name the command or check and its observed outcome.',
].join('\n')

const GROUNDING = [
  'Grounding rules (no hallucination):',
  '- Read a file before you edit it, and re-read the changed region afterwards. Never edit from memory.',
  '- Never invent APIs, packages, versions, CLI flags, config keys, file paths or results. Before relying on one, confirm it exists: open the source, check the installed package or lockfile, or run the tool with --help.',
  '- Cite concrete workspace-relative file paths (path:line where useful) in summaries, issues and evidence.',
  '- Evidence is the literal command you ran plus its observed result (exit code, pass/fail counts, the decisive output line). An expected outcome is not evidence.',
  '- If you are unsure, say so in the report instead of guessing. A fact-checker re-runs evidence and checks every file you list; false claims downgrade your work.',
].join('\n')

const SCOPE_DISCIPLINE = [
  'Scope discipline: fix defects and weaknesses in proportion to the mission. Do NOT add new product features or large subsystems the mission did not ask for (authentication systems, TLS, databases, new services, framework migrations). Prefer secure defaults, validation, escaping, headers and tests. When a real fix would need such an addition, do not build it: record the issue with status deferred, put a precise remediation in its title and the decision in needsHuman, so a human can approve it. Use status open only for problems you could fix but have not yet fixed.',
].join('\n')

const MEMORY_PROTOCOL = [
  'Shared memory protocol: other agents work beside you. Read .hackdev/PROJECT_MAP.md and .hackdev/MEMORY.md in the workspace if they exist. Publish what others need through memoryNotes, using the right kind: contract (an interface, schema, route, file format or command others must follow), decision (a design choice), fact (a non-obvious finding), risk, warning (something others must avoid), question (an open question for the gates or a human). You may also APPEND one short line per note to .hackdev/MEMORY.md (create the directory if missing; append only, never rewrite or delete other agents\' lines).',
].join('\n')

const VISUAL_PROTOCOL = [
  'VISUAL VERIFICATION protocol (required whenever the software has a UI: web page, SPA, dashboard, desktop window or TUI):',
  'a. Start it: open the HTML file directly (file:// URL) or start the dev/preview server on a free localhost port. Record the exact URL. Stop every process you start before you finish.',
  'b. Capture screenshots at desktop (1280x800) and mobile (390x844) widths into .hackdev/screenshots/. Use the first method that works and note which: (1) browser tools exposed to you (for example browser_navigate and a screenshot tool from a Playwright or Chrome DevTools provider); (2) an installed Chromium-family browser in headless mode, for example: chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1280,800 --screenshot=<absolute path>.png <url> (on Windows try "C:/Program Files/Google/Chrome/Application/chrome.exe" and "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; on macOS the app bundle binaries; on Linux chromium or google-chrome); (3) the project\'s own Playwright or Puppeteer if already installed. Also capture the rendered DOM (--dump-dom) and console errors (--enable-logging=stderr --v=1, or page console events).',
  'c. LOOK at every screenshot with the read_image tool (it shows you the image) and judge layout, overflow, overlap, alignment, spacing, contrast, legibility, empty/loading/error states, and whether the screen matches the mission. Record one uiEvidence entry per screenshot you actually viewed: viewport, artifact (the screenshot path), observation (what you saw).',
  'd. Exercise the main flows (fill forms, click buttons, submit invalid input, resize) through the browser tool or a headless script, and screenshot the resulting states too.',
  'e. If you cannot capture or view any screenshot, set uiVerified=false, leave uiEvidence empty and state in limitations exactly which method failed and its error. Never describe a screenshot you did not view.',
].join('\n')

const checkSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    outcome: { type: 'string', enum: ['pass', 'fail', 'skipped'] },
    detail: { type: 'string' },
  },
  required: ['name', 'outcome', 'detail'],
  additionalProperties: false,
}
const issueSchema = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: SEVERITIES },
    title: { type: 'string' },
    status: { type: 'string', enum: ['fixed', 'open', 'deferred'] },
  },
  required: ['severity', 'title', 'status'],
  additionalProperties: false,
}
const noteSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: NOTE_KINDS },
    text: { type: 'string' },
  },
  required: ['kind', 'text'],
  additionalProperties: false,
}
const uiEvidenceSchema = {
  type: 'object',
  properties: {
    viewport: { type: 'string' },
    artifact: { type: 'string' },
    observation: { type: 'string' },
  },
  required: ['viewport', 'artifact', 'observation'],
  additionalProperties: false,
}

const gateSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string' },
    checks: { type: 'array', items: checkSchema },
    issues: { type: 'array', items: issueSchema },
    filesChanged: { type: 'array', items: { type: 'string' } },
    hasUi: { type: 'boolean' },
    uiVerified: { type: 'boolean' },
    uiEvidence: { type: 'array', items: uiEvidenceSchema },
    limitations: { type: 'array', items: { type: 'string' } },
    needsHuman: { type: 'array', items: { type: 'string' } },
    memoryNotes: { type: 'array', items: noteSchema },
  },
  required: ['verdict', 'summary', 'checks', 'issues', 'filesChanged', 'hasUi', 'uiVerified', 'uiEvidence', 'limitations', 'needsHuman', 'memoryNotes'],
  additionalProperties: false,
}

const GATES = {
  verifier: {
    key: 'verifier',
    label: 'Verifier',
    role: 'You are the VERIFIER gate: the syntax, logic and runtime-error reviewer.',
    duty: [
      '1. Use the project map for the toolchain and commands; confirm them in the workspace (package.json, pyproject, Makefile, etc.).',
      '2. Run every available static check: install dependencies if missing, then build, typecheck, lint and the full test suite. Syntax and type errors count as issues.',
      '3. Actually RUN the software (start the server/CLI, hit its main endpoints or commands, run a smoke scenario) and watch for runtime errors, crashes, unhandled rejections and bad exit codes. Stop any long-running process you start.',
      '4. Read the changed code for logic errors: wrong conditions, off-by-one, unhandled null/empty/error paths, race conditions, broken imports, dead wiring between modules, and mismatches against the published contracts on the blackboard.',
      '5. FIX every issue you find directly in the code, then re-run the failing checks to prove the fix. Add or repair tests for any bug you fixed.',
    ].join('\n'),
  },
  quality: {
    key: 'quality',
    label: 'Quality and UX reviewer',
    role: 'You are the QUALITY and UI/UX gate: the code-quality reviewer and visual functional tester.',
    visual: true,
    duty: [
      '1. Review code quality: structure and separation of concerns, naming, duplication, dead code, error handling, consistency with the surrounding style, comments where intent is non-obvious, README accuracy.',
      '2. Follow the VISUAL VERIFICATION protocol below for any user interface. Check layout at desktop and mobile widths, spacing, contrast, readable text, broken or overlapping elements, empty/loading/error states, keyboard focus and basic accessibility (labels, alt text, headings).',
      '3. Click through the main user flows and verify the functionality works end to end, not just that the page renders. Try invalid input and edge cases.',
      '4. When no screenshot method works, still test with the best substitute you can run (DOM-level tests, a headless test runner, curl against rendered HTML) and state the visual limitation honestly. Set hasUi=false only if there truly is no UI.',
      '5. FIX every quality, UX and functional issue you find in the code, then re-verify visually or by test. Set uiVerified=true only with uiEvidence from screenshots you viewed.',
    ].join('\n'),
  },
  security: {
    key: 'security',
    label: 'Security reviewer',
    role: 'You are the SECURITY gate: an application-security reviewer who hardens what was built.',
    duty: [
      '1. Threat-model the software: entry points, trust boundaries, data stores, auth, third-party calls.',
      '2. Audit for: injection (SQL/NoSQL/command/template), XSS and unsafe HTML, CSRF, broken authentication and authorization (IDOR, missing checks), insecure session/cookie flags, hard-coded or logged secrets, path traversal and unsafe file handling, SSRF, unsafe deserialization, prototype pollution, open redirects, missing input validation and output encoding, missing rate limiting and request size limits, weak crypto or password hashing, permissive CORS, missing security headers (CSP, HSTS, X-Content-Type-Options, frame protections), verbose error leaks, vulnerable or unpinned dependencies (run the ecosystem audit command when available), and insecure defaults.',
      '3. FIX every weakness you can with small, well-tested changes that do not break behaviour: validation, parameterised queries, escaping, authz checks where the app already has users, security headers, secure cookie flags, safe defaults, and a .gitignore/.env.example so secrets never land in the repo. Add rate limiting or request limits only if they are a few lines; bigger additions are deferred (see scope discipline).',
      '4. Re-run the build and tests to make sure hardening did not break anything, and add regression tests for the vulnerabilities you closed.',
      '5. Anything you cannot fix safely or proportionately (needs infrastructure, a new subsystem or a human decision) is recorded as a deferred issue with a precise remediation in the title. Be honest: never claim the software cannot be hacked, report residual risk.',
    ].join('\n'),
  },
}

function validateGate(report, gate) {
  if (report === null || typeof report !== 'object') throw new Error(gate.label + ' returned no structured report')
  const issues = Array.isArray(report.issues) ? report.issues : []
  const checks = Array.isArray(report.checks) ? report.checks : []
  const open = issues.filter(function (i) { return i.status === 'open' })
  const passedChecks = checks.filter(function (c) { return c.outcome === 'pass' })
  const failedChecks = checks.filter(function (c) { return c.outcome === 'fail' })
  let verdict = report.verdict
  // A pass must be earned: evidence of at least one passing check, no failing checks, no open issues.
  if (verdict === 'pass' && (open.length > 0 || failedChecks.length > 0 || passedChecks.length === 0)) verdict = 'fail'
  const limitations = textList(report.limitations).map(function (s) { return clip(s, 300) }).slice(0, 10)
  const uiEvidence = (Array.isArray(report.uiEvidence) ? report.uiEvidence : [])
    .filter(function (e) { return e !== null && typeof e === 'object' && isText(e.artifact) && isText(e.observation) })
    .slice(0, 12)
    .map(function (e) { return { viewport: clip(isText(e.viewport) ? e.viewport : 'unspecified', 60), artifact: clip(e.artifact, 240), observation: clip(e.observation, 400) } })
  let uiVerified = report.uiVerified === true
  // Visual verification must be earned too: a claimed visual check needs at least one viewed screenshot.
  if (uiVerified && uiEvidence.length === 0) {
    uiVerified = false
    limitations.push('uiVerified was claimed without any viewed screenshot, so it is not counted')
  }
  return {
    gate: gate.label,
    verdict: verdict,
    summary: clip(report.summary, 1200),
    checks: checks.slice(0, 40).map(function (c) { return { name: clip(c.name, 160), outcome: c.outcome, detail: clip(c.detail, 300) } }),
    issues: issues.slice(0, 60).map(function (i) { return { severity: i.severity, title: clip(i.title, 300), status: i.status } }),
    filesChanged: textList(report.filesChanged).slice(0, 80),
    hasUi: report.hasUi === true,
    uiVerified: uiVerified,
    uiEvidence: uiEvidence,
    limitations: limitations,
    needsHuman: textList(report.needsHuman).map(function (s) { return clip(s, 300) }).slice(0, 10),
  }
}

function crashedRound(gate, round) {
  return { gate: gate.label, verdict: 'fail', summary: 'gate agent failed to produce a report', checks: [], issues: [{ severity: 'high', title: gate.label + ' agent crashed in round ' + round, status: 'open' }], filesChanged: [], hasUi: false, uiVerified: false, uiEvidence: [], limitations: [], needsHuman: [] }
}

function openIssueLines(report) {
  return report.issues.filter(function (i) { return i.status === 'open' }).map(function (i) { return '- [' + i.severity + '] ' + i.title }).join('\n')
}

function gatePrompt(gate, brief, roundText, mode) {
  return [
    gate.role,
    'Mission under review:\n' + clip(args.mission, 4000),
    'Project map:\n' + clip(projectMapText(), 3000),
    brief,
    'Shared blackboard so far:\n' + memoryText(),
    'Your duties:\n' + gate.duty,
    gate.visual === true ? VISUAL_PROTOCOL : '',
    mode === 'audit'
      ? 'AUDIT MODE (read-only): another gate is auditing the same workspace in parallel, so do NOT modify source files. You may install dependencies, run builds, tests and servers, and write screenshots or notes under .hackdev/. Report every issue you find with status open (or deferred per scope discipline); a later fix round will repair them.'
      : roundText,
    BOUNDED_AUTONOMY,
    GROUNDING,
    SCOPE_DISCIPLINE,
    MEMORY_PROTOCOL,
    'Return the structured report' + (mode === 'audit' ? '' : ' AFTER your fixes') + '. verdict=pass only if every check you ran passes and no issue remains open (deferred issues do not block a pass). List every issue you found (status fixed, open or deferred) and every file you changed. Be rigorous and honest; a gate that says pass without evidence is worse than one that says fail.',
  ].filter(function (s) { return s.length > 0 }).join('\n\n')
}

function gateOptions(gate, label) {
  const opts = { label: label, phase: 'Sentinel Gates', schema: gateSchema }
  // The visual gate can be routed to an image-capable model so read_image works on its screenshots.
  if (gate.visual === true && isText(args.visionModel)) opts.model = args.visionModel
  return opts
}

/** One read-only audit round; the result seeds the gate's fix loop. */
async function runAudit(gate, brief, label) {
  const raw = await agent(gatePrompt(gate, brief, '', 'audit'), gateOptions(gate, label + ' audit'))
  if (raw === null) return crashedRound(gate, 1)
  addNotes(gate.label, raw.memoryNotes)
  const report = validateGate(raw, gate)
  // An audit never owns code changes, even if the agent listed some.
  report.filesChanged = []
  return report
}

/**
 * One gate with a bounded review-fix-verify loop. Each round is a fresh child that
 * reviews, fixes and re-verifies. With a prior audit, the audit is round 1 and up
 * to maxFixRounds + 1 fix rounds follow while the gate still fails.
 */
async function runGate(gate, brief, label, prior) {
  const rounds = []
  let fixRounds = args.maxFixRounds + 1
  if (prior !== undefined) {
    rounds.push(prior)
    if (prior.verdict === 'pass') fixRounds = 0
  }
  for (let n = 1; n <= fixRounds; n += 1) {
    const round = rounds.length + 1
    const last = rounds.length === 0 ? null : rounds[rounds.length - 1]
    const roundText = last === null
      ? 'This is round 1.'
      : 'This is round ' + round + '. The previous round ended with verdict ' + last.verdict + ' and these OPEN issues you must now resolve:\n' + openIssueLines(last) + '\nRe-run the failing checks first.'
    const raw = await agent(gatePrompt(gate, brief, roundText, 'fix'), gateOptions(gate, label + ' round ' + round))
    if (raw === null) {
      rounds.push(crashedRound(gate, round))
      continue
    }
    const report = validateGate(raw, gate)
    addNotes(gate.label, raw.memoryNotes)
    rounds.push(report)
    if (report.verdict === 'pass') break
  }
  const final = rounds[rounds.length - 1]
  return {
    gate: gate.label,
    key: gate.key,
    verdict: final.verdict,
    rounds: rounds.length,
    final: final,
    fixedIssues: rounds.reduce(function (n, r) { return n + r.issues.filter(function (i) { return i.status === 'fixed' }).length }, 0),
    changedFiles: unique(rounds.reduce(function (acc, r) { return acc.concat(r.filesChanged) }, [])),
  }
}

/**
 * Verifier first (later gates need code that builds), then the quality/UX and
 * security audits run read-only in parallel; their fix loops run one after the
 * other so two gates never edit the same files at once. Later gates that change
 * code trigger one regression verifier pass; when nothing changed it is skipped.
 */
async function runGates(brief) {
  phase('Sentinel Gates')
  const results = []
  const verifier = await runGate(GATES.verifier, brief, 'Gate 1 Verifier')
  results.push(verifier)
  const afterVerifier = brief + '\n\nGate 1 (syntax/logic/runtime) result: ' + verifier.verdict + ' — ' + verifier.final.summary
  const audits = await parallel([
    function () { return runAudit(GATES.quality, afterVerifier, 'Gate 2 Quality+UX') },
    function () { return runAudit(GATES.security, afterVerifier, 'Gate 3 Security') },
  ])
  const qualityAudit = audits[0] === null ? crashedRound(GATES.quality, 1) : audits[0]
  const securityAudit = audits[1] === null ? crashedRound(GATES.security, 1) : audits[1]
  const quality = await runGate(GATES.quality, afterVerifier, 'Gate 2 Quality+UX', qualityAudit)
  results.push(quality)
  const securityBrief = afterVerifier + '\n\nGate 2 result: ' + quality.verdict + ' — ' + quality.final.summary
    + (quality.changedFiles.length === 0 ? '' : '\nGate 2 changed these files after your audit snapshot; re-check them:\n' + quality.changedFiles.slice(0, 40).join('\n'))
  const security = await runGate(GATES.security, securityBrief, 'Gate 3 Security', securityAudit)
  results.push(security)
  const changed = unique(quality.changedFiles.concat(security.changedFiles))
  if (changed.length > 0) {
    log('Later gates changed code; running a regression verifier pass')
    const regression = await runGate(GATES.verifier, brief + '\n\nThis is the FINAL REGRESSION pass: quality and security gates changed these files, so re-run build, typecheck, lint, tests and the smoke run to prove nothing broke:\n' + changed.slice(0, 80).join('\n'), 'Gate 4 Regression')
    regression.gate = 'Regression verifier'
    regression.key = 'regression'
    results.push(regression)
  }
  return results
}

function gatesPassed(results) {
  // Only the latest verdict per gate role counts: the regression pass supersedes the first verifier.
  const hasRegression = results.some(function (r) { return r.key === 'regression' })
  return results.every(function (r) { return (hasRegression && r.key === 'verifier') || r.verdict === 'pass' })
}

function collectNeedsHuman(results) {
  const out = []
  for (const r of results) for (const h of r.final.needsHuman) if (out.indexOf(h) < 0) out.push(h)
  return out
}

function gateSummaries(gates) {
  return gates.map(function (g) {
    return {
      gate: g.gate, verdict: g.verdict, rounds: g.rounds, fixedIssues: g.fixedIssues, summary: g.final.summary,
      checks: g.final.checks, issues: g.final.issues, hasUi: g.final.hasUi, uiVerified: g.final.uiVerified,
      uiEvidence: g.final.uiEvidence, limitations: g.final.limitations,
    }
  })
}

async function chronicle(report) {
  phase('Chronicle')
  const prompt = [
    'You are the CHRONICLER. Persist the run record to the workspace. Do not change any source code.',
    '1. Write .hackdev/RUN_REPORT.md: a clear human-readable report with sections Mission, Plan and team, Waves, Tasks (owner role, status, fact-check result, evidence), Acceptance criteria (met or unmet with evidence), Quality gates (per gate: verdict, checks, issues found/fixed/open, screenshots viewed, limitations), Security posture and residual risk, Items needing human approval, and Known limitations. Use the exact data below; do not invent results.',
    '2. Update .hackdev/MEMORY.md, the long-term memory future runs read first: keep it as a list of one-line entries, merge the entries below, DROP exact and near duplicates, keep every still-valid contract and decision, and if the file would exceed ' + args.maxMemoryChars + ' characters compact the oldest facts into a short "Earlier runs" summary paragraph. Finish with a dated "Run summary" line.',
    '3. Update .hackdev/PROGRESS.md: the progress ledger a rerun resumes from. List every task with status, every acceptance criterion with met/unmet, and the remaining work as concrete next tasks.',
    'Run data (JSON):\n' + clip(JSON.stringify(report), 24000),
    'Shared memory entries (JSON):\n' + clip(JSON.stringify(memory.entries), 8000),
    'Reply with the single line: recorded.',
  ].join('\n\n')
  const out = await agent(prompt, { label: 'Chronicler', phase: 'Chronicle' })
  return out !== null
}
`

/** Full pipeline: council, waves of forge + fact-check + gates + integrator, chronicle. */
export const HACKDEV_SCRIPT = LIBRARY + String.raw`

const PLAN_TASK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const ROLES = ['frontend', 'backend', 'fullstack', 'data', 'api', 'infra', 'test', 'docs', 'design', 'security', 'other']
const ROLE_FOCUS = {
  frontend: 'You are a senior FRONTEND engineer: semantic accessible markup, responsive layout, state handling, no console errors.',
  backend: 'You are a senior BACKEND engineer: correct domain logic, validation at boundaries, error handling, persistence and concurrency safety.',
  fullstack: 'You are a senior FULL-STACK engineer: keep the UI and server contracts consistent end to end.',
  data: 'You are a senior DATA engineer: schemas, migrations, data integrity and efficient queries.',
  api: 'You are a senior API engineer: precise request/response contracts, status codes, validation and versioning.',
  infra: 'You are a senior BUILD and INFRA engineer: reproducible scripts, configuration and developer tooling.',
  test: 'You are a senior TEST engineer: meaningful automated tests that would catch real regressions, deterministic and fast.',
  docs: 'You are a senior TECHNICAL WRITER who also codes: accurate README, setup, usage, architecture and limitations, verified against the code.',
  design: 'You are a senior UI/UX DESIGNER who codes: visual hierarchy, spacing, typography, color contrast and interaction states.',
  security: 'You are a senior SECURITY engineer building safe defaults: validation, escaping, secrets hygiene.',
  other: 'You are a senior software engineer.',
}
const FOLLOW_UP_CAP = 8
const SUBTASK_CAP = 4

const taskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    role: { type: 'string', enum: ROLES },
    description: { type: 'string' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    ownedPaths: { type: 'array', items: { type: 'string' } },
    acceptance: { type: 'string' },
  },
  required: ['id', 'title', 'role', 'description', 'dependsOn', 'ownedPaths', 'acceptance'],
  additionalProperties: false,
}

/** Validate a task list: ids, fields, dependencies inside the list, acyclic graph, and size cap. */
function validateTasks(tasks, cap, reservedIds) {
  const errors = []
  if (!Array.isArray(tasks)) return ['plan has no tasks array']
  if (tasks.length < 1) errors.push('plan needs at least one task')
  if (tasks.length > cap) errors.push('plan has ' + tasks.length + ' tasks; the limit is ' + cap + ' — merge related tasks')
  const ids = {}
  for (const t of tasks) {
    if (t === null || typeof t !== 'object') { errors.push('a task is not an object'); continue }
    if (typeof t.id !== 'string' || !PLAN_TASK_ID.test(t.id)) errors.push('task id "' + t.id + '" must be lowercase kebab-case (a-z, 0-9, -), max 40 chars')
    else if (ids[t.id] || reservedIds[t.id]) errors.push('duplicate task id ' + t.id)
    else ids[t.id] = true
    if (!isText(t.title) || !isText(t.description) || !isText(t.acceptance)) errors.push('task ' + t.id + ' needs a title, description and acceptance criteria')
    if (!Array.isArray(t.dependsOn)) t.dependsOn = []
    if (!Array.isArray(t.ownedPaths)) t.ownedPaths = []
    if (ROLES.indexOf(t.role) < 0) t.role = 'fullstack'
  }
  if (errors.length > 0) return errors
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (!ids[d]) errors.push('task ' + t.id + ' depends on unknown task ' + d)
      if (d === t.id) errors.push('task ' + t.id + ' depends on itself')
    }
  }
  if (errors.length === 0) {
    // Kahn's algorithm: every task must be schedulable, so the graph must be acyclic.
    const indegree = {}
    for (const t of tasks) indegree[t.id] = t.dependsOn.length
    const queue = tasks.filter(function (t) { return t.dependsOn.length === 0 }).map(function (t) { return t.id })
    let seen = 0
    while (queue.length > 0) {
      const id = queue.shift()
      seen += 1
      for (const t of tasks) if (t.dependsOn.indexOf(id) >= 0) { indegree[t.id] -= 1; if (indegree[t.id] === 0) queue.push(t.id) }
    }
    if (seen !== tasks.length) errors.push('task dependencies contain a cycle')
  }
  return errors
}

function validatePlan(plan) {
  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.tasks)) return ['plan has no tasks array']
  return validateTasks(plan.tasks, args.maxTasks, {})
}

const planSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    complexity: { type: 'string', enum: ['trivial', 'small', 'medium', 'large'] },
    requirements: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    stack: { type: 'string' },
    contracts: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: taskSchema },
  },
  required: ['summary', 'complexity', 'requirements', 'acceptanceCriteria', 'stack', 'contracts', 'tasks'],
  additionalProperties: false,
}

const projectMapSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    stack: { type: 'string' },
    hasUi: { type: 'boolean' },
    entryPoints: { type: 'array', items: { type: 'string' } },
    commands: { type: 'array', items: { type: 'string' } },
    conventions: { type: 'array', items: { type: 'string' } },
    keyFiles: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    priorProgress: { type: 'string' },
  },
  required: ['summary', 'stack', 'hasUi', 'entryPoints', 'commands', 'conventions', 'keyFiles', 'risks', 'priorProgress'],
  additionalProperties: false,
}

const workerSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    handoff: { type: 'string' },
    memoryNotes: { type: 'array', items: noteSchema },
    followUps: { type: 'array', items: { type: 'string' } },
    needsHuman: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'filesChanged', 'evidence', 'handoff', 'memoryNotes', 'followUps', 'needsHuman'],
  additionalProperties: false,
}

const splitSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
    subtasks: { type: 'array', items: taskSchema },
  },
  required: ['reason', 'subtasks'],
  additionalProperties: false,
}

const factCheckSchema = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          missingFiles: { type: 'array', items: { type: 'string' } },
          evidenceConfirmed: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['id', 'missingFiles', 'evidenceConfirmed', 'note'],
        additionalProperties: false,
      },
    },
    commandsRun: { type: 'array', items: { type: 'string' } },
  },
  required: ['tasks', 'commandsRun'],
  additionalProperties: false,
}

const integratorSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['criterion', 'met', 'evidence'],
        additionalProperties: false,
      },
    },
    followUpTasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          role: { type: 'string', enum: ROLES },
          description: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
          ownedPaths: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'string' },
          replaces: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'role', 'description', 'dependsOn', 'ownedPaths', 'acceptance', 'replaces'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'criteria', 'followUpTasks'],
  additionalProperties: false,
}

const missionText = clip(args.mission, 6000)

// ---------------------------------------------------------------- Council
phase("Shogun's Council")
const advisorOutputs = await parallel([
  function () {
    return agent([
      'You are the REQUIREMENTS ANALYST on the planning council. Read-only: do not modify files.',
      'Mission:\n' + missionText,
      'Produce: (1) the explicit requirements, (2) implicit requirements a user would expect (error handling, validation, responsive UI, accessibility, security, tests, docs), (3) measurable acceptance criteria, each checkable by running something, (4) ambiguities with the assumption you chose for each, (5) an honest complexity estimate (trivial, small, medium or large) with the main components. Be concise and concrete.',
    ].join('\n\n'), { label: 'Council: requirements analyst', phase: "Shogun's Council" })
  },
  function () {
    return agent([
      'You are the CODEBASE SCOUT on the planning council. Do not modify source files; the only file you may write is .hackdev/PROJECT_MAP.md.',
      'Mission:\n' + missionText,
      'Inspect the workspace and build the PROJECT MAP every other agent will receive: what the project is, stack and versions actually installed, whether it has a UI, entry points, the exact install/build/test/run/lint commands (verified to exist, for example in package.json scripts), conventions (layout, naming, style, test framework), the key files a newcomer must read, and risks.',
      'Read .hackdev/MEMORY.md (long-term memory from earlier runs) and .hackdev/PROGRESS.md (the ledger of an earlier, possibly unfinished run) if they exist, and summarize in priorProgress what was already completed and what remains, so the planner resumes instead of restarting. Write priorProgress as "none" when there is no ledger.',
      'If the workspace is empty, say so and recommend a lean, mainstream stack with a one-line justification.',
      'Write the map as markdown to .hackdev/PROJECT_MAP.md (create the directory if missing), then return it as the structured report. ' + GROUNDING,
    ].join('\n\n'), { label: 'Council: codebase scout', phase: "Shogun's Council", schema: projectMapSchema })
  },
])
const analysis = advisorOutputs[0] === null ? '(analyst unavailable)' : clip(advisorOutputs[0], 5000)
const scout = advisorOutputs[1]
let recon = '(scout unavailable)'
if (scout !== null && typeof scout === 'object' && isText(scout.summary)) {
  const listed = function (title, list, max) { const items = textList(list).slice(0, max); return items.length === 0 ? '' : title + ':\n' + items.map(function (s) { return '- ' + clip(s, 240) }).join('\n') }
  projectMap.text = [
    'Summary: ' + clip(scout.summary, 800),
    'Stack: ' + clip(scout.stack, 300),
    'Has UI: ' + (scout.hasUi === true ? 'yes' : 'no'),
    listed('Entry points', scout.entryPoints, 12),
    listed('Commands', scout.commands, 12),
    listed('Conventions', scout.conventions, 12),
    listed('Key files', scout.keyFiles, 20),
    listed('Risks', scout.risks, 10),
    isText(scout.priorProgress) && scout.priorProgress.trim().toLowerCase() !== 'none' ? 'Prior progress (resume from here):\n' + clip(scout.priorProgress, 1500) : '',
  ].filter(function (s) { return s.length > 0 }).join('\n')
  recon = projectMap.text
} else if (isText(scout)) {
  recon = clip(scout, 5000)
  projectMap.text = recon
}

let plan = null
let planErrors = []
for (let attempt = 1; attempt <= 2 && plan === null; attempt += 1) {
  const raw = await agent([
    'You are the PLANNER, the head of the planning council and the lead of the build team. Read-only: do not modify files.',
    'Mission:\n' + missionText,
    'Requirements analysis:\n' + analysis,
    'Project map from the scout:\n' + recon,
    'Assemble the build TEAM for this mission: break it into at most ' + args.maxTasks + ' independently verifiable tasks that specialist builder agents execute IN PARALLEL (up to ' + args.maxParallel + ' at a time). Rules:',
    '- Size the team to the mission: trivial change 1-2 tasks; small app 3-6; medium product 6-14; large system up to the limit. Prefer more, smaller tasks over few large ones whenever they can run in parallel; one task should be one specialist\'s focused sitting (roughly a few hundred lines of change at most).',
    '- Give each task a role (frontend, backend, fullstack, data, api, infra, test, docs, design, security, other) so the right specialist builds it.',
    '- Give each task a lowercase kebab-case id, a precise description a builder can execute without asking questions, and acceptance criteria that can be checked by running something.',
    '- Give each task disjoint ownedPaths (files or directories only that task may edit) so parallel builders never collide. Shared files (package manifests, route tables, config) belong to exactly one early task whose output others depend on.',
    '- Use dependsOn only for real ordering needs (for example a data model before the API that uses it). Prefer wide, shallow graphs: maximise parallelism. The graph must be acyclic.',
    '- Include tasks for tests and for README/documentation (architecture, setup, usage, limitations). Do not include review or security-audit tasks: dedicated gate agents run after building.',
    '- Put every shared interface (API routes, data shapes, file formats, component props, CLI flags) in contracts, one per entry, so every builder follows the same conventions.',
    '- If the project map shows prior progress, plan ONLY the remaining work and do not redo completed tasks.',
    planErrors.length === 0 ? '' : 'Your previous plan was rejected for these reasons; fix them:\n- ' + planErrors.join('\n- '),
  ].filter(function (s) { return s.length > 0 }).join('\n\n'), { label: 'Council: planner (attempt ' + attempt + ')', phase: "Shogun's Council", schema: planSchema })
  if (raw === null) { planErrors = ['the planner agent failed']; continue }
  const errors = validatePlan(raw)
  if (errors.length === 0) plan = raw
  else planErrors = errors
}
let planFallback = false
if (plan === null) {
  planFallback = true
  log('Planner could not produce a valid plan (' + planErrors.join('; ') + '); falling back to one task')
  plan = {
    summary: 'Fallback single-task plan', complexity: 'small', requirements: [], acceptanceCriteria: [], stack: 'as appropriate to the mission', contracts: [],
    tasks: [{ id: 'mission', title: 'Complete the mission', role: 'fullstack', description: missionText, dependsOn: [], ownedPaths: [], acceptance: 'The mission requirements are met and verified.' }],
  }
}
if (!Array.isArray(plan.contracts)) plan.contracts = []
if (!Array.isArray(plan.acceptanceCriteria)) plan.acceptanceCriteria = []
addNotes('planner', [{ kind: 'decision', text: 'Plan (' + (isText(plan.complexity) ? plan.complexity : 'unsized') + ', ' + plan.tasks.length + ' tasks): ' + plan.summary + ' Stack: ' + plan.stack }])
addNotes('planner', textList(plan.contracts).slice(0, 20).map(function (c) { return { kind: 'contract', text: c } }))

// ------------------------------------------------------------------ Forge
const allTasks = []
const allResults = []
const resultById = {}
const limit = makeLimiter(args.maxParallel)

function taskOverview(tasks, current) {
  return tasks.map(function (t) {
    return '- ' + t.id + (t.id === current ? ' (YOU)' : '') + ' [' + t.role + ']: ' + t.title + ' | owns: ' + (t.ownedPaths.length === 0 ? 'unspecified' : t.ownedPaths.join(', ')) + ' | after: ' + (t.dependsOn.length === 0 ? 'nothing' : t.dependsOn.join(', '))
  }).join('\n')
}

function validateWorker(raw, task, wave) {
  const evidence = textList(raw.evidence).map(function (s) { return clip(s, 300) }).slice(0, 20)
  let status = ['done', 'partial', 'blocked'].indexOf(raw.status) >= 0 ? raw.status : 'partial'
  // Evidence-based completion: a task is only done when it carries evidence.
  if (status === 'done' && evidence.length === 0) status = 'partial'
  return {
    id: task.id,
    title: task.title,
    role: task.role,
    wave: wave,
    status: status,
    summary: clip(raw.summary, 1000),
    filesChanged: textList(raw.filesChanged).slice(0, 60),
    evidence: evidence,
    handoff: isText(raw.handoff) ? clip(raw.handoff.trim(), 1200) : '',
    verified: null,
    followUps: textList(raw.followUps).map(function (s) { return clip(s, 300) }).slice(0, 10),
    needsHuman: textList(raw.needsHuman).map(function (s) { return clip(s, 300) }).slice(0, 10),
  }
}

function failedResult(task, wave, status, summary) {
  return { id: task.id, title: task.title, role: task.role, wave: wave, status: status, summary: summary, filesChanged: [], evidence: [], handoff: '', verified: null, followUps: [], needsHuman: [] }
}

function builderPrompt(task, tasks, depResults, extra) {
  return [
    (ROLE_FOCUS[task.role] || ROLE_FOCUS.other) + ' You are a BUILDER in a parallel build team. Implement exactly one task of a larger plan, completely and correctly.',
    'Overall mission:\n' + missionText,
    'Project map:\n' + clip(projectMapText(), 3000),
    'Plan summary and conventions:\n' + clip(plan.summary, 2000) + '\nStack: ' + clip(plan.stack, 400),
    'Tasks in this wave (so you know who owns what):\n' + taskOverview(tasks, task.id),
    'YOUR TASK ' + task.id + ': ' + task.title + '\n' + task.description + '\nAcceptance: ' + task.acceptance + '\nOnly edit files within your ownedPaths (' + (task.ownedPaths.length === 0 ? 'none specified: keep changes minimal and tightly scoped' : task.ownedPaths.join(', ')) + '). If you must touch a file another task owns, make the smallest possible change and publish a warning note.',
    depResults.length === 0 ? '' : 'Handoff from the tasks you depend on (build on these exactly):\n' + depResults.map(function (r) { return '- ' + r.id + ' [' + r.status + ']: ' + clip(r.summary, 400) + (r.handoff === '' ? '' : '\n  handoff: ' + clip(r.handoff, 800)) + '\n  files: ' + r.filesChanged.slice(0, 15).join(', ') }).join('\n'),
    'Shared blackboard (contracts, decisions, warnings and facts from other agents):\n' + memoryText(),
    'Method: inspect the workspace first, implement with production-quality code (input validation, error handling, no placeholders or TODO stubs), then VERIFY what you built by running it or its tests. Write tests for your code. Do not run the full-project quality review: dedicated gate agents do that later.',
    BOUNDED_AUTONOMY,
    GROUNDING,
    MEMORY_PROTOCOL,
    extra,
    'Return status done only when the acceptance criteria are met and you ran something to prove it; list the evidence (command and observed outcome). Use partial if some work remains and blocked only when no progress is possible. In handoff, tell dependents and reviewers exactly what you produced: public interfaces, routes, file locations, how to run and test it, and caveats.',
  ].filter(function (s) { return s.length > 0 }).join('\n\n')
}

async function buildOnce(task, tasks, depResults, extra, label, wave) {
  const raw = await limit(function () { return agent(builderPrompt(task, tasks, depResults, extra), { label: label, phase: 'Forge', schema: workerSchema }) })
  if (raw === null || typeof raw !== 'object') return null
  addNotes(task.id, raw.memoryNotes)
  const result = validateWorker(raw, task, wave)
  if (result.handoff !== '') addNotes(task.id, [{ kind: 'handoff', text: result.handoff }])
  return result
}

/** Nested decomposition: split unfinished work into ordered subtasks inside the parent's ownership. */
async function splitTask(task, previous, failure) {
  const raw = await agent([
    'You are the TEAM LEAD re-planning one task that did not finish. Read-only: inspect the workspace to see what was already done, do not modify files.',
    'Mission:\n' + missionText,
    'Project map:\n' + clip(projectMapText(), 2000),
    'Task ' + task.id + ' [' + task.role + ']: ' + task.title + '\n' + task.description + '\nAcceptance: ' + task.acceptance + '\nOwned paths: ' + (task.ownedPaths.length === 0 ? 'unspecified' : task.ownedPaths.join(', ')),
    'What happened: ' + failure + (previous === null ? '' : '\nLast report: ' + clip(previous.summary, 800)),
    'Split the REMAINING work into 2-' + SUBTASK_CAP + ' smaller subtasks that run in order, each with a lowercase kebab-case id, a role, a precise description, ownedPaths inside the parent\'s owned paths, and checkable acceptance. Use dependsOn only between these subtasks. Do not repeat work that is already done.',
    GROUNDING,
  ].join('\n\n'), { label: 'Splitter: ' + task.id, phase: 'Forge', schema: splitSchema })
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.subtasks)) return null
  const subtasks = raw.subtasks.slice(0, SUBTASK_CAP).filter(function (s) { return s !== null && typeof s === 'object' })
  if (subtasks.length < 2) return null
  // Prefix subtask ids with the parent id so they stay unique across the run, and rewrite dependencies to match.
  const scoped = function (id) { return String(id).toLowerCase().indexOf(task.id + '-') === 0 ? String(id).toLowerCase() : (task.id + '-' + String(id).toLowerCase()).replace(/[^a-z0-9-]/g, '-').slice(0, 40) }
  for (const s of subtasks) {
    s.id = scoped(s.id)
    s.dependsOn = Array.isArray(s.dependsOn) ? s.dependsOn.map(scoped) : []
  }
  const reserved = {}
  for (const t of allTasks) reserved[t.id] = true
  const errors = validateTasks(subtasks, SUBTASK_CAP, reserved)
  if (errors.length > 0) { log('Splitter for ' + task.id + ' produced an invalid split: ' + errors.join('; ')); return null }
  return subtasks
}

async function runSubtasks(task, subtasks, depResults, wave) {
  const done = []
  for (const sub of subtasks) {
    const subDeps = depResults.concat(done.filter(function (r) { return sub.dependsOn.indexOf(r.id) >= 0 }))
    const r = await buildOnce(sub, subtasks, subDeps, 'This is a SUBTASK of ' + task.id + ' (' + task.title + '); an earlier attempt did not finish it, so continue from what is already in the workspace.', 'Builder: ' + sub.id + ' (subtask)', wave)
    done.push(r === null ? failedResult(sub, wave, 'failed', 'Subtask builder crashed or returned no report') : r)
    if (r === null || r.status === 'blocked') break
  }
  const allDone = done.length === subtasks.length && done.every(function (r) { return r.status === 'done' })
  return {
    id: task.id,
    title: task.title,
    role: task.role,
    wave: wave,
    status: allDone ? 'done' : done.some(function (r) { return r.status === 'done' || r.status === 'partial' }) ? 'partial' : 'failed',
    summary: clip('Split into ' + subtasks.length + ' subtasks: ' + done.map(function (r) { return r.id + ' [' + r.status + '] ' + r.summary }).join(' | '), 1000),
    filesChanged: unique(done.reduce(function (acc, r) { return acc.concat(r.filesChanged) }, [])).slice(0, 60),
    evidence: done.reduce(function (acc, r) { return acc.concat(r.evidence) }, []).slice(0, 20),
    handoff: clip(done.map(function (r) { return r.handoff }).filter(isText).join('\n'), 1200),
    verified: null,
    subtasks: done.length,
    followUps: unique(done.reduce(function (acc, r) { return acc.concat(r.followUps) }, [])).slice(0, 10),
    needsHuman: unique(done.reduce(function (acc, r) { return acc.concat(r.needsHuman) }, [])).slice(0, 10),
  }
}

async function runTask(task, tasks, promises, wave) {
  const depResults = await Promise.all(task.dependsOn.map(function (d) { return promises[d] }))
  const failedDep = depResults.find(function (r) { return r.status === 'failed' || r.status === 'blocked' || r.status === 'skipped' })
  if (failedDep !== undefined) return failedResult(task, wave, 'skipped', 'Skipped because dependency ' + failedDep.id + ' ' + failedDep.status)
  const first = await buildOnce(task, tasks, depResults, '', 'Builder: ' + task.id, wave)
  if (first !== null && first.status === 'done') return first
  // Blocked on a human decision: re-planning cannot help, so surface it.
  if (first !== null && first.status === 'blocked' && first.needsHuman.length > 0) return first
  const failure = first === null ? 'the builder crashed or returned no report' : 'the builder reported ' + first.status
  const subtasks = await splitTask(task, first, failure)
  if (subtasks !== null) return runSubtasks(task, subtasks, depResults, wave)
  // No usable split: one plain retry that continues from the workspace.
  const retry = await buildOnce(task, tasks, depResults, 'A previous attempt did not finish (' + failure + '). Inspect what was already done in the workspace and continue from there.', 'Builder: ' + task.id + ' (retry)', wave)
  if (retry !== null) return retry
  return first !== null ? first : failedResult(task, wave, 'failed', 'Builder failed twice: ' + failure)
}

/** Dependency-driven scheduling with no barriers: a task starts the moment its dependencies settle and a slot is free. */
async function runForge(tasks, wave) {
  phase('Forge')
  const promises = {}
  for (const task of tasks) promises[task.id] = runTask(task, tasks, promises, wave)
  return Promise.all(tasks.map(function (t) { return promises[t.id] }))
}

/** Re-check claimed files and evidence; unverifiable claims downgrade a done task to partial. */
async function factCheck(results, wave) {
  const claims = results.filter(function (r) { return r.status === 'done' || r.status === 'partial' })
  if (claims.length === 0) return
  phase('Fact-check')
  const raw = await agent([
    'You are the FACT-CHECKER. Builders claimed the work below. Verify the claims against the real workspace; do not modify source files.',
    'For every task: (1) check that each listed file exists (list or stat it) and report the missing ones; (2) re-run the cheapest decisive evidence command(s) (tests, build, a smoke run) — at most 8 commands in total across all tasks — and set evidenceConfirmed=false when a claimed result does not reproduce or the evidence is not a real command and outcome. Put the commands you ran in commandsRun.',
    'Claims (JSON):\n' + clip(JSON.stringify(claims.map(function (r) { return { id: r.id, status: r.status, filesChanged: r.filesChanged.slice(0, 30), evidence: r.evidence.slice(0, 8) } })), 12000),
    GROUNDING,
  ].join('\n\n'), { label: 'Fact-checker (wave ' + wave + ')', phase: 'Fact-check', schema: factCheckSchema })
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.tasks)) { log('Fact-checker unavailable; claims stay unverified'); return }
  for (const r of claims) {
    const verdict = raw.tasks.find(function (t) { return t !== null && typeof t === 'object' && t.id === r.id })
    if (verdict === undefined) continue
    const missing = textList(verdict.missingFiles)
    r.verified = missing.length === 0 && verdict.evidenceConfirmed === true
    if (!r.verified) {
      if (r.status === 'done') r.status = 'partial'
      r.summary = clip(r.summary + ' [fact-check: ' + (missing.length > 0 ? 'missing ' + missing.slice(0, 5).join(', ') + '; ' : '') + (verdict.evidenceConfirmed === true ? 'evidence reproduced' : 'evidence not reproduced') + (isText(verdict.note) ? '; ' + clip(verdict.note, 200) : '') + ']', 1200)
      addNotes('fact-checker', [{ kind: 'warning', text: 'Task ' + r.id + ' claims did not verify: ' + (missing.length > 0 ? 'missing files ' + missing.slice(0, 5).join(', ') : 'evidence not reproduced') }])
    }
  }
}

function gateBrief(results) {
  const questions = notesOfKind('question', 12)
  return [
    'Plan summary: ' + clip(plan.summary, 1500),
    'Acceptance criteria:\n' + plan.acceptanceCriteria.map(function (c) { return '- ' + clip(c, 300) }).join('\n'),
    'Builder results and handoff notes:\n' + results.map(function (r) { return '- ' + r.id + ' [' + r.role + ', ' + r.status + (r.verified === false ? ', fact-check failed' : '') + ']: ' + clip(r.summary, 400) + (r.handoff === '' ? '' : '\n  handoff: ' + clip(r.handoff, 500)) + '\n  files: ' + r.filesChanged.slice(0, 12).join(', ') }).join('\n'),
    questions === '' ? '' : 'Open questions builders raised (answer or resolve them where they affect your gate):\n' + questions,
  ].filter(function (s) { return s.length > 0 }).join('\n\n')
}

/** Check every acceptance criterion against evidence; unmet ones become follow-up tasks for the next wave. */
async function integrate(gates, wave, isLastWave) {
  phase('Integrator')
  const unfinished = allResults.filter(function (r) { return r.status !== 'done' && !r.replaced })
  const raw = await agent([
    'You are the INTEGRATOR, the lead engineer accountable for the mission. Do not modify source files; the only file you may write is .hackdev/PROGRESS.md.',
    'Mission:\n' + missionText,
    'Project map:\n' + clip(projectMapText(), 2000),
    'Acceptance criteria:\n' + (plan.acceptanceCriteria.length === 0 ? '(none listed: derive them from the mission)' : plan.acceptanceCriteria.map(function (c) { return '- ' + clip(c, 300) }).join('\n')),
    'Tasks so far:\n' + allResults.map(function (r) { return '- ' + r.id + ' (wave ' + r.wave + ', ' + r.role + ') [' + r.status + (r.verified === false ? ', fact-check failed' : '') + ']: ' + clip(r.summary, 300) }).join('\n'),
    'Gate results:\n' + gates.map(function (g) { return '- ' + g.gate + ': ' + g.verdict + ' — ' + clip(g.final.summary, 400) + (openIssueLines(g.final) === '' ? '' : '\n' + openIssueLines(g.final)) }).join('\n'),
    'For EVERY acceptance criterion decide met or unmet, verifying in the workspace (run the check where cheap) and citing evidence. Then write .hackdev/PROGRESS.md: the progress ledger (tasks with status, criteria met/unmet, remaining work) a rerun resumes from.',
    isLastWave
      ? 'This is the last allowed wave: return followUpTasks as an empty list and describe remaining work in summary.'
      : 'If anything is unmet or unfinished (' + unfinished.length + ' unfinished tasks), propose at most ' + Math.min(args.maxTasks, FOLLOW_UP_CAP) + ' targeted followUpTasks for the next wave: new lowercase kebab-case ids, a role, precise description, disjoint ownedPaths, dependsOn only among the follow-ups, checkable acceptance, and in replaces the ids of earlier unfinished tasks each follow-up completes. Return an empty list when every criterion is met.',
    GROUNDING,
  ].join('\n\n'), { label: 'Integrator (wave ' + wave + ')', phase: 'Integrator', schema: integratorSchema })
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.criteria)) return null
  const criteria = raw.criteria
    .filter(function (c) { return c !== null && typeof c === 'object' && isText(c.criterion) })
    .slice(0, 40)
    .map(function (c) { return { criterion: clip(c.criterion, 300), met: c.met === true, evidence: clip(isText(c.evidence) ? c.evidence : '', 400) } })
  let followUps = isLastWave || !Array.isArray(raw.followUpTasks) ? [] : raw.followUpTasks.slice(0, Math.min(args.maxTasks, FOLLOW_UP_CAP))
  if (followUps.length > 0) {
    const reserved = {}
    for (const t of allTasks) reserved[t.id] = true
    const errors = validateTasks(followUps, Math.min(args.maxTasks, FOLLOW_UP_CAP), reserved)
    if (errors.length > 0) { log('Integrator proposed an invalid follow-up wave: ' + errors.join('; ')); followUps = [] }
  }
  return { summary: clip(isText(raw.summary) ? raw.summary : '', 1200), criteria: criteria, followUps: followUps }
}

// ------------------------------------------------------------------ Waves
let waveTasks = plan.tasks
let wave = 1
let gates = []
let criteria = []
let integration = null
for (;;) {
  for (const t of waveTasks) allTasks.push(t)
  const results = await runForge(waveTasks, wave)
  await factCheck(results, wave)
  for (const r of results) { allResults.push(r); resultById[r.id] = r }
  gates = await runGates(gateBrief(results))
  const isLastWave = wave >= args.maxWaves
  integration = await integrate(gates, wave, isLastWave)
  if (integration !== null) criteria = integration.criteria
  if (integration === null || integration.followUps.length === 0) break
  // The next wave: mark the unfinished tasks the follow-ups complete as replaced.
  for (const f of integration.followUps) {
    for (const id of textList(f.replaces)) if (resultById[id] !== undefined) resultById[id].replaced = true
    delete f.replaces
  }
  addNotes('integrator', [{ kind: 'decision', text: 'Wave ' + (wave + 1) + ' follows up on: ' + integration.followUps.map(function (f) { return f.id }).join(', ') }])
  waveTasks = integration.followUps
  wave += 1
}

const tasksOk = allResults.every(function (r) { return r.status === 'done' || r.replaced === true })
const gatesOk = gatesPassed(gates)
const criteriaOk = criteria.every(function (c) { return c.met })
const needsHuman = collectNeedsHuman(gates)
for (const r of allResults) for (const h of r.needsHuman) if (needsHuman.indexOf(h) < 0) needsHuman.push(h)

const report = {
  status: tasksOk && gatesOk && criteriaOk ? 'complete' : 'needs-attention',
  mission: missionText,
  planFallback: planFallback,
  plan: { summary: plan.summary, stack: plan.stack, requirements: plan.requirements, acceptanceCriteria: plan.acceptanceCriteria, complexity: isText(plan.complexity) ? plan.complexity : 'unsized' },
  waves: wave,
  tasks: allResults.map(function (r) {
    const out = { id: r.id, title: r.title, role: r.role, wave: r.wave, status: r.status, summary: r.summary, filesChanged: r.filesChanged, evidence: r.evidence, verified: r.verified, followUps: r.followUps, needsHuman: r.needsHuman }
    if (r.replaced === true) out.replaced = true
    if (typeof r.subtasks === 'number') out.subtasks = r.subtasks
    return out
  }),
  criteria: criteria,
  gates: gateSummaries(gates),
  needsHuman: needsHuman,
  memoryEntries: memory.entries.length,
}
report.recorded = await chronicle(report)
return report
`

/** Gates only: review-fix-verify the current workspace after edits made outside the pipeline. */
export const HACKDEV_REVIEW_SCRIPT = LIBRARY + String.raw`
const brief = args.focus === '' ? 'Review the whole workspace as it currently stands.' : 'Focus of this review: ' + clip(args.focus, 2000)
const gates = await runGates(brief)
const needsHuman = collectNeedsHuman(gates)
const report = {
  status: gatesPassed(gates) ? 'complete' : 'needs-attention',
  mission: clip(args.mission, 6000),
  planFallback: false,
  plan: { summary: 'Gate-only review', stack: '', requirements: [], acceptanceCriteria: [] },
  waves: 1,
  tasks: [],
  criteria: [],
  gates: gateSummaries(gates),
  needsHuman: needsHuman,
  memoryEntries: memory.entries.length,
}
report.recorded = await chronicle(report)
return report
`

/** Meta identity blocks for the engine's validation and progress UI. */
export const HACKDEV_META = {
  name: 'hackdev-mission',
  description: 'Plan a specialist team, build in parallel waves, fact-check, then pass verifier, quality/UX and security gates.',
  phases: [
    { title: "Shogun's Council", detail: 'Requirements analyst and codebase scout (project map) feed the planner, which sizes the team.' },
    { title: 'Forge', detail: 'Specialist builders run a dependency graph behind a concurrency cap, sharing a blackboard; unfinished tasks are re-split.' },
    { title: 'Fact-check', detail: 'Claimed files and evidence are re-verified; unverifiable work is downgraded.' },
    { title: 'Sentinel Gates', detail: 'Verifier, then parallel quality/UX (with screenshots) and security audits, serialized fixes, regression pass.' },
    { title: 'Integrator', detail: 'Every acceptance criterion is checked; unmet criteria start the next wave.' },
    { title: 'Chronicle', detail: 'Run report, progress ledger and long-term memory written to .hackdev/.' },
  ],
}

export const HACKDEV_REVIEW_META = {
  name: 'hackdev-review',
  description: 'Run the three Sentinel Gates (verifier, quality/UX, security) on the current workspace.',
  phases: [
    { title: 'Sentinel Gates', detail: 'Verifier, then parallel quality/UX (with screenshots) and security audits, serialized fixes, regression pass.' },
    { title: 'Chronicle', detail: 'Run report and long-term memory written to .hackdev/.' },
  ],
}
