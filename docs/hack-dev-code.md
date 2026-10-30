# Hack Dev Code: design and operations

Hack Dev Code is an autonomous multi-agent engineering system. A human gives it a mission; a planning council maps the project and sizes a team of specialist builder agents, the team builds in parallel waves over a shared blackboard, a fact-checker re-verifies every claim, three independent gate agents verify, review (with screenshots) and harden the result, and an integrator keeps iterating until every acceptance criterion is met or the wave budget is spent.

The orchestration is one plugin, `@hackdevcode/dsh-tool-hackdev` (`packages/hackdev/tool-hackdev`), that sits on two seams of the harness: `ctx.workflowEngine` (script-driven fan-out) and `ctx.subagents` (fresh structured-output children).

## Pipeline at a glance

```text
Council ──► [ Forge ─► Fact-check ─► Sentinel Gates ─► Integrator ] × waves ──► Chronicle
 map +        specialist     claims       verifier, then audits      criteria met?
 team         builders       re-run       in parallel, fixes in      no → follow-up
                                          series, regression         tasks = next wave
```

| Phase | Agents | What they do |
|---|---|---|
| Shogun's Council | Requirements analyst, codebase scout, planner | The scout writes the project map; the planner sizes the team and returns a validated task graph. |
| Forge | One specialist builder per task (capped parallelism), a splitter for unfinished tasks | Implement and test within owned paths; publish contracts, decisions, warnings and a handoff note. |
| Fact-check | One fact-checker per wave | Verifies listed files exist and re-runs the cheapest decisive evidence. |
| Sentinel Gates | Verifier, quality/UX reviewer, security reviewer, regression verifier | See below. |
| Integrator | One per wave | Judges every acceptance criterion against evidence; unmet ones become follow-up tasks. Writes `.hackdev/PROGRESS.md`. |
| Chronicle | Chronicler | Writes `.hackdev/RUN_REPORT.md`, `.hackdev/PROGRESS.md` and the compacted `.hackdev/MEMORY.md`. |

## Adaptive team

The planner is told to size the team to the mission: a trivial change gets one or two tasks, a small app three to six, a medium product six to fourteen, a large system up to `maxTasks` (default 24). It prefers more, smaller tasks whenever they can run in parallel, and assigns every task a **role** (`frontend`, `backend`, `fullstack`, `data`, `api`, `infra`, `test`, `docs`, `design`, `security`, `other`) so the builder gets the matching specialist brief. Every shared interface (routes, data shapes, file formats, component props, CLI flags) goes into the plan's `contracts`, which are pinned on the blackboard for every agent.

