# Loadable Harness plugin packages

This file is GENERATED from workspace manifests (`scripts/gen-plugin-packages.ts`) and verified fresh by `pnpm run verify-plugin-packages` (part of `doc-sync`); do not edit it by hand.

Every package below exports a Cordis plugin that a bundle patch can name in a Loader row. `Config` marks packages whose row accepts a `config` mapping; query `Config.listConfigs` through `cordis_inspect_query` (filter by `name`, then query the `entry` id) for the mounted schema. Packages under `experimental` are pre-stable.

## acp

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-acp` | yes | Automation-only Agent Client Protocol server for driving Hack Dev Code agents over JSON-RPC stdio |

## api

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-api-account-controller` | no | Expose safe account operations over authenticated Remote |
| `@hackdevcode/dsh-api-gateway` | yes | Typert Remote Host dispatcher and Client API endpoint |
| `@hackdevcode/dsh-api-job-controller` | yes | Job Remote observation stream and the reference-counted client job-output service |
| `@hackdevcode/dsh-api-remote-access` | no | Method-level Remote access control for non-owner Peers and the per-Peer access snapshot |
| `@hackdevcode/dsh-api-remotes` | no | Remote BFF assembly for application-selected Host capabilities |
| `@hackdevcode/dsh-api-session-controller` | yes | Session Remote commands, cold reads, and live control transport |
| `@hackdevcode/dsh-api-settings-controller` | yes | Remote owner for the configuration surfaces over the settings-domain seams |
| `@hackdevcode/dsh-api-terminal-controller` | yes | Session-owned interactive terminals with shell discovery, screen recovery and typed Remote control |
| `@hackdevcode/dsh-api-workspace-controller` | yes | Workspace Remote commands and reconnect-safe state transport |
| `@hackdevcode/dsh-api-workspace-files` | yes | Workspace file service and Client resource provider: bounded reads, directory listing, and live metadata over the workspaceFiles Remote namespace |

## attachment

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-attachment-local` | yes | Private content-addressed DSH_HOME attachment storage |

## boot

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-config-editor` | no | Persist plugin configuration through profile patches and Loader reconciliation |
| `@hackdevcode/dsh-hmr` | yes | Coordinated module and profile configuration hot reload |
| `@hackdevcode/dsh-plugin-manager` | yes | Current-profile plugin and bundle management shared by dsh CLI, Web and agent tools |
| `@hackdevcode/dsh-plugin-market` | yes | Configured plugin market indexes for the Web Discover page and the plugin_market agent tool |

## browser-use

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-browser-use` | no | Exclusive named browser-use provider registration |

## bundle

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-acp-app` | no | The dsh ACP profile bundle: automation-only JSON-RPC stdio and process lifecycle over dsh-base |
| `@hackdevcode/dsh-headless` | yes | The dsh one-shot bundle: a direct core Agent/Session runner over dsh-base with no Host, HTTP, or browser layer |
| `@hackdevcode/dsh-sdk-app` | yes | The dsh SDK profile bundle: stdio JSON-RPC serving and process lifecycle over dsh-base |
| `@hackdevcode/dsh-web-app` | yes | The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin (frontend dist serving, bash runtime variables, URL line) |

