---
description: "Run Cua Driver computer-use tools from its native npm SDK, with durable screenshots and explicit host desktop permissions."
kind: "package-reference"
---

# @hackdevcode/dsh-experimental-computer-use-cua-driver-native

## Summary

Use Cua Driver to inspect and operate desktop windows without installing its separate CLI or application. The native npm dependency runs inside the DSH host and exposes Cua Driver's own tools. Screenshots reach image-capable models through durable attachments. This published experimental package requires the launching host's desktop permissions and remains an explicit composition choice.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already supplies the tool registry and system prompt.

### Minimal configuration

```yaml
- name: '@hackdevcode/dsh-computer-use'
- name: '@hackdevcode/dsh-experimental-computer-use-cua-driver-native'
```

It loads the exact Cua Driver npm version declared in [package.json](package.json) and uses its same-process defaults.

| Field | Default | Effect |
|---|---|---|
| `toolset` | `essential` | `essential` leaves out recording and replay, the agent cursor overlay, driver configuration, session bookkeeping and ffmpeg installation; `all` exposes the whole upstream catalog. |
| `elevation` | `ask` | Windows: real input and window actions for apps running as administrator go through an administrator helper that Windows asks the person to approve once per session; `off` refuses them with an explanation. |
| `onDemand` | `true` | Keeps the desktop tools out of requests until the agent loads them: `desktop` holds the whole-desktop tools and the core window tools (`list_apps`, `list_windows`, `get_window_state`, `launch_app`, `click`, `set_value`, `type_text`, the clipboard); `desktop-more` holds the rest of the driver catalog. | Native import, runtime initialization, malformed catalog, duplicate tool name, or occupied computer-use registration failures reject activation and roll back owned resources. The registered provider name is `cua-driver-native`.

Use an attachment store and a model route that explicitly declares image input to receive screenshots. The [MCP result adapter](../../mcp/mcp-client/README.md) owns image admission and diagnostic behavior; programmatic callers retain the canonical raw result when a model cannot receive its images. Calls use Cua Driver's upstream tool parameters and results.

### Whole-desktop tools

On Windows and Linux (X11) the provider adds tools that act on the whole desktop with real input, beside the window-targeted driver tools:

