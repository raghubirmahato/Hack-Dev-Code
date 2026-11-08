# Hack Dev Code

**An AI agent that works on your computer the way a person does.** It writes and fixes code, runs whole projects with a team of specialist agents, and operates the desktop and the browser: it opens apps, reads windows, clicks, types and checks its own work. It runs on DeepSeek, on any OpenAI-compatible provider, or entirely offline on local Ollama models.

Hack Dev Code ships as a desktop app for Windows and macOS, a Web UI, a command line for Windows, macOS and Linux, a VS Code extension and a GitHub Action for pull-request review. Everything runs on your machine; there is no hosted backend and no account to create.

---

## Contents

1. [What it does](#what-it-does)
2. [Install](#install)
3. [Quick start](#quick-start)
4. [Models and keys](#models-and-keys)
5. [Desktop and browser control](#desktop-and-browser-control)
6. [Multi-agent missions](#multi-agent-missions)
7. [Permissions and safety](#permissions-and-safety)
8. [Integrations](#integrations)
9. [Configuration](#configuration)
10. [Architecture](#architecture)
11. [Build from source](#build-from-source)
12. [Known limitations](#known-limitations)
13. [Contributing, license and acknowledgements](#contributing-license-and-acknowledgements)

---

## What it does

| Area | Capability |
|---|---|
| **Coding** | Reads, writes and edits files, runs shell commands (PowerShell or Bash), searches with `glob`, `grep` and a ranked `code_search` over definitions, and keeps a to-do list that it finishes before it reports back. |
| **Missions** | The `hackdev` tool turns one request into a planned project: an analyst, a scout and a planner size a team, specialist builders work in parallel, and three independent gates verify, review (including real screenshots of the UI) and secure the result. |
| **Desktop control** | Launches apps by name, lists and reads windows through UI Automation (Windows) or AT-SPI (Linux), acts on numbered controls, reads text with OCR, clicks, drags, scrolls, types and presses shortcuts with real input, across every monitor. |
| **Browser** | A built-in browser pane in the desktop app, plus agent control of Chrome through Chrome DevTools, with a persistent profile so sign-ins stay. |
| **Models** | DeepSeek out of the box; OpenAI-compatible providers; local models through Ollama, listed straight from your Ollama install. Several keys per provider rotate and fall back automatically. |
| **Extensibility** | A directory of well-known MCP servers you can switch on, installable skills, custom instructions and `AGENTS.md` files, and a plugin system for everything else. |
| **Everywhere you work** | Desktop app, Web UI, CLI, VS Code extension and a GitHub Action. |

Results are evidence-based: tasks that claim success without proof are downgraded, the fact-checker re-runs claimed evidence, and every mission report opens with what still needs your attention.

---

## Install

### Desktop app (Windows)

Download the latest installer from the [Releases](https://github.com/raghubirmahato/Hack-Dev-Code/releases) page and run it. It installs for the current user and adds the `hackdev` command to your terminal. The app updates itself from GitHub Releases.

- The installer is not code-signed yet, so Windows SmartScreen may ask you to confirm. Choose **More info → Run anyway**.
- The app asks for administrator rights when it starts, so the agent can install software and operate apps that run as administrator. Decline and it keeps running with normal rights. To never ask, set `HACKDEV_RUN_AS_ADMIN=0` or start it with `--no-admin`.
- If Hack Dev Code is running when you install, update or uninstall, the installer offers to close it for you.

### macOS and Linux

Build the desktop app for macOS, or use the Web UI and CLI on any platform, from source: see [Build from source](#build-from-source).

On Linux, desktop control needs X11 tools:

```sh
sudo apt-get install -y x11-xserver-utils xdotool imagemagick wmctrl xdg-utils xclip tesseract-ocr
```

---

## Quick start

1. Open Hack Dev Code (or run `pnpm run start:web` from a source checkout and open the printed address).
2. Choose a workspace folder.
3. Open **Settings → Models** and add a DeepSeek key, another provider, or pick an Ollama model.
4. Ask for something:
   - *"Add a health check endpoint and a test for it."*
   - *"Open Calculator and work out 12 × 7."*
   - *"Use hackdev to build a single-page expense tracker with tests."*

From a terminal:

```sh
hackdev "Fix the failing tests in this repository"
hackdev --profile headless "Use hackdev_review to review this repository"
```

---

## Models and keys

- **DeepSeek.** Set `DEEPSEEK_API_KEY`, or paste the key in **Settings → Models**.
- **Other providers.** Add any OpenAI-compatible endpoint in **Settings → Models**.
- **Local models.** The **Ollama** tab lists every model you have downloaded and adds the one you pick; nothing leaves your machine.
- **Key pools.** Paste several keys into one field, separated by commas or one per line. Requests rotate through them; a key that is rate limited, out of quota or invalid rests for a minute while the same request continues on the next key, so a conversation never loses its place. Each provider can also list `fallbackModels` for when a model is overloaded on every key.
- **Storage.** Keys are kept in the app's credential store, encrypted at rest with Windows DPAPI on Windows. They are never written to the repository, prompts, logs or reports.

Hack Dev Code is tuned to work well with smaller and free models: tools return text that a model without vision can act on (numbered controls and OCR coordinates instead of guesses), tool groups load on demand to keep requests small, and the agent is reminded to finish open to-do items before it stops.

---

## Desktop and browser control

The desktop tools work on Windows and Linux (X11); macOS uses its native computer-use provider.

| Tool | Does |
|---|---|
| `desktop_screenshot` | Captures one window, a display, a region or the whole desktop and returns the image with its coordinate mapping. On Windows a window behind others is captured without bringing it forward. Optional OCR. |
| `desktop_window` | Lists windows, including the taskbar and hidden tray icons; reads a window's controls as numbered `[n]` entries with their centre points; focuses, moves, resizes, minimizes or closes; waits for a window or for text to appear. |
| `desktop_element` | Clicks, invokes, toggles, expands, selects, sets values or focuses a control by number, name or automation id (Windows). |
| `desktop_pointer`, `desktop_drag`, `desktop_scroll` | Real mouse input on any monitor, with modifier keys. `press: down|up` holds a button over several steps. |
| `desktop_keys`, `desktop_type` | Key chords and text into the window in front. Long text is pasted through the clipboard, which is restored afterwards. `hold: down|up` keeps a chord pressed. |
| `desktop_ocr` | The text on screen with the centre point of each line. |
| `desktop_sequence` | Up to 30 of these steps in one call, stopping at the first failure. |

Anything left pressed is released when the tools unload. Windows prevents a normal process from controlling apps running as administrator, UAC prompts and the lock screen; running Hack Dev Code as administrator covers the first, and the agent never tries to bypass the others.

**Chrome.** The agent drives Chrome through Chrome DevTools: pages, forms, scripts, screenshots and clicks. To let it use the Chrome you already have open, enable remote debugging at `chrome://inspect/#remote-debugging` and set the `chrome` row to `mode: connect`.

---

## Multi-agent missions

Ask the agent to "use hackdev" for work that deserves a team. The pipeline is fixed in code; the model only supplies the mission text and caps within your limits, so the checks always run.

```mermaid
flowchart TB
    M(["Mission"]) --> C["Council<br/>analyst, scout, planner"]
    C -->|"validated task graph"| F["Forge<br/>parallel specialist builders"]
    F --> FC["Fact-check<br/>re-run claimed evidence"]
    FC --> G1["Gate 1: Verifier<br/>build, run, test, fix"]
    G1 --> G2["Gate 2: Quality and UX<br/>code review, real screenshots"]
    G1 --> G3["Gate 3: Security<br/>validation, authz, secrets, dependencies"]
    G2 --> I{"Integrator<br/>every acceptance criterion met?"}
    G3 --> I
    I -->|"no, waves remain"| F
    I -->|"yes"| R(["Report<br/>results, evidence, needs attention"])
```

| Agent | Responsibility |
|---|---|
| Requirements analyst | Turns the mission into requirements and testable acceptance criteria. |
| Codebase scout | Maps the stack, commands, conventions and risks into `.hackdev/PROJECT_MAP.md`. |
| Planner | Sizes the team and returns small tasks with dependencies, owned paths and specialist roles. |
| Specialist builders | One per task (frontend, backend, data, test, docs, security, ...), each in its own git worktree, merged back one at a time. |
| Splitter | Breaks a task a builder could not finish into ordered subtasks. |
| Fact-checker | Confirms listed files exist and re-runs the cheapest decisive evidence. |
| Verifier, Quality + UX, Security | Independent gates with bounded review-fix loops and a regression pass. |
| Integrator | Opens follow-up tasks for unmet criteria. |
| Chronicler | Writes `RUN_REPORT.md` and compacts long-term memory. |

Agents communicate through a typed blackboard (contracts, decisions, facts, risks, warnings, handoffs, questions) rather than free-form chat. Memory persists in `.hackdev/MEMORY.md`, and `.hackdev/PROGRESS.md` lets a rerun plan only the remaining work. Use `hackdev_review` to run only the three gates on work done elsewhere. The full design is in [docs/hack-dev-code.md](docs/hack-dev-code.md).

---

## Permissions and safety

Hack Dev Code starts with **Full access**: agents install, edit, delete and run commands without asking, and mission agents run with `autonomy: full`. That suits a personal machine. To add limits back:

- choose **Workspace Write** or **Read Only** in the composer;
- set `DSH_PERMISSION_MODE=workspace-write` (or `read-only`) before starting;
- change `defaultPreset` on the `permission` row;
- set `autonomy: bounded` on `tool-hackdev` to keep mission agents from destructive or irreversible actions.

In read-only sessions, installing MCP servers or skills asks for approval. Secrets stay out of code, prompts and reports. The security gate audits and hardens what missions build, but no process can promise software that cannot be broken, so every report lists what was checked, what was fixed and what remains open.

---

## Integrations

- **VS Code.** The extension in [`extensions/vscode`](extensions/vscode) runs tasks on your workspace, asks about a selection, reviews your changes and opens the full app inside VS Code.
- **GitHub pull-request review.** The composite action [`.github/actions/hackdev-review`](.github/actions/hackdev-review/action.yml) reviews a pull request in read-only mode and posts the review as a comment:

  ```yaml
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 }
  - uses: ./.github/actions/hackdev-review
    with:
      api-key: ${{ secrets.DEEPSEEK_API_KEY }}
  ```
- **MCP servers.** Turn on GitHub, Playwright, filesystem, Context7 docs, fetch, Git, memory, sequential thinking, time or Brave Search from the built-in directory, or add your own.
- **Skills.** Install skills from a Git repository; they load into every session.
- **Custom instructions.** **Settings → General → Custom instructions**, or `AGENTS.md` files: `~/.dsh/AGENTS.md` for all projects, `AGENTS.md` in a project, `AGENTS.local.md` for private notes.

---

## Configuration

Every setting is documented in [docs/config-catalog.md](docs/config-catalog.md) and every tool in [docs/tool-catalog.md](docs/tool-catalog.md). The mission pipeline is configured on the `tool-hackdev` row of [`packages/bundle/base/cordis.patch.yml`](packages/bundle/base/cordis.patch.yml):

| Option | Default | Meaning |
|---|---|---|
| `maxTasks` | 24 | Tasks planned per wave |
| `maxParallel` | 6 | Builders running at once |
| `maxWaves` | 6 | Build waves, including follow-ups for unmet criteria |
| `maxFixRounds` | 4 | Review-fix rounds per gate |
| `builderIsolation` | `worktree` | A git worktree per builder; `shared` uses one workspace |
| `autonomy` | `full` | `bounded` forbids destructive or irreversible actions |
| `visionModel` | empty | Image-capable model for the UI gate |
| `customInstructions` | empty | Standing instructions for every pipeline agent |

A request may lower these caps but never raise them, and a computed agent budget stops runaway spawning.

---

## Architecture

Hack Dev Code is a TypeScript monorepo built on the Cordis plugin framework: every capability (a tool, a model adapter, a UI panel) is a plugin, and product bundles choose which plugins to mount.

```text
apps/cli, apps/web, apps/desktop     command line, Web UI and Electron desktop shell
packages/core                        agent loop, tools runtime, system prompt
packages/hackdev                     multi-agent mission pipeline and its result card
packages/experimental                desktop control (computer use) and browser providers
packages/llm                         model adapters, key pools and fallbacks
packages/mcp, packages/skill         MCP client and directory, skills
packages/bundle                      product bundles (base, web-app, headless)
packages/*                           sessions, sandbox, credentials, file tools, UI and more
extensions/vscode                    VS Code extension
vendor/, native/                     vendored framework libraries, native sandbox helper
docs/                                design doc and generated references
```

---

## Build from source

Requirements: Node.js 24.9 or newer and pnpm 11.

```sh
pnpm install
pnpm run build:artifacts          # outside a git checkout, set DSH_CLIENT_COMMIT_HASH=abcdef1 first
pnpm run start:web                # Web UI at http://127.0.0.1:3080
node apps/cli/lib/bin.js "..."    # CLI
```

Package the desktop app:

```sh
pnpm run package:desktop:win:x64:unsigned     # Windows installer
pnpm run package:desktop:mac:arm64:unsigned   # macOS, Apple silicon
```

Pushing a `v*` tag that matches the desktop version builds the Windows installer and publishes it as a GitHub release.

Checks:

```sh
pnpm run lint
npx tsc -b tsconfig.host.json     # NODE_OPTIONS=--max-old-space-size=8192
npx tsc -b tsconfig.client.json
npx vitest run <path>
```

---

## Known limitations

- Results depend on the model. The gates add evidence and retry loops, not guarantees.
- Desktop control does not cover Wayland-only Linux sessions, UAC prompts or the lock screen.
- The Windows installer is not code-signed yet.
- Visual checks in missions need an image-capable model route and a browser; without them the report says the UI was not visually exercised.
- Some repository tests need symlinks, git or a POSIX shell and fail on Windows for that reason alone.

---

## Contributing, license and acknowledgements

Conventions for contributors and coding agents are in [AGENTS.md](AGENTS.md). Issues and pull requests are welcome.

[MIT](LICENSE). Third-party dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Hack Dev Code builds on the MIT-licensed DeepSeek Harness agent runtime.