## client

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-client-connection` | yes | Authenticated RPC transport and generation lifecycle |
| `@hackdevcode/dsh-client-file-upload` | no | Agent-scoped browser file upload, streaming intake, and staged receipt service |
| `@hackdevcode/dsh-client-hmr` | yes | Web client graph synchronization and rebuilt-bundle reload transport |
| `@hackdevcode/dsh-client-locale` | no | Locale plugin: Host-backed preference, extensible language catalog, browser fallback, and typed built-in dictionaries |
| `@hackdevcode/dsh-client-modules` | no | Client module system, dual-face: node half composes the __DSH_BOOT__ entry graph (incremental dsh.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |
| `@hackdevcode/dsh-client-product-analytics` | yes | Desktop product event collection and authenticated Host reporting |
| `@hackdevcode/dsh-client-resources` | no | Unified client resource model: protocol-registered providers turn URL addresses into live values, consumed through the useResource global standard hook |
| `@hackdevcode/dsh-client-shortcuts` | yes | Application keyboard command registry and physical-key routing |
| `@hackdevcode/dsh-client-ui-agent-preset` | no | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| `@hackdevcode/dsh-client-ui-approval` | no | Approval composer takeover over the scoped Remote Event waterfall |
| `@hackdevcode/dsh-client-ui-attachment` | no | Dynamic attachment presentation plugin for conversation input, message-image, and trajectory image slots |
| `@hackdevcode/dsh-client-ui-brand-official` | no | Official Hack Dev Code brand occupants for the Web client's sidebar slots |
| `@hackdevcode/dsh-client-ui-chat` | no | Chat Conversation target, node definitions, renderers, and details surface |
| `@hackdevcode/dsh-client-ui-commands` | no | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| `@hackdevcode/dsh-client-ui-conversation` | no | Target-neutral Conversation assembly, shell, composer, queue, and view navigation |
| `@hackdevcode/dsh-client-ui-deliverables` | no | Changed-files card with per-file comparison tabs, delivery cards, and clickable final-response file references for Web |
| `@hackdevcode/dsh-client-ui-directory-picker-browse` | no | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |
| `@hackdevcode/dsh-client-ui-directory-picker-native` | no | Native directory-picker surface: the renderless workspace directory-flow occupant driving the local Desktop or Host OS chooser |
| `@hackdevcode/dsh-client-ui-entry-customization` | no | Customize plugin entries in the left sidebar, conversation views, and right sidebar, and quickly create new plugins. |
| `@hackdevcode/dsh-client-ui-file-drag` | no | Application-owned file drag transfers and localized failure feedback |
| `@hackdevcode/dsh-client-ui-goal` | no | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| `@hackdevcode/dsh-client-ui-input-trigger` | no | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| `@hackdevcode/dsh-client-ui-jobs` | no | Session-header background-job list with on-demand streaming record panels |
| `@hackdevcode/dsh-client-ui-layout` | no | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| `@hackdevcode/dsh-client-ui-message-feedback` | no | The Web feedback surface: per-message Like/Dislike in the assistant-message action strip and the feedback dialog behind both ratings and /feedback, backed by the messageFeedback and sessionFeedback Host Remotes |
| `@hackdevcode/dsh-client-ui-model-selection` | no | Model selection over the shared model catalog, Session projection, and session.selectModel |
| `@hackdevcode/dsh-client-ui-open-in-app` | no | Web "Open In..." controls: the Session-header split button opening the workspace directory in an installed application, and the document preview's default-application controls for one file |
| `@hackdevcode/dsh-client-ui-permission-presets` | no | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |
| `@hackdevcode/dsh-client-ui-plan` | no | Plan mode controls, persistent transcript plan cards, and sidebar Markdown previews |
| `@hackdevcode/dsh-client-ui-plugin-manager` | yes | Plugin management for the dsh web client: the sidebar Plugins panel installs, enables, disables, retries, and composes installed plugin packages |
| `@hackdevcode/dsh-client-ui-plugin-market` | no | Discover tab of the dsh web Plugins page: browse configured plugin market indexes and install their bundles |
| `@hackdevcode/dsh-client-ui-reference` | no | Unified Web @file and @session reference source |
| `@hackdevcode/dsh-client-ui-renderer` | no | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| `@hackdevcode/dsh-client-ui-schedule` | no | Host task management page and Session reminder catalog |
| `@hackdevcode/dsh-client-ui-secret-mask` | no | Web display masking for recognized credentials in sent user text |
| `@hackdevcode/dsh-client-ui-session` | no | Session Controller adapter for React and session-scoped slots |
| `@hackdevcode/dsh-client-ui-settings` | no | Settings domain base plugin: shared configuration forms and the canonical settings slot-type contract |
| `@hackdevcode/dsh-client-ui-settings-account` | yes | Manage DeepSeek login and open Platform billing pages |
| `@hackdevcode/dsh-client-ui-settings-agent-loop` | no | Settings page of the agent loop on the dsh web client's Plugins page: the parallel tool-call cap of the agent-loop namespace |
| `@hackdevcode/dsh-client-ui-settings-general` | no | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |
| `@hackdevcode/dsh-client-ui-settings-models` | yes | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| `@hackdevcode/dsh-client-ui-settings-plugin-inventory` | no | Read-only Cordis Loader inventory tab in Web Plugins settings |
| `@hackdevcode/dsh-client-ui-settings-plugins` | no | Built-in plugins settings section for the dsh web client: the Settings navigation entry and the tab chrome feature-owned tabs register into |
| `@hackdevcode/dsh-client-ui-settings-session-log` | no | General settings control for Session-log upload with DeepSeek API requests |
| `@hackdevcode/dsh-client-ui-settings-shell` | no | Settings page of the shell executor on the dsh web client's Plugins page: the command timeout and the per-stream output cap of the shell namespace |
| `@hackdevcode/dsh-client-ui-settings-subagent` | no | Settings page of Subagent delegation on the dsh web client's Plugins page: recursion depth, parallel capacity, and the models agents may choose for subagents |
| `@hackdevcode/dsh-client-ui-settings-web-search` | no | Settings page of the DeepSeek web-search provider on the dsh web client's Plugins page: its API key, endpoint, and per-request search budget |
| `@hackdevcode/dsh-client-ui-shortcuts` | no | Keyboard shortcut reference, recording, and local preference editing |
| `@hackdevcode/dsh-client-ui-sidebar` | no | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| `@hackdevcode/dsh-client-ui-sidebar-browser` | no | Sandboxed Web browser tabs for the right Sidebar |
| `@hackdevcode/dsh-client-ui-sidebar-documentpreview` | yes | Extensible Sidebar previews for Office documents, spreadsheets, Markdown, code, images, PDF, HTML, and plain text |
| `@hackdevcode/dsh-client-ui-sidebar-files` | no | Workspace file tree tab type for the right Sidebar: lazy directory listing over the workspaceFiles Remote namespace, opening files into the Sidebar |
| `@hackdevcode/dsh-client-ui-sidebar-right` | no | Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it |
| `@hackdevcode/dsh-client-ui-sidebar-terminal` | no | Interactive shell tabs for the right Sidebar |
| `@hackdevcode/dsh-client-ui-skill` | no | Web skill references and the dedicated skill tool row |
| `@hackdevcode/dsh-client-ui-subagent` | no | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| `@hackdevcode/dsh-client-ui-theme` | yes | Theme plugin: Host bootstrap for the pre-plugin palette; ThemeRuntime for light/dark/system state and icon replacements; --dsw-* token styles and Appearance settings row |
| `@hackdevcode/dsh-client-ui-tool` | no | Client Tool call-tree renderer and keyed per-tool presentation slot |
| `@hackdevcode/dsh-client-ui-trajectory` | yes | Trajectory event ledger and timing overview with live tool-result inspection |
| `@hackdevcode/dsh-client-ui-user-questions` | no | Web ask_user_question composer takeover and plan-review presentation UI |
| `@hackdevcode/dsh-client-ui-workflow-run` | no | Durable workflow-run Conversation Node and nested member disclosure for dsh web |
| `@hackdevcode/dsh-client-ui-workspace` | no | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |

## compaction

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-command-compact` | no | Human-facing slash command for explicit session compaction |
| `@hackdevcode/dsh-compaction-basic` | yes | Token-meter-driven compaction policy and LLM summarization backend for the Hack Dev Code |
| `@hackdevcode/dsh-compaction-image-offload` | no | Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry |
| `@hackdevcode/dsh-compaction-tool-result-pruner` | yes | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |

