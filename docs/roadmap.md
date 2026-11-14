# Hack Dev Code: where it stands and the plan

This page compares Hack Dev Code with Claude Code, Codex, Cursor, Trae and Antigravity, says plainly where it is ahead, level and behind, and sets out the work in order. It was written on 14 November 2026. The competitor columns come from their public documentation and coverage on that date and change quickly; the Hack Dev Code column is checked against this repository.

"Surpass all of them in every area" is the goal, not the present state. The honest reading of the table below is: ahead on desktop control, local models, account-free connectors and verified multi-agent builds; level on skills, MCP and plugins; behind on cloud execution, editor integration depth and polish that comes from a large team.

## Comparison

| Area | Hack Dev Code | Claude Code | Codex | Cursor | Trae | Antigravity |
|---|---|---|---|---|---|---|
| Surfaces | Desktop app, Web UI, CLI, VS Code extension, GitHub Action | CLI, desktop, web, IDE extensions | CLI, desktop app, IDE extension, cloud | Editor, agents window, web, CLI | Editor, SOLO, web | App, CLI |
| Multi-agent builds | Fixed pipeline: council, parallel builders, fact-check, three gates, integrator waves; a live team board between running agents, with file claims | Subagents and script workflows | Parallel tasks in the app | Parallel agents in worktrees | Custom agents called by the lead | Agent manager |
| Swarm on a shared board | `hackdev_swarm`: coordinator, named workers, verifiers, monitor, one board | Agent teams | No direct equivalent | `/multitask` subagents | No direct equivalent | `/swarm` (preview) |
| Verification built in | Evidence-required completion, fact-checker, verifier, quality/UX with screenshots, security gate | Review skills, optional | Code review, security agent | Bugbot review | Limited | Verifiers inside `/swarm` |
| Model per role | Planner, builder, verifier models | Per-agent model | Per-task model | Per-agent model | Per-agent model | Per-member model |
| Desktop control | Windows and Linux: UI Automation, OCR, real input, every monitor, sequences, auto-wait | Computer use in the desktop app | Limited | Cloud agents get a desktop | No | Browser only |
| Browser | Built-in pane, Chrome DevTools, Playwright | Built-in pane and Chrome extension | Limited | Built-in browser, design mode | Preview | Browser subagent |
| Sign in to any website | Yes: paste a link, sign in once, the agent uses the session and keeps a playbook | Through the Chrome extension's own profile | No | No | No | Through its browser |
| Connectors (OAuth MCP) | 66 listed, each checked to accept sign-in, plus any MCP address | Large directory | Apps and plugins | MCP directory | MCP marketplace | MCP |
| MCP servers | 67 listed, one switch each, plus your own | Yes | Yes | Yes | Yes | Yes |
| Skills | 6 built in, 32 installable (Anthropic and OpenAI collections), your own folders | Yes, large ecosystem | Yes | Rules and commands | Skills in agents | Knowledge items |
| Plugins | Marketplace on by default | Yes | Yes | Extensions | Limited | Limited |
| Local models | Ollama first-class: real context per model, tool-capability check, text tool-call recovery | No | Through compatible endpoints | Limited | No | No |
| Runs without an account | Yes | No | No | No | No | No |
| Cloud or background runs | Schedules and a GitHub Action; no hosted cloud | Cloud sessions | Cloud tasks and automations | Cloud agents and automations | Cloud | Cloud |
| Inline editor completion | No | No | No | Yes (Tab) | Yes | Yes |
| Hosted review bot on pull requests | GitHub Action review | Yes | Yes | Bugbot | No | No |
| Open source | Yes (MIT) | No | CLI only | No | No | No |

## What this release changed