The plan is rejected and re-requested (with the reasons) when ids are not unique kebab-case, a dependency is unknown or self-referential, the graph has a cycle (Kahn's algorithm), the plan is empty, or it exceeds `maxTasks`. After two failed attempts the mission runs as a single task and the report says so.

**Concurrency.** Each task is a promise that awaits its dependencies, so independent tasks start together and a dependent starts the moment its last dependency settles. A limiter caps simultaneous builders at `maxParallel` (default 6); the engine's own `maxConcurrentAgents` is a second cap.

**Nested decomposition.** When a builder crashes or returns anything but `done` (and is not waiting on a human), a splitter inspects the workspace and splits the remaining work into two to four ordered subtasks with ids prefixed by the parent, owned paths inside the parent's, and acceptance of their own. Subtasks run in order, each receiving the previous one's handoff, and the parent reports their aggregate. Only when no valid split exists does the task get a plain retry.

## Long-horizon iteration (waves)

After a wave's builders, fact-check and gates settle, the **integrator** checks every acceptance criterion in the workspace (running the cheap checks) and returns `met` or `unmet` with evidence. If anything is unmet it proposes at most eight targeted follow-up tasks (new ids, roles, disjoint owned paths, `replaces` naming the unfinished tasks they complete). The script validates them like a plan, runs them as the next wave through the same Forge, fact-check and gates, and repeats until all criteria are met or `maxWaves` (default 3) is reached. The last allowed wave is told it is last and cannot spawn more.

The integrator also writes `.hackdev/PROGRESS.md`, a ledger of tasks, criteria and remaining work. The next run's scout reads it into the project map as `priorProgress`, and the planner is told to plan only the remaining work, so a rerun resumes instead of restarting. A task completed by a later wave is marked `replaced` and no longer counts against the run.

The run is `complete` only when every task is done (or replaced), every gate passes and every acceptance criterion is met.

## Communication: the blackboard

There is no free-form chat between agents. Communication is explicit, typed and auditable:

1. **Structured reports.** Builders, gates, the fact-checker and the integrator return JSON validated by a schema in the workflow engine, then re-validated by the script.
2. **Typed blackboard.** Agents publish notes of kind `contract`, `decision`, `fact`, `risk`, `warning`, `handoff` or `question`. Exact duplicates are dropped. `contract` and `decision` notes are **pinned**: they get up to half of `maxMemoryChars` first, so a flood of facts cannot push out an interface definition; the newest other notes fill the rest.
3. **Handoff notes.** Every builder returns a `handoff` (public interfaces, locations, how to run and test, caveats). A dependent builder's prompt receives each dependency's summary, files and handoff; the gates receive every builder's handoff and the open `question` notes.
4. **Workspace files.** Agents also append to `.hackdev/MEMORY.md`, which parallel builders read, and the scout's `.hackdev/PROJECT_MAP.md`.
5. **Ownership.** Disjoint `ownedPaths` stop parallel agents from overwriting each other; a cross-boundary edit must be published as a `warning`.

## Memory

- **Project map.** The scout inspects the workspace and returns a structured map (summary, stack with installed versions, whether there is a UI, entry points, verified commands, conventions, key files, risks, prior progress), also written to `.hackdev/PROJECT_MAP.md`. The script injects it into every builder, gate, splitter and integrator prompt, so the lead and every subagent share the same picture of the project instead of rediscovering it.
- **Long-term memory.** `.hackdev/MEMORY.md` persists across runs. The chronicler merges the run's blackboard entries into it, drops exact and near duplicates, keeps every still-valid contract and decision, and compacts the oldest facts into an "Earlier runs" paragraph when the file would exceed `maxMemoryChars`.
- **Progress ledger.** `.hackdev/PROGRESS.md`, described above.

## Anti-hallucination

- **Grounding rules in every builder and gate prompt:** read a file before editing it and re-read the change; never invent APIs, packages, versions, flags, paths or results (confirm by opening the source, checking the lockfile, or running `--help`); cite workspace-relative paths; evidence is the literal command and its observed result, never an expectation; say so when unsure.
- **Evidence-based completion.** A task reporting `done` without evidence is downgraded to `partial`.
- **Fact-check.** After each Forge, a fact-checker verifies that every listed file exists and re-runs the cheapest decisive evidence (at most eight commands). A task with a missing file or evidence that does not reproduce is downgraded from `done` to `partial`, marked `fact-check failed` in the report, and a `warning` is published so the gates see it.
- **Earned verdicts.** A gate `pass` is downgraded to `fail` unless at least one check passed and none failed and no issue is open. `uiVerified` is not accepted without viewed-screenshot evidence (see below).

## Quality gates

The **verifier** runs first because later gates need code that builds. Then the **quality/UX** and **security** gates *audit in parallel and read-only*: each reports issues without editing, so they cannot collide. Their fix loops then run one after the other (quality, then security, which is told which files quality changed). A gate stops at the first round whose verdict is `pass`, or after `maxFixRounds + 1` fix rounds; an audit that already passes skips the loop. If the quality or security gate changed files, one **regression verifier** pass runs and supersedes the first verifier; if nothing changed it is skipped.

**Scope discipline.** Gates fix defects in proportion to the mission and must not grow it. A fix that would need a new subsystem (authentication, TLS, a database) is recorded as a `deferred` issue with a precise remediation and a `needsHuman` entry: it does not block a pass and is printed under "Needs attention".

### Visual verification

The quality/UX gate carries a fixed protocol whenever the software has a UI:

1. Start it: open the HTML file (`file://`) or start the dev server on a free localhost port, and record the URL. Stop every process it starts.
2. Capture screenshots at desktop (1280x800) and mobile (390x844) into `.hackdev/screenshots/`, using the first method that works: browser tools exposed to the agent (a Playwright or Chrome DevTools MCP provider), an installed Chromium-family browser in headless mode (`--headless=new --screenshot=...`, with the usual Windows, macOS and Linux install paths), or the project's own Playwright/Puppeteer. It also captures the rendered DOM and console errors.
3. **Look** at every screenshot with the `read_image` tool and judge layout, overflow, overlap, spacing, contrast, legibility and the empty, loading and error states against the mission.
4. Exercise the main flows (forms, buttons, invalid input, resize) and screenshot the resulting states.
5. Report one `uiEvidence` entry per screenshot actually viewed (viewport, artifact path, observation).

The script enforces the claim: `uiVerified=true` without any `uiEvidence` is rejected and a limitation is added; with none, the report says `UI was NOT visually exercised` and why.

**Why the earlier UI gate could not see the UI.** The harness has real browser tooling, but none of it was available to a spawned gate: the browser-use providers (Playwright MCP, Chrome DevTools MCP, Stagehand) are experimental packages that must be mounted explicitly and are not in the bundled profiles; and `read_image` only works when the calling route declares image input. A gate that is told to "use any browser tool" therefore had nothing to call. The protocol above no longer depends on a mounted provider: a headless Chromium binary or the project's own Playwright, driven from the shell, is enough, and `read_image` works on the default route because the bundled `deepseek-flash` model declares `image` input. To use a different image-capable model, set `visionModel` (for example `deepseek-v4-flash-vision-exp`); only the quality/UX gate is routed to it. Mounting a browser-use provider in the profile still gives richer interaction when wanted (see `docs/subsystems/browser-use.md`).

## Failure handling

| Failure | Behaviour |
|---|---|
| Planner crash or invalid plan | One retry with reasons, then single-task fallback |
| Advisor or scout crash | Placeholder text; planning continues without a project map |
| Builder crash or non-`done` result | Splitter breaks the rest into ordered subtasks; if none is valid, one retry told to continue from the workspace; then `failed` |
| Builder blocked on a human decision | Not re-split; surfaced in `needsHuman` |
| Dependency failed, blocked or skipped | Dependent is `skipped`, not run blind |
| Builder says `done` without evidence | Downgraded to `partial` |
| Claimed file missing or evidence not reproduced | Fact-check downgrades `done` to `partial`; warning to the gates |
| Fix needs a new subsystem or human decision | Issue is `deferred`, surfaced for approval, does not block the gate |
| Gate agent crash | Recorded as an open high-severity issue, verdict `fail` |
| Integrator crash or invalid follow-up wave | No further wave; the run reports what it has |
| Total agent count | Hard cap computed from `maxTasks`, `maxFixRounds` and `maxWaves` (`agentBudget`), clamped to the engine ceiling (1000) |
| Cancellation | The parent turn's abort signal cancels the run and its children |

## Security and bounded autonomy

- Every agent prompt carries the same rules: workspace only, no destructive or irreversible actions, no secrets in code or logs, no unproven claims. Anything needing a human decision goes into `needsHuman`, which is printed at the top of the report.
- The pipeline script, schemas and gate order are fixed in `src/script.ts`; the calling model supplies only the mission text and numeric caps within deployment ceilings.
- Children run under the harness's existing sandbox and approval policy. The API key is read from `DEEPSEEK_API_KEY` or the credential store and is never written into prompts, reports or the repository.
- The security gate hardens what it builds (validation, escaping, authz checks, security headers, rate limits, secret hygiene, dependency audit) and writes regression tests. No process can guarantee that software "cannot be hacked"; the report lists residual risk instead.

## Web UI

In the Web app a mission shows up in two places, both driven by data the run already persists, so no new session event types exist:

- **Live progress.** `tool-hackdev` writes the same durable `tool-workflow/*` run records as the generic workflow tool, so the existing workflow-run chat node lists the phases (Shogun's Council, Forge, Fact-check, Sentinel Gates, Integrator, Chronicle) and every agent with its running, completed or failed state, and lets you open a running agent's session.
- **Result card.** `packages/hackdev/client-ui-hackdev` registers a card for the `hackdev` and `hackdev_review` tool calls. It reads the bounded `presentationMeta` stored on the tool result (`compactReport`, version 2, hard ceiling well under 100 KB, a few KB in practice) and shows a status tag, task, gate and criteria counts, a "Needs attention" list (unfinished tasks, unmet acceptance criteria, open issues, deferred decisions, human approvals; first 6 with a show-all toggle), the plan and wave count, the acceptance criteria with their evidence, per-task status with role, wave and fact-check result, and one collapsible section per gate with checks, issues by severity, the screenshots viewed, and limitations. Passed gates collapse; failed gates open. Version 1 payloads from earlier runs still render; an unknown version, or an error, falls back to the plain result text.

Web presets mount tools per agent, so `tool-hackdev` is declared in `packages/bundle/web-app/presets/*.patch.yml` (next to `tool-workflow`) and disabled at host level in `packages/bundle/web-app/cordis.patch.yml`.

## Configuration

`packages/bundle/base/cordis.patch.yml`, row `tool-hackdev` (the Web presets carry the same values):

| Option | Default | Meaning |
|---|---|---|
| `subagentProvider` | `spawn` | Fresh structured-output provider for every pipeline agent |
| `maxTasks` | 24 | Ceiling on planned tasks per wave |
| `maxParallel` | 6 | Builders running at the same time |
| `maxWaves` | 3 | Ceiling on build waves (follow-up waves for unmet criteria) |
| `maxFixRounds` | 2 | Extra review-fix rounds per gate |
| `maxMemoryChars` | 6000 | Blackboard characters injected into one prompt, and the `.hackdev/MEMORY.md` compaction target |
| `maxResultChars` | 16384 | Size of the report returned to the calling model |
| `visionModel` | empty | Optional image-capable model for the quality/UX gate; empty inherits the default route |

The `hackdev` tool also accepts per-call `maxTasks`, `maxWaves` and `maxFixRounds`, bounded by these ceilings.

## Evaluation scenarios

| Scenario | How to exercise it |
|---|---|
| Feature implementation | `hackdev` with "add X to this repository" in an existing project |
| Bug fix | `hackdev` with a failing test or reproduction in the mission |
| Test-driven recovery | Mission says tests are red; the verifier gate loops until green or reports open issues |
| Long-horizon build | A large mission: the planner sizes a bigger team, the integrator opens follow-up waves for unmet criteria |
| Resume after interruption | Run again in the same workspace; the scout reads `.hackdev/PROGRESS.md` and only the remaining work is planned |
| Security and code review | `hackdev_review` on an existing repository |
| Unexpected condition | Remove a dependency or break a build mid-run; the failure path above applies |

## Known limitations

- Quality depends on the underlying model. The gates add evidence and loops, not guarantees.
- Visual verification needs a headless browser binary, the project's own Playwright, or a mounted browser-use provider in the environment, and an image-capable route. Without them the report says the UI was not visually exercised.
- Parallel builders share one working directory. Disjoint `ownedPaths` make collisions unlikely but not impossible; the quality and security audits are read-only for the same reason.
- The blackboard is bounded; older non-pinned entries drop out of prompts (they remain in `.hackdev/MEMORY.md` until compacted).
- The fact-checker re-runs at most eight commands per wave, so it samples evidence rather than re-running everything.