## computer-use

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-computer-use` | no | Exclusive named computer-use provider registration |

## context

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-agent-instructions` | yes | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| `@hackdevcode/dsh-file-reference-local` | yes | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| `@hackdevcode/dsh-harness-dev-context` | no | Model context naming the Hack Dev Code checkout and Web GUI URL without letting either change the system prompt |
| `@hackdevcode/dsh-session-reference` | yes | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| `@hackdevcode/dsh-time-context` | yes | Durable per-step context with the current time and elapsed time |
| `@hackdevcode/dsh-tmux-context` | yes | Opt-in durable per-step context with this agent's tmux pane and window location |

## core

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-agent` | no | Agent interface, registry, initiator scope, and event vocabulary for the Hack Dev Code |
| `@hackdevcode/dsh-agent-default-model` | yes | Default model selection shared by Agent entry points |
| `@hackdevcode/dsh-agent-loop` | yes | The concrete agent loop plugin for the Hack Dev Code |
| `@hackdevcode/dsh-agent-tool-presentation` | yes | Deprecated tool presentation selector; use dsh-tool-executor-native or dsh-tool-executor-ptc directly |
| `@hackdevcode/dsh-session` | no | Event-sourced session store for the Hack Dev Code |
| `@hackdevcode/dsh-system-prompt` | yes | System prompt assembly registry for the Hack Dev Code |
| `@hackdevcode/dsh-tool-executor-native` | no | Native tool execution plugin |
| `@hackdevcode/dsh-tool-executor-ptc` | yes | PTC program execution, tool bindings, and generated SDK prompts |
| `@hackdevcode/dsh-tools` | no | Tool registry and execution pipeline for the Hack Dev Code |

## credentials

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-authorization` | no | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |
| `@hackdevcode/dsh-credentials-local` | yes | File-backed credentials provider ($DSH_HOME/.env under the live process environment) for the Hack Dev Code |
| `@hackdevcode/dsh-deepseek-account-platform` | yes | Authorize DeepSeek accounts through browser PKCE |