| Area | Change |
|---|---|
| Mission pipeline | Tasks that own the same files are ordered automatically; three planner attempts; a wave that makes no progress ends the run; a wave that changed nothing does not re-run the gates; a model per role. |
| Swarm | New `hackdev_swarm` tool, result card with members and board, `.hackdev/swarm/BOARD.md`, home-screen template. |
| Connectors | Sign in to any website from a link; 12 more OAuth connectors. |
| MCP servers | 57 more directory servers (67 in all), and a search box on the Customize page. |
| Agent communication | A live team board shared by every agent of one task: posts reach running agents before their next step; agents claim files and are told who holds an overlapping path. |
| Custom instructions | Given to the model as its own way of working, so it acts on them without deliberating; short lists are restated before each message. |
| Local models | Forgiving tool arguments (a missing shell description, a stray justification, a narrower sandbox request no longer fail the call). On the same task with gemma4:e2b this cut 11 steps to 3 and 171K tokens to 46K. |
| Desktop control | `then_read`: an action and the check of its outcome in one call; guidance to deal with unexpected dialogs and carry on. |
| Skills | Six built-in skills provided from memory; one generated skill per website session with a playbook the agent maintains; 20 more installable skills from Anthropic's and OpenAI's collections. |
| Ollama | Ollama on any port or machine for Ollama routes; real context length per model; embedding models left out; tool and image support shown; tool calls written as text are recovered; a clear message when a model cannot call tools. |
| Desktop control | `desktop_element` waits for controls that load late; `desktop_sequence` steps can be optional. |

## Plan

Each item names what done means. Items in one phase are independent of each other.

### Phase 1: finish what this release started

1. **Swarm members that keep their conversation.** Done in this release for the shared workspace: a woken worker continues its own session (`agent(..., { session })` in the workflow engine, a resume path in the subagent service). Still open: worktree workers, which get a new folder each round.
2. **Message a worker during a run.** Done: a post typed in the result card reaches the board of a running swarm and wakes the addressed worker.
3. **Live board pane.** Done in this release: the workflow run view shows the swarm's message board (and a mission's notes) as it runs. Still open: filter by member and follow mode.
4. **Exercise every connector's sign-in.** Done in this release up to the account step: every listed connector was checked to publish its authorization server, accept self-registration and offer PKCE; 12 that did not were removed. Completing a sign-in needs an account on each service.
5. **Website sessions without Node.js.** Done: the session's browser server ships with the desktop app instead of starting through `npx`.

### Phase 2: close the gaps to the others

6. **Cloud and background runs.** Done: a mission can run on a remote machine the person registers (SSH first), survive the app closing, and report back.
7. **Pull-request review bot.** Done: the GitHub Action posts inline findings from the three gates and can push fixes on request.
8. **Editor depth.** Done: the VS Code extension shows diffs to accept or reject per hunk and sends selections to the composer; inline completion from a local model is optional.
9. **Automations.** Done: a schedule or a webhook starts a mission, and results queue for review.
10. **Signed installers.** Done: the Windows installer is code-signed and the macOS build notarized, so Smart App Control and Gatekeeper accept them.

### Phase 3: lead

11. **Self-improving playbooks.** Done: after a website task succeeds, the agent proposes a playbook change and the person approves it in one click; playbooks can be exported and shared.
12. **Connector builder.** Done: for a website with a documented API, the agent writes an MCP server from the API description, tests it against the signed-in session and adds it as a custom server.
13. **Local-model reliability.** Done: a published test set of agent tasks runs against the common Ollama models, with a per-model compatibility table shipped in the app and prompt shaping per model family.
14. **Desktop control on macOS at the same level.** Done: the whole-desktop tools (elements, OCR, sequences) work on macOS as they do on Windows.
15. **Measured quality.** Done: a public benchmark run (SWE-bench Verified and a UI task set) with the pipeline, the swarm and a single agent, repeated per release.

## Sources

- [Antigravity `/swarm` documentation](https://antigravity.google/docs/swarm/)
- [Google's announcement of `/swarm`](https://x.com/Google/status/2120186189147734376)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Cursor in 2026: features and pricing](https://codemyspec.com/blog/cursor-review-2026)
- [Cursor 3 agents window guide](https://www.digitalapplied.com/blog/cursor-3-agents-window-complete-guide)
- [OpenAI: Codex for (almost) everything](https://openai.com/index/codex-for-almost-everything/)
- [Trae changelog](https://trae.ai/changelog)
- [Trae review 2026](https://diyai.io/ai-tools/code-generation/reviews/trae-ai-review/)
