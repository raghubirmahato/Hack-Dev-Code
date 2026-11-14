---
description: "The Hack Dev Code mission pipeline: the hackdev, hackdev_swarm and hackdev_review tools that run fixed multi-agent build, swarm and gate-review workflows."
kind: "package-reference"
---

# @hackdevcode/dsh-tool-hackdev

## Summary

Three tools for the lead agent. `hackdev` runs a mission end to end: a council plans a team, specialist builders work in parallel waves, a fact-checker re-runs their evidence, gates verify, review and harden the result, and an integrator iterates until every acceptance criterion is met. `hackdev_swarm` runs a swarm: a coordinator briefs named workers that build in parallel and coordinate through one shared message board, while verifiers send problems back to the worker that wrote the code. `hackdev_review` runs only the gates on existing work. The full design is in [docs/hack-dev-code.md](../../../docs/hack-dev-code.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount the tool where agents run, with the workflow engine and subagents available:

```yaml
- id: tool-hackdev
  name: '@hackdevcode/dsh-tool-hackdev'
```

| Field | Default | Meaning |
|---|---|---|
| `subagentProvider` | `spawn` | Fresh structured-output provider for every pipeline agent |
| `maxTasks` | `24` | Ceiling on planned tasks per wave |
| `maxParallel` | `6` | Builder agents that may run at the same time |
| `maxWaves` | `3` | Ceiling on build waves per mission |
| `visionModel` | `''` | Image-capable model for the quality/UX gate; empty uses the default route |
| `maxFixRounds` | `2` | Review-fix rounds after the first review of each gate |
| `maxMemoryChars` | `6000` | Shared memory placed in any one agent prompt |
| `maxResultChars` | `16384` | Size of the report returned to the lead agent |
| `maxFactChecks` | `8` | Commands the fact-checker may re-run per wave |
| `builderIsolation` | `shared` | `shared` workspace with disjoint owned paths, or `worktree` per task merged back one at a time |
| `autonomy` | `full` | `full` acts without asking; `bounded` avoids destructive or irreversible actions and defers large additions to a person |
| `customInstructions` | `''` | Standing orders every pipeline agent follows |
| `models.planner` | `''` | Model for the council, splitter, integrator and swarm coordinator; empty inherits the conversation's model |
| `models.builder` | `''` | Model for builders, worktree and merge managers and swarm workers |
| `models.verifier` | `''` | Model for the gates, the fact-checker and swarm verifiers (`visionModel` still wins for the visual gate) |
| `maxWorkers` | `8` | Ceiling on workers in one swarm |
| `maxSwarmRounds` | `3` | Ceiling on swarm rounds: the first build plus the rounds that wake workers again |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Config, prompt sections, agent budgets and the three tool registrations |
| [src/script.ts](src/script.ts) | The shared script library (blackboard, gates, worktrees, chronicle), the task vocabulary, and the mission and review scripts the workflow engine runs |
| [src/swarm.ts](src/swarm.ts) | The swarm script: coordinator, message board, rounds of named workers and verifiers, monitor rule, final report |
| [src/render.ts](src/render.ts) | The report returned to the lead agent and the card data |
| [src/host.ts](src/host.ts) | Host facts placed in agent prompts |

Only an agent the person talks to sees the tools: a delegated agent (a mission's council, builders and gates, a swarm worker, any subagent) does not, so a mission never starts another one inside itself. When the person's message asks for one of the tools by name ("use hackdev to …", "use a swarm (hackdev_swarm) to …"), a one-line note just before that message, at the first step of its turn, tells the agent to call that tool first with the request as the mission; small local models otherwise tend to do the work themselves.

Roles that plan, check or report (the council, the splitter, the fact-checker, the integrator, the chronicler, the swarm coordinator and the worktree manager, which only runs its one helper command) may write only notes inside `.hackdev`. Their prompts say so and end with a line telling them not to carry out the mission. A tool guard also refuses their `write` and `edit` calls on any other path, and their `workflow`, `subagent` and `subagent_fork` calls, with a message telling them to finish their own part. A plan is not rejected for the shorthand weaker models write: a `dependsOn` entry of `-`, `none` or `n/a` is dropped, one written as another task's title points at that task, and a missing id, description or acceptance is derived from the title.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Design and operations](../../../docs/hack-dev-code.md) — phases, waves, gates, files written under `.hackdev/`.
- [Mission card](../client-ui-hackdev/README.md) — how results are shown.

<a id="model-experience"></a>
## Model Experience

### Mission tools

#### What the model sees

Three tool definitions, `hackdev` (a `mission` plus optional caps on tasks, waves and fix rounds), `hackdev_swarm` (a `mission`, optional caps on workers and rounds, `review`, `notes` and a model per role) and `hackdev_review` (a `mission`, optional `focus` and fix-round cap), and a policy prompt section explaining when to use them. A call returns one bounded report: the plan, each task's outcome, gate verdicts with findings, unmet criteria and the files written.

#### Token effect

The three definitions and the policy section cost a fixed amount on every request where the tools are visible; the named-tool note adds about 50 tokens to the turn that asks for a tool. A mission's own agents run in separate contexts; the lead agent receives only the report, at most `maxResultChars`.

#### KV Cache effect

Stable definitions and prompt text keep the prefix reusable; the report is appended as a tool result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Worktree workers start afresh** — in the shared workspace a woken worker continues its own conversation; a worker in its own git worktree gets a new folder each round, so it starts a new conversation that reads its last report and the board.
- **Read-only roles can still run commands** — the guard covers `write` and `edit`; a planning role that changes files through a shell command is not stopped, only told not to in its prompt.
- **Cost and time** — a mission runs many agents; the caps bound it, but a large mission is still long and expensive on paid models.
- **Shared workspace** — `shared` isolation relies on disjoint owned paths; overlapping edits are caught by the gates, not prevented. Use `worktree` in a Git repository for strict isolation.
- **Full autonomy by default** — pipeline agents act without asking; set `autonomy: bounded` where a person must approve risky steps.