## deliverables

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-deliverable-file-references` | no | Shared model guidance for file links and deliverables across Hack Dev Code hosts |
| `@hackdevcode/dsh-tool-present` | yes | Explicit workspace file delivery declarations for the Hack Dev Code |
| `@hackdevcode/dsh-workspace-changes` | yes | Per-turn workspace file changes recorded from git working-tree snapshots and whole-file captures, with per-file comparisons, for the Hack Dev Code |

## document

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-office-to-pdf` | yes | Shared Office-to-PDF conversion with bounded queues and caching |

## experimental

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-action-cards` | yes | Optional action cards below answers: one shared proposal tool, card state, user actions and status notices |
| `@hackdevcode/dsh-client-ui-action-cards` | no | Action cards below completed answers: the shared card frame, kind bodies and the compact tool row |
| `@hackdevcode/dsh-client-ui-creation-recommendations` | no | Body of the personalized page card: location choice, creation progress, Keep, Undo and Restore |
| `@hackdevcode/dsh-client-ui-plugin-recommendations` | no | Official plugin card body with catalog text and enabling |
| `@hackdevcode/dsh-creation-recommendations` | no | Create persistent removable interface plugins from explicit conversation needs |
| `@hackdevcode/dsh-cua` | no | Shared Computer Use application objects, authorization, and logged tool execution |
| `@hackdevcode/dsh-experimental-agent-team` | yes | Implicit-root Agent Teams roster, direct peer messaging, and shared task DAG |
| `@hackdevcode/dsh-experimental-api-speech-to-text` | yes | Authenticated experimental speech transcription for browser clients |
| `@hackdevcode/dsh-experimental-auto-review` | no | Per-tool LLM authorization review for the Hack Dev Code Auto permission preset |
| `@hackdevcode/dsh-experimental-browser-use-chrome-devtools-mcp` | yes | Experimental per-Session Chromium browser tools through chrome-devtools-mcp |
| `@hackdevcode/dsh-experimental-browser-use-playwright-mcp` | yes | Experimental per-Session Chromium browser tools through @playwright/mcp |
| `@hackdevcode/dsh-experimental-browser-use-stagehand-native` | yes | Experimental Stagehand browser tools with separately configured native models |
| `@hackdevcode/dsh-experimental-claude-code-mods` | yes | Experimental bridge: load Claude Code mods (hooks modules) and run their hook chains on Hack Dev Code extension points |
| `@hackdevcode/dsh-experimental-client-ui-agent-team` | no | Web Agent Teams roster, task board, and teammate navigation |
| `@hackdevcode/dsh-experimental-client-ui-claude-code-mods` | no | Web band above the prompt for Claude Code mods: draws each session's mod tree and sends button presses back to the bridge |
| `@hackdevcode/dsh-experimental-client-ui-cot-translation` | yes | Optional machine translation of expanded reasoning, preserving original Session text |
| `@hackdevcode/dsh-experimental-client-ui-forge` | yes | Sidebar panel for a Session's change requests, with a worktree option for new Sessions and its Host Remote |
| `@hackdevcode/dsh-experimental-client-ui-stats` | no | Per-turn and per-step context, timing, cache, and tool-cost table contributed as an experimental conversation View |
| `@hackdevcode/dsh-experimental-client-ui-voice-input` | no | Record speech and insert editable text into the conversation draft |
| `@hackdevcode/dsh-experimental-computer-use-cua-driver-mcp` | yes | Experimental computer use through an installed Cua Driver MCP executable |
| `@hackdevcode/dsh-experimental-computer-use-cua-driver-native` | no | Experimental computer-use provider embedding the Cua Driver native npm SDK |
| `@hackdevcode/dsh-experimental-cua-macos` | yes | macOS native provider for shared Computer Use application and window objects |
| `@hackdevcode/dsh-experimental-forge` | yes | Provider-neutral change request registry with shared status polling |
| `@hackdevcode/dsh-experimental-forge-github` | yes | GitHub provider for the experimental forge registry, read through the GitHub CLI on the host |
| `@hackdevcode/dsh-experimental-forge-session` | yes | Binds change requests to the Session that created, pushed, or tracked them |
| `@hackdevcode/dsh-experimental-inspector` | yes | Experimental cross-realm CDP hub for Host debugging and Client Runtime inspection |
| `@hackdevcode/dsh-experimental-ptc-runtime-python` | yes | CPython subprocess implementation of the Hack Dev Code PTC execution seam |
| `@hackdevcode/dsh-experimental-session-inspector` | no | Experimental virtualized Session log and live Chat group/node inspectors |
| `@hackdevcode/dsh-experimental-speech-to-text` | yes | Experimental speech recognition with independently selectable providers |
| `@hackdevcode/dsh-experimental-speech-to-text-sensevoice` | yes | Local SenseVoice ONNX transcription with a managed sherpa-onnx process |
| `@hackdevcode/dsh-experimental-subagent-oar` | yes | Experimental one-shot subagents through OAR runtimes |
| `@hackdevcode/dsh-experimental-tool-agent-team` | yes | Scoped model-facing Agent Teams tools over ctx.agentTeams |
| `@hackdevcode/dsh-experimental-tool-subagent-oar` | yes | Delegate standalone tasks to configured external subagent providers |
| `@hackdevcode/dsh-experimental-tool-worktree` | no | Model tool that creates and enters a new Git worktree |
| `@hackdevcode/dsh-experimental-translator` | yes | Machine translation with reusable Session results |
| `@hackdevcode/dsh-experimental-worktree` | yes | Creates a named Git worktree and changes the calling Session working directory |
| `@hackdevcode/dsh-hooks-claude-code` | yes | Bridge plugin: run a Claude Code hooks.json / settings hook config on the Hack Dev Code interception seams |
| `@hackdevcode/dsh-hooks-codex` | yes | Bridge plugin: run a Codex hooks.json hook config on the Hack Dev Code interception seams |
| `@hackdevcode/dsh-plugin-recommendations` | no | Official plugin suggestions with explicit user activation and persistent conversation decisions |
| `@hackdevcode/dsh-session-title-all-prompts-llm` | yes | All-user-messages LLM provider plugin for Hack Dev Code session titles |
| `@hackdevcode/dsh-skill-badge` | no | Bundled dsh badge skill provider for Hack Dev Code |
| `@hackdevcode/dsh-tool-ralph` | yes | Model-facing fresh-agent Ralph loop over the workflow and subagent seams |
| `@hackdevcode/dsh-tool-session-query` | yes | Workspace-authorized model-facing session history search, trace, and event read tools |
| `@hackdevcode/dsh-tool-terminal` | yes | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |
| `@hackdevcode/dsh-webhook` | no | Fire-and-forget webhook rule runtime that creates Workspace-backed Hack Dev Code Sessions |
| `@hackdevcode/dsh-webhook-github` | yes | Signed GitHub HTTP webhook adapter for the Hack Dev Code webhook runtime |

## extensions

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-client-ui-cordis` | no | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| `@hackdevcode/dsh-cordis-client-runner` | no | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |
| `@hackdevcode/dsh-cordis-host-runner` | yes | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |
| `@hackdevcode/dsh-tool-cordis` | no | Read-only runtime API inspection for Harness plugin development |