| Tool | Does |
|---|---|
| `desktop_list_displays` | Lists every monitor with its position on the virtual desktop. |
| `desktop_screenshot` | Captures one window, one display, a region or all of them, scaled to `max_dimension` (default 1280), and returns the image itself (through the MCP result adapter's durable attachments) with how image points map to desktop coordinates; with `ocr`, also the text recognized in it. On Windows a window behind others is captured without bringing it to the front. |
| `desktop_pointer`, `desktop_drag`, `desktop_scroll` | Move, click (optionally holding ctrl, shift or alt), drag and turn the wheel at virtual-desktop coordinates on any display. `desktop_pointer` also takes `image_x`/`image_y`, a point in the latest screenshot, and converts it, and `press: down|up` to hold a button over several steps. Linux drags move in steps so drop targets see the pointer travel. |
| `desktop_keys`, `desktop_type` | Press key chords (`win+r`, `ctrl+shift+esc`, `alt+tab enter`) and type any text into the foreground window, optionally focusing a window first; the result names the window that received the input. Text over 500 characters is pasted through the clipboard, whose every format is saved and restored (on Linux through xclip, falling back to typing). `desktop_keys` takes `hold: down|up` to keep one chord pressed, such as shift for a series of clicks. Anything still held is released when the tools unload. |
| `desktop_window` | Lists top-level windows and dialogs; reads a window through UI Automation on Windows or AT-SPI on Linux (bounded to 300 elements, 8000 characters and 4 seconds), numbering each control `[n]` with its centre point and state (the taskbar, secondary taskbars and hidden tray icons are listed by name), and adding OCR text when the window exposes few controls; focuses, minimizes, maximizes, restores, closes or moves and resizes one by handle, title or process name; waits for a window to appear or close, or until a window shows a text. |
| `desktop_element` | Acts on one control by its `[n]` number or by its visible name, type or automation id: find, click, double or right click at the point the app reports, or invoke, toggle, expand, collapse, select, set_value and focus through UI Automation patterns (falling back to a real click, or click, select all and type). A name no control has is looked for in the OCR text for click actions. Windows only; elsewhere it explains what to use instead. |
| `desktop_ocr` | Reads the text on screen in one window, one display, a region or every display with the OCR engine built into Windows 10 and 11 (or tesseract on Linux), each line with its centre point. |
| `desktop_open` | Starts an installed app by name (`app`: the Start-menu entry, else a command) and reports the window it opened; or opens a file, folder, URL or settings URI (`ms-settings:display`) with its default handler. |
| `desktop_sequence` | Runs up to 30 of these actions (launch, open, keys, type, wait, read, ocr, element, window actions, move, click, drag, scroll, sleep) in order in one call, stopping at the first failure. |

Numbered controls and OCR give exact points, so a model that cannot see images (DeepSeek, most local models) never has to guess coordinates.

Windows of apps running as administrator are marked `[administrator]`. Windows drops input that a normal process sends to them, so that input goes through an administrator helper: it starts on first need through Windows' "Run as administrator" prompt, accepts only a fixed table of input and window commands (never scripts) over a named pipe that only this user may open, checks the connecting process id and a one-time secret, and exits when the connection closes or when nobody connects within a minute. The desktop session sends nothing until it has confirmed the pipe is served by exactly the process the UAC prompt started. Its script is written to a temporary file and run by a bootstrap that verifies the file's SHA-256 before running the bytes it checked; for the elevated start the bootstrap first limits module loading to the system folder and compiles in a folder only administrators and SYSTEM can write to. UAC prompts and the lock screen stay out of reach by design: they run on the secure desktop.

Real input reaches what background delivery cannot: the Start menu, taskbar, tray, shell shortcuts, and apps that ignore posted messages such as modern Notepad, Calculator and Settings. It moves the person's pointer and focus. On Windows one hidden Windows PowerShell session compiles the native helper once and serves every call (a warm call takes tens of milliseconds); it restarts after a step exceeds 30 seconds. Linux needs `x11-xserver-utils xdotool imagemagick wmctrl xdg-utils`; a missing helper or a Wayland-only session is reported with the fix.

### Host requirements

The native dependency supplies platform binaries through npm optional dependencies. Keep optional dependencies enabled. Grant desktop permissions to the application that launches DSH; this provider neither installs a permission-owning app nor changes OS grants. The native runtime shares the host process, so native crashes can terminate that process. Use the [installed MCP provider](../computer-use-cua-driver-mcp/README.md) when the separate Cua Driver application should own permissions and execution.

### Verify the installed SDK

From the repository root, run this opt-in check against the installed native dependency. It discovers tools, reads permission status with `prompt: false`, and verifies teardown; it captures no screenshots, sends no input, and requests no OS permissions. Clearing `NODE_USE_ENV_PROXY` prevents Node from installing the launching shell's proxy before test setup.

```sh
env -u NODE_USE_ENV_PROXY DSH_COMPUTER_USE_NATIVE_E2E=1 node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts packages/experimental/computer-use-cua-driver-native/tests/native.e2e.ts
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider reserves the shared computer-use registration before loading native code. A child plugin owns discovery, model tools, guidance, and the native runtime. The parent retains the registration until child teardown has removed tools, interrupted native calls and image-capability admission, awaited settlement, and completed native shutdown. Cancellation does not undo input already delivered to an application.

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Native runtime ownership, catalog validation, tool registration, and provider guidance |
| [src/displays.ts](src/displays.ts) | Whole-desktop tools and their Windows and Linux backends |
| [src/keys.ts](src/keys.ts) | Key names to Windows virtual keys and X11 keysyms |
| [src/powershell.ts](src/powershell.ts) | The reused PowerShell session with a line protocol and timeout restart |
| [src/elevated.ts](src/elevated.ts) | Input operations and the administrator helper: its command table, launch and pipe client |
| [src/snapshot.ts](src/snapshot.ts) | Bounded window snapshots and snapshot identity in result text |

Tool definitions reuse the existing MCP result adapter. Cua Driver's JSON catalog determines the schemas; its raw result supplies canonical text, structured output, and image bytes. The computer-use service carries only the provider name and exclusive registration.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Computer-use service](../../computer-use/computer-use/README.md) — exclusive named registration.
- [MCP client](../../mcp/mcp-client/README.md) — shared result and image projection.
- [Cua Driver SDK](https://cua.ai/docs/reference/cua-driver/sdk-reference) — upstream runtime API and host facilities.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

The provider contributes the following computer-use guidance while its native tools are mounted.

##### Native Cua Driver guidance

```markdown
Cua Driver native computer-use tools operate the host desktop. Discover the exact app and window, then get a fresh window snapshot before acting. Use element_token from that snapshot, or coordinates from its screenshot. A new snapshot of that window invalidates its earlier element tokens: never take a snapshot and act with older tokens in the same step, and after "element_token is stale" use only tokens from the newest snapshot. Pass element_index only together with that snapshot's snapshot_id. Select either target or the legacy pid/window_id fields; do not combine them.

Work with several applications by keeping each window's pid and window_id; actions on one window do not need it in front. Keep snapshots small: pass query to find specific controls, and include_screenshot=false when you only need fresh element tokens. Modern Notepad and other WinUI apps ignore posted shortcuts and typing; use desktop_keys and desktop_type (real keyboard input to the foreground window) for them. launch_app can return a window that was already open (Notepad, Calculator and browsers reuse one window): before typing, check the window title and contents, and never type into the person's own document; open a new tab or window for new work.

Prefer background delivery. A refusal does not authorize a foreground retry. Verify the requested outcome from fresh state after an action; a delivered click alone does not prove the outcome. After cancellation, inspect current state before retrying because completed input is not rolled back. Other sessions and applications may change the same desktop.

On macOS, cursor-overlay operations may return facility_unavailable even when screenshots and input work.
```

#### Token effect

This fixed guidance adds system-prompt tokens while the provider is mounted. Upstream guidance resources are not automatically loaded.

#### KV Cache effect

The unchanged guidance preserves its repeated prompt prefix. Mounting, removing, or editing it changes that prefix and can reduce cache reuse.

### Whole-desktop guidance and tools

#### What the model sees

On Windows and Linux a second guidance section explains when to use real input instead of background delivery, how display coordinates work, that results name the window receiving input, that apps running as administrator, UAC prompts and the lock screen refuse input from a normal process, how to act on numbered controls and OCR text instead of guessing coordinates, how to start apps by name and wait for text, and how to fill a file dialog. The `desktop_*` tools return text; `desktop_screenshot` returns the image with its coordinate mapping.

#### Token effect

The section and twelve tool definitions add request tokens while the `desktop` group is loaded; with `onDemand` they cost nothing until then. A window read now carries an index, a centre point and states per control, which makes it somewhat longer than before but replaces screenshots for most checks. The driver's full essential catalog is about 21K tokens per request, so only the core window tools join `desktop` and the rest wait in `desktop-more`. `desktop_sequence` replaces several model round trips with one call. Window lists grow with the number of open windows.

#### KV Cache effect

Loading the group changes the tool-definition prefix once; afterwards it stays stable.

### Discovered Cua Driver tools and results

#### What the model sees

Tools use the `cua_driver_native__` prefix followed by the upstream name and retain the upstream descriptions and input schemas. Upstream tool refusals become tool errors. Supported screenshots appear as durable image references beside result text; the canonical raw result remains available to programmatic callers.

#### Token effect

The discovered catalog adds tool definitions to each request. Accessibility trees, result text, and admitted screenshots add per-call context. Raw base64 remains in execution-local canonical values and is not copied into model history.

#### KV Cache effect

An unchanged catalog preserves its tool-definition prefix. Tool results append to Session history. Replacing the provider or its catalog changes the model-visible tools and can reduce prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The package preserves the upstream driver's platform and application limits.

- **Host permissions and graphics session** — npm installation does not grant desktop access or create a graphical session.
- **Native cursor overlay** — a headless macOS Node host can receive `facility_unavailable` for overlay operations while screenshots and background input remain usable.
- **Shared desktop** — the provider does not reserve windows or complete workflows for a Session. Other callers and applications can change the same desktop between calls.
- **Cancellation** — an aborted call can have delivered input already; inspect fresh state before retrying. The provider waits for SDK shutdown during unload but does not promise native action rollback.
- **Failed shutdown** — if native shutdown fails, the registration remains occupied. Restart the host before mounting another computer-use provider.
- **Experimental release** — tool schemas follow the pinned upstream SDK and have no DSH stability promise.
- **Secure desktop** — no process can operate UAC prompts or the lock screen; the tools tell the agent to ask the person. Apps running as administrator are reachable through the approved administrator helper.
- **Wayland** — the Linux whole-desktop tools need X11 or XWayland; a pure Wayland session is reported as unsupported.
- **Linux window text** — needs the AT-SPI accessibility bus (`python3-gi gir1.2-atspi-2.0 at-spi2-core`) and apps that expose accessibility; the error names the packages.
- **macOS** — the whole-desktop tools are not registered; the driver's own tools cover macOS.
- **Linux controls** — `desktop_element` needs UI Automation and is Windows-only; on Linux use the read text, `desktop_ocr` (tesseract, `sudo apt-get install -y tesseract-ocr`) and `desktop_pointer`. Linux paste needs `xclip`; without it long text is typed.
- **OCR languages** — Windows OCR uses the languages installed for the person's profile; one without the optical character recognition feature reports how to add it.
- **Elevated windows** — controls of an app running as administrator are read from the normal session, where Windows may hide some of them; clicks still go through the administrator helper.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
