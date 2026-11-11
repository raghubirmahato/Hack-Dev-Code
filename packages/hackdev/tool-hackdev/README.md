---
description: "The Hack Dev Code mission pipeline: the hackdev and hackdev_review tools that run fixed multi-agent build and gate-review workflows."
kind: "package-reference"
---

# @hackdevcode/dsh-tool-hackdev

## Summary

Two tools for the lead agent. `hackdev` runs a mission end to end: a planning council maps the project and sizes a team, specialist builders work in parallel waves, a fact-checker re-runs their evidence, independent gates verify, review and harden the result, and an integrator iterates until every acceptance criterion is met or the wave budget is spent. `hackdev_review` runs only the gates on existing work. The full design is in [docs/hack-dev-code.md](../../../docs/hack-dev-code.md).

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

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Config, prompt sections, and the two tool registrations |
| [src/script.ts](src/script.ts) | The fixed orchestration scripts the workflow engine runs: council, forge, fact-check, gates, integrator, chronicle |
| [src/render.ts](src/render.ts) | The report returned to the lead agent and the card data |
| [src/host.ts](src/host.ts) | Host facts placed in agent prompts |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Design and operations](../../../docs/hack-dev-code.md) — phases, waves, gates, files written under `.hackdev/`.
- [Mission card](../client-ui-hackdev/README.md) — how results are shown.

<a id="model-experience"></a>
## Model Experience

### Mission tools

#### What the model sees

Two tool definitions, `hackdev` (a `mission` plus optional caps on tasks, waves and fix rounds) and `hackdev_review` (a `purpose`, optional `focus` and fix-round cap), and a policy prompt section explaining when to use them. A call returns one bounded report: the plan, each task's outcome, gate verdicts with findings, unmet criteria and the files written.

#### Token effect

The two definitions and the policy section cost a fixed amount on every request where the tools are visible. A mission's own agents run in separate contexts; the lead agent receives only the report, at most `maxResultChars`.

#### KV Cache effect

Stable definitions and prompt text keep the prefix reusable; the report is appended as a tool result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Cost and time** — a mission runs many agents; the caps bound it, but a large mission is still long and expensive on paid models.
- **Shared workspace** — `shared` isolation relies on disjoint owned paths; overlapping edits are caught by the gates, not prevented. Use `worktree` in a Git repository for strict isolation.
- **Full autonomy by default** — pipeline agents act without asking; set `autonomy: bounded` where a person must approve risky steps.