## feedback

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-command-feedback` | no | Log-only session feedback: the record event, the sessionFeedback Host Remote, and the human-facing slash command |
| `@hackdevcode/dsh-message-feedback` | yes | Canonical Session-log ratings and notes for finalized assistant messages |

## fs

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-fs-local` | yes | Local-filesystem implementation of the Hack Dev Code filesystem seam (ctx.fs) |
| `@hackdevcode/dsh-fs-observation-policy` | no | File-context policy plugin for the Hack Dev Code — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |
| `@hackdevcode/dsh-fs-sandbox` | yes | Sandbox-enforcing implementation of the Hack Dev Code filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |
| `@hackdevcode/dsh-tool-fs` | yes | Model-facing filesystem tools (read, write, edit) over the Hack Dev Code filesystem seam (ctx.fs) |
| `@hackdevcode/dsh-tool-fs-search` | yes | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| `@hackdevcode/dsh-tool-str-replace-editor` | yes | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |

## goal

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-command-goal` | no | Human-facing slash command for persisted same-session goals |
| `@hackdevcode/dsh-goal` | yes | Event-sourced same-session goal state and lifecycle service for the Hack Dev Code |
| `@hackdevcode/dsh-goal-round-driver` | no | Race-fenced same-session goal-round driver |
| `@hackdevcode/dsh-tool-goal` | yes | Model-facing same-session goal tools with execution-time authority checks |

## guard

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-repeat-tool-reminder` | yes | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| `@hackdevcode/dsh-tool-call-timeout-policy` | no | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |

## hackdev

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-client-ui-hackdev` | no | Web card for Hack Dev Code missions and gate reviews: tasks, gate verdicts, issues and items needing human approval |
| `@hackdevcode/dsh-tool-hackdev` | yes | Hack Dev Code mission tools: planning council, parallel builders with shared memory, and verifier, quality/UX and security gates |

## host

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-host-directory-picker-auto` | no | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the Hack Dev Code web GUI host |
| `@hackdevcode/dsh-host-directory-picker-browse` | yes | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| `@hackdevcode/dsh-host-directory-picker-native` | no | Native-OS-chooser backend of the directory-picker seam for the Hack Dev Code web GUI host |
| `@hackdevcode/dsh-host-frontend-static` | yes | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |
| `@hackdevcode/dsh-host-open-in-app` | yes | Host half of open-in-app: resolved application catalog, icons, and the launch endpoint as three webServer routes |
| `@hackdevcode/dsh-host-plugin-inventory` | no | Read-only Remote projection of current Cordis Loader plugin state |
| `@hackdevcode/dsh-host-product-telemetry-otel` | yes | Explicit product usage events exported through OpenTelemetry HTTP logs |
| `@hackdevcode/dsh-host-webserver` | yes | Web route-registration plugin: HTTP and upgrade routes, per-Peer index transform taps, and static dist fallback |

## interaction

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-commands` | no | Plugin-owned human command registry for Hack Dev Code UIs |
| `@hackdevcode/dsh-permission-presets` | yes | User-facing permission presets (ctx.permissionPresets) for the Hack Dev Code: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |
| `@hackdevcode/dsh-tool-ask-user` | yes | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| `@hackdevcode/dsh-user-approval` | yes | User-approval seam (ctx.approval) for the Hack Dev Code: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `@hackdevcode/dsh-user-questions` | no | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |

## jobs

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-jobs-local` | yes | Process-local implementation of the Hack Dev Code background job registry seam |
| `@hackdevcode/dsh-tool-jobs` | yes | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |

## llm

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-deepseek-llm-api-extensions` | no | Additive request-field registry for the official DeepSeek LLM API adapter |
| `@hackdevcode/dsh-llm` | no | Provider-neutral LLM service interface for the Hack Dev Code |
| `@hackdevcode/dsh-llm-deepseek-account` | yes | DeepSeek account provider authentication and discovery |
| `@hackdevcode/dsh-llm-deepseek-api-key` | yes | DeepSeek api-key provider authentication and discovery |
| `@hackdevcode/dsh-llm-pi-ai` | yes | pi-ai-backed DeepSeek adapter for the Hack Dev Code LLM seam (design-verification twin of dsh-llm-deepseek) |
| `@hackdevcode/dsh-llm-retry` | yes | Provider-routed LLM request retry policy for the Hack Dev Code |
| `@hackdevcode/dsh-plugin-package-inventory-deepseek` | yes | Active Loader-backed plugin package inventory for official DeepSeek LLM API requests |
| `@hackdevcode/dsh-token-meter` | yes | Replay-aware token measurement service (ctx.tokenMeter) for the Hack Dev Code |

## lsp

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-lsp` | no | Abstract LSP capability seam (ctx.lsp) for the Hack Dev Code — language-server provider registry keyed by branded id and extension mapping, order-independent per-query selection, normalized definition/references/implementation/hover requests and results, and the LspError taxonomy |
| `@hackdevcode/dsh-lsp-stdio` | yes | Generic stdio language-server provider for the Hack Dev Code LSP capability seam (ctx.lsp) — spawns configured servers, translates JSON-RPC, and serves transient-open goToDefinition/findReferences/goToImplementation/hover queries in the host filesystem namespace |
| `@hackdevcode/dsh-tool-lsp` | yes | Model-facing lsp tool over the Hack Dev Code LSP capability seam (ctx.lsp) — one read-only tool with goToDefinition/findReferences/goToImplementation/hover operations, one-based UTF-16 cursor coordinates, bounded location rendering, and hover normalization |

## mcp

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-mcp-client` | yes | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| `@hackdevcode/dsh-mcp-resources` | no | Scoped MCP resource discovery and reading through shared model tools |

## plan

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-plan-mode` | yes | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |

## preset

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-agent-preset` | yes | Declare an Agent capability composition in Cordis YAML |
| `@hackdevcode/dsh-agent-preset-registry` | yes | Declarative Agent preset registry and profile-backed editing |
| `@hackdevcode/dsh-persona` | yes | Composition-authored deployment persona section for the Hack Dev Code |

## ptc-runtime

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-ptc-runtime-node` | yes | Node PTC execution with async function, REPL and VM Script evaluators and optional retained state |

## sandbox

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-sandbox-local` | yes | Local process-sandbox backends for the Hack Dev Code sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |
| `@hackdevcode/dsh-sandbox-policy` | yes | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |

## schedule

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-schedule` | yes | Host-wide durable reminders with shared management and original-Session delivery |
| `@hackdevcode/dsh-tool-schedule` | no | Model-facing reminder management tools (schedule_create, schedule_list, schedule_update, schedule_delete) over the Host ctx.schedule service |

## sdk

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-sdk-jsonrpc-server` | yes | Stdio JSON-RPC server plugin for out-of-process Hack Dev Code SDK clients |

## session

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-message-quotes` | no | Selected-text quotation and Markdown blockquote presentation |
| `@hackdevcode/dsh-session-checkpoint-policy` | no | Semantic session durability checkpoints before model requests and tool side effects |
| `@hackdevcode/dsh-session-log-deepseek` | yes | Incremental lossless session-log request extension for the official DeepSeek LLM API |
| `@hackdevcode/dsh-session-persistence-jsonl` | yes | JSONL durable session persistence backend for the Hack Dev Code |
| `@hackdevcode/dsh-session-projection` | no | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `@hackdevcode/dsh-session-projection-cache` | yes | Persisted projection cache (ctx.sessionProjectionCache): durable per-session checkpoint records on the session_projcache storage domain (per-record layout), throttled write-behind, and the cached listing read |
| `@hackdevcode/dsh-session-stats` | no | Whole-log conversation counts and wall times projection (sessionStats) for the Hack Dev Code |
| `@hackdevcode/dsh-session-telemetry-otel` | yes | Feedback-authorized Session logs over byte-bounded OpenTelemetry HTTP requests |
| `@hackdevcode/dsh-session-title` | yes | Log-backed session title service and provider registry for the Hack Dev Code |
| `@hackdevcode/dsh-session-title-first-prompt-llm` | yes | First-message LLM provider plugin for Hack Dev Code session titles |
| `@hackdevcode/dsh-session-turn-outline` | no | Whole-log turn outline projection (turnOutline) for the Hack Dev Code |
| `@hackdevcode/dsh-tool-working-directory` | no | Read and change the active Session working directory |
| `@hackdevcode/dsh-working-directory` | yes | Session working directories with durable changes and model context |

## session-query

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-session-log-export` | yes | Web Session-log ZIP export and Session Markdown copy |
| `@hackdevcode/dsh-session-query-sqlite` | yes | Concrete ctx.sessionQuery backend with SQLite FTS5 search |

## settings

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-settings` | no | Abstract user-settings seam (ctx.settings) for the Hack Dev Code |

## shell

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-bash-local` | yes | Local-subprocess implementation of the Hack Dev Code bash executor seam |
| `@hackdevcode/dsh-bash-sandbox` | yes | Sandbox-consuming implementation of the Hack Dev Code bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@hackdevcode/dsh-pwsh-local` | yes | Local PowerShell implementation of the Hack Dev Code bash executor seam |
| `@hackdevcode/dsh-pwsh-sandbox` | yes | Sandbox-consuming implementation of the Hack Dev Code PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@hackdevcode/dsh-shell-env` | yes | Tool-independent managed DSH_* shell environment registry |
| `@hackdevcode/dsh-tool-bash` | yes | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `@hackdevcode/dsh-tool-bash-persistent` | yes | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| `@hackdevcode/dsh-tool-pwsh` | yes | Model-facing pwsh tool over the bash executor seam |
| `@hackdevcode/dsh-tool-pwsh-persistent` | yes | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |

## skill

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-skill` | yes | Agent skill provider registry for the Hack Dev Code |
| `@hackdevcode/dsh-skill-filesystem` | yes | Local filesystem skill provider for the Hack Dev Code |
| `@hackdevcode/dsh-skill-office` | yes | Bundled Word, PowerPoint, and Excel workflows and LibreOffice Kit operations |
| `@hackdevcode/dsh-tool-skill` | yes | Model-facing skill loading tool for the Hack Dev Code |
| `@hackdevcode/dsh-tool-workspace-dependencies` | yes | The load_workspace_dependencies tool: absolute paths into a bundled Python, Node.js, and pnpm payload |

## spill

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-spill-local` | yes | Local-filesystem implementation of the Hack Dev Code spill storage seam (private session-scoped files) |
| `@hackdevcode/dsh-spill-policy` | yes | Token-budgeted tool-result retention with recoverable text and image paths |

## ssh

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-fs-ssh` | no | Filesystem provider over the shared POSIX SSH helper |
| `@hackdevcode/dsh-sandbox-ssh` | no | Remote POSIX sandbox argv provider over the shared SSH helper |
| `@hackdevcode/dsh-ssh` | yes | Shared OpenSSH connection and versioned POSIX remote helper |
| `@hackdevcode/dsh-subprocess-ssh` | no | Subprocess and terminal provider over the shared POSIX SSH helper |

## storage

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-storage` | no | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the Hack Dev Code |
| `@hackdevcode/dsh-storage-domain` | yes | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the Hack Dev Code |
| `@hackdevcode/dsh-storage-json` | yes | JSON file KV storage backend for the Hack Dev Code storage hub |
| `@hackdevcode/dsh-storage-sqlite` | yes | SQLite storage backend (kv facet) for the Hack Dev Code storage hub |

## subagent

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-subagent` | yes | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| `@hackdevcode/dsh-subagent-acp` | yes | Out-of-process ACP subagent backend: drives a child agent in a spawned subprocess over the Agent Client Protocol |
| `@hackdevcode/dsh-subagent-claude-code` | yes | One-shot Claude Code subagent provider over the official Agent SDK |
| `@hackdevcode/dsh-subagent-codex` | yes | One-shot Codex subagent provider over the official app-server protocol |
| `@hackdevcode/dsh-subagent-dsh-sdk` | yes | Out-of-process SDK subagent backend: drives a child Hack Dev Code runtime subprocess over stdio JSON-RPC through the TypeScript SDK client |
| `@hackdevcode/dsh-subagent-fork-in-process` | yes | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| `@hackdevcode/dsh-subagent-spawn-in-process` | yes | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| `@hackdevcode/dsh-tool-subagent` | yes | Model-facing subagent delegation tool over the ctx.subagents seam |
| `@hackdevcode/dsh-tool-subagent-control` | no | Shared messaging, interruption, and child discovery tools for subagents |

## subprocess

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-subprocess-local` | no | Local-subprocess implementation of the Hack Dev Code subprocess seam |

## telemetry

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-otel` | no | Cordis service for independent ordinary-event and byte-bounded Session-log OTLP channels |

## terminal

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-terminal` | no | Persistent PTY session seam for the Hack Dev Code — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |
| `@hackdevcode/dsh-terminal-bash` | yes | Persistent shell PTY backend over the Hack Dev Code subprocess terminal primitive |

## test-support

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-llm-replay` | yes | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL (keyless snapshot tests) |

## todo

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-tool-todo` | yes | Model-facing todo_write tool over the Hack Dev Code event-sourced session log |

## typert

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-typert-loader` | yes | Loader integration for generated Typert package contributions |

## web

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-tool-web` | yes | Model-facing web tools (web_search, web_fetch) over the Hack Dev Code web capability seam (ctx.web) |
| `@hackdevcode/dsh-web` | yes | Abstract web access capability seam (ctx.web) for the Hack Dev Code — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |
| `@hackdevcode/dsh-web-deepseek-api` | yes | DeepSeek Search and Fetch API providers for the Hack Dev Code web capability seam (ctx.web) |
| `@hackdevcode/dsh-web-fetch-http` | yes | Anonymous HTTP(S) fetch provider for the Hack Dev Code web capability seam (ctx.web) |
| `@hackdevcode/dsh-web-search-deepseek` | yes | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the Hack Dev Code web capability seam (ctx.web) |
| `@hackdevcode/dsh-web-search-exa` | yes | Exa-backed search provider for the Hack Dev Code web capability seam (ctx.web) |
| `@hackdevcode/dsh-web-search-perplexity` | yes | Perplexity-backed search provider for the Hack Dev Code web capability seam (ctx.web) |

## workflow

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-tool-workflow` | yes | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| `@hackdevcode/dsh-workflow-ptc` | yes | Workflow orchestration in the shared sandboxed Node PTC runtime |

## workspace

| Package | Config | Description |
|---|---|---|
| `@hackdevcode/dsh-workspace` | no | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the Hack Dev Code |
