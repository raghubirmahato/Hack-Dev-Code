---
description: "Run Cua Driver computer-use tools from its native npm SDK, with durable screenshots and explicit host desktop permissions."
kind: "package-reference"
---

# @hackdevcode/dsh-computer-use-cua-driver-native

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
- name: '@hackdevcode/dsh-computer-use-cua-driver-native'
```

It loads the exact Cua Driver npm version declared in [package.json](package.json) and uses its same-process defaults.

| Field | Default | Effect |
|---|---|---|
| `toolset` | `essential` | `essential` leaves out recording and replay, the agent cursor overlay, driver configuration, session bookkeeping and ffmpeg installation; `all` exposes the whole upstream catalog. |
| `elevation` | `ask` | Windows: real input and window actions for apps running as administrator go through an administrator helper that Windows asks the person to approve once per session; `off` refuses them with an explanation. |
| `onDemand` | `true` | Keeps the desktop tools out of requests until the agent loads them: `desktop` holds the whole-desktop tools and the core window tools (`list_apps`, `list_windows`, `get_window_state`, `launch_app`, `click`, `set_value`, `type_text`, the clipboard); `desktop-more` holds the rest of the driver catalog. | Native import, runtime initialization, malformed catalog, duplicate tool name, or occupied computer-use registration failures reject activation and roll back owned resources. The registered provider name is `cua-driver-native`.

Use an attachment store and a model route that explicitly declares image input to receive screenshots. The [MCP result adapter](../../mcp/mcp-client/README.md) owns image admission and diagnostic behavior; programmatic callers retain the canonical raw result when a model cannot receive its images. Calls use Cua Driver's upstream tool parameters and results.

### Whole-desktop tools

On Windows and Linux the provider adds tools that act on the whole desktop with real input, beside the window-targeted driver tools:

| Tool | Does |
|---|---|
| `desktop_list_displays` | Lists every monitor with its position on the virtual desktop. |
| `desktop_screenshot` | Captures one window, one display, a region or all of them, scaled to `max_dimension` (default 1280), and returns the image itself (through the MCP result adapter's durable attachments) with how image points map to desktop coordinates; with `ocr`, also the text recognized in it. On Windows a window behind others is captured without bringing it to the front. |
| `desktop_pointer`, `desktop_drag`, `desktop_scroll` | Move, click (optionally holding ctrl, shift or alt), drag and turn the wheel at virtual-desktop coordinates on any display. `desktop_pointer` also takes `image_x`/`image_y`, a point in the latest screenshot, and converts it, and `press: down|up` to hold a button over several steps. Linux drags move in steps so drop targets see the pointer travel. Before a drag, `desktop_drag` names the windows under its start and drop points and any other app's window the path crosses (Windows, and X11 through `xprop`); with `onto`, it refuses before pressing anything when that window is not under the drop point. |
| `desktop_keys`, `desktop_type` | Press key chords (`win+r`, `ctrl+shift+esc`, `alt+tab enter`) and type any text into the foreground window, optionally focusing a window first; the result names the window that received the input. Text over 500 characters is pasted through the clipboard, whose every format is saved and restored (on Linux through xclip, falling back to typing). `desktop_keys` takes `hold: down|up` to keep one chord pressed, such as shift for a series of clicks. Anything still held is released when the tools unload. |
| `desktop_window` | Lists top-level windows and dialogs; reads a window through UI Automation on Windows or AT-SPI on Linux (bounded to 300 elements, 8000 characters and 4 seconds), numbering each control `[n]` with its centre point and state (the taskbar, secondary taskbars and hidden tray icons are listed by name), and adding OCR text when the window exposes few controls; focuses, minimizes, maximizes, restores, closes or moves and resizes one by handle, title or process name; waits for a window to appear or close, until a window shows a text, or with `stable` until it stops changing for `quiet_ms` (its text, or a fingerprint of a small capture when it has none); and `reserve`s a window for one task or `release`s it (see [Reserve a window](#reserve-a-window)). |
| `desktop_element` | Acts on one control by its `[n]` number or by its visible name, type or automation id: find, click, double or right click at the point the app reports, or invoke, toggle, expand, collapse, select, set_value and focus through UI Automation patterns on Windows or AT-SPI actions and interfaces on Linux (falling back to a real click, or click, select all and type). A name no control has is looked for in the OCR text for click actions. |
| `desktop_ocr` | Reads the text on screen in one window, one display, a region or every display with the OCR engine built into Windows 10 and 11 (or tesseract on Linux), each line with its centre point. |
| `desktop_open` | Starts an installed app by name (`app`: the Start-menu entry, else a command) and reports the window it opened; or opens a file, folder, URL or settings URI (`ms-settings:display`) with its default handler. |
| `desktop_sequence` | Runs up to 30 of these actions (launch, open, keys, type, wait, read, ocr, element, window actions, move, click, drag, scroll, sleep, reserve, release) in order in one call, stopping at the first failure. |
| `desktop_setup` | Lists every desktop feature as ready or missing in this session, with what provides it, the steps that are not packages (starting `ydotoold`, turning on assistive technologies, a GNOME extension) and one command that installs every missing package with the apt, dnf, pacman or zypper names. |

Numbered controls and OCR give exact points, so a model that cannot see images (DeepSeek, most local models) never has to guess coordinates.

#### Several tasks at once

The mouse and keyboard are one resource for every task. Each input action holds them from bringing its window forward, through the reservation check, to its last key or click, so another task's focus change or input cannot land in between; waiting for an `expect` outcome and reading windows happen outside that turn. Bringing a window forward waits (up to 2 seconds) until the window manager really has it in front, and sends nothing when it does not come.

#### Reserve a window

`desktop_window` with `reserve` keeps one window for the calling task (the agent's session) for `seconds` (default 120, 10 to 600), renewed by each admitted action. Until it is released or the lease runs out, every input tool checks where its input would land before sending anything: the window under the point (Windows, X11) or the window in front. Input from another task into a reserved window is refused, and while a task holds reservations its own input into any other app's window is refused too, which catches a click about to land in a notification or a window that came to the front. Windows of the same process, such as its dialogs, count as the reserved window.

#### Verify and retry

`desktop_pointer`, `desktop_drag`, `desktop_scroll`, `desktop_keys`, `desktop_type`, `desktop_element` and every input step of `desktop_sequence` take an optional `expect` naming the outcome the action should bring about. The call then waits for it from fresh state and fails when it does not show, so a sequence stops before it acts on the wrong window:

| Field | Meaning |
|---|---|
| `text` | The window shows this text (with `gone`, no longer shows it), compared case-insensitively with runs of white space as one space. |
| `window_title` | A window whose title contains this opens (with `gone`, closes). |
| `changed` | `true`: the window's text differs from what it showed before the action. |
| `in` | The window whose text is checked; by default the window in front, chosen again at every check so a dialog the action opened counts. |
| `timeout_ms` | How long the outcome may take, 500 to 60000 ms (default 5000). |
| `retries` | Repeat the action up to 3 times when the outcome does not show. Refused for typing, launching, opening and toggling, which a repeat would undo or duplicate. |

```json
{"action": "element", "element_action": "click", "name": "Save", "expect": {"window_title": "Save As"}}
{"keys": "ctrl+s", "expect": {"text": "Saved", "retries": 1}}
```

Every expectation is validated before any input is sent, including all the steps of a sequence. A verified result ends with `Verified: …` (and the attempt that worked); a missed one says the action was sent, lists each attempt and shows what the window in front reads now. Only a missed outcome is repeated: an action that fails is not.

When an input action fails or is cancelled after it has sent input, the modifier keys (ctrl, shift, alt, win) and the mouse buttons the action uses are released, except those held on purpose with `hold: down` or `press: down`; the error says what was released, or what could not be. A cancellation still ends the call as cancelled.

Windows of apps running as administrator are marked `[administrator]`. Windows drops input that a normal process sends to them, so that input goes through an administrator helper: it starts on first need through Windows' "Run as administrator" prompt, accepts only a fixed table of input and window commands (never scripts) over a named pipe that only this user may open, checks the connecting process id and a one-time secret, and exits when the connection closes or when nobody connects within a minute. The desktop session sends nothing until it has confirmed the pipe is served by exactly the process the UAC prompt started. Its script is written to a temporary file and run by a bootstrap that verifies the file's SHA-256 before running the bytes it checked; for the elevated start the bootstrap first limits module loading to the system folder and compiles in a folder only administrators and SYSTEM can write to. UAC prompts and the lock screen stay out of reach by design: they run on the secure desktop.

Real input reaches what background delivery cannot: the Start menu, taskbar, tray, shell shortcuts, and apps that ignore posted messages such as modern Notepad, Calculator and Settings. It moves the person's pointer and focus. On Windows one hidden Windows PowerShell session compiles the native helper once and serves every call (a warm call takes tens of milliseconds); it restarts after a step exceeds 30 seconds. On Linux an X11 session uses `x11-xserver-utils xdotool imagemagick wmctrl xdg-utils`. A Wayland session (detected from `XDG_SESSION_TYPE`, or forced with `HACKDEV_DESKTOP_BACKEND=wayland` or `=x11`) sends input through `ydotool` (its `ydotoold` service writes to /dev/uinput, which every compositor accepts), captures the screen with `grim`, `gnome-screenshot` or `spectacle`, pastes through `wl-clipboard`, lists displays with `wlr-randr` (or XWayland), and lists and manages windows through Sway (`swaymsg`) or Hyprland (`hyprctl`); on other compositors the windows of X11 apps are listed through XWayland. There, apps the agent starts with `desktop_open` open as X11 apps (`GDK_BACKEND=x11`, `QT_QPA_PLATFORM=xcb` and the like), so they can be listed, read and operated; and while `ydotoold` is not running, input goes through `xdotool` to X11 apps, so the agent can work in the apps it started without any root setup. `desktop_open` on Linux also takes a command with arguments, split on spaces and never run through a shell. A missing helper is reported with the command that installs it. While the agent operates the Windows desktop, the session keeps the display awake and resets the idle timer every 50 seconds until 10 minutes after the last input (`keepAwakeMs`), so an idle lock does not interrupt the work; input refused because the lock screen or a UAC prompt is showing is reported as such.

### Host requirements

The native dependency supplies platform binaries through npm optional dependencies. Keep optional dependencies enabled. Grant desktop permissions to the application that launches DSH; this provider neither installs a permission-owning app nor changes OS grants. The native runtime shares the host process, so native crashes can terminate that process. Use the [installed MCP provider](../../experimental/computer-use-cua-driver-mcp/README.md) when the separate Cua Driver application should own permissions and execution.

### Verify the installed SDK

From the repository root, run this opt-in check against the installed native dependency. It discovers tools, reads permission status with `prompt: false`, and verifies teardown; it captures no screenshots, sends no input, and requests no OS permissions. Clearing `NODE_USE_ENV_PROXY` prevents Node from installing the launching shell's proxy before test setup.

```sh
env -u NODE_USE_ENV_PROXY DSH_COMPUTER_USE_NATIVE_E2E=1 node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts packages/computer-use/computer-use-cua-driver-native/tests/native.e2e.ts
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
| [src/verify.ts](src/verify.ts) | The `expect` argument (validation, the change wait, its description in results) and the wait for a window to stop changing |
| [src/atspi.ts](src/atspi.ts) | The AT-SPI script that reads, finds and operates Linux window controls in the Windows line format |
| [src/setup.ts](src/setup.ts) | The setup probes for Linux and Windows and the report with its install command |
| [src/powershell.ts](src/powershell.ts) | The reused PowerShell session with a line protocol and timeout restart |
| [src/elevated.ts](src/elevated.ts) | Input operations and the administrator helper: its command table, launch and pipe client |
| [src/snapshot.ts](src/snapshot.ts) | Bounded window snapshots and snapshot identity in result text |
| [src/error.ts](src/error.ts) | `CuaDriverError` and its closed code list |

Tool definitions reuse the existing MCP result adapter. Cua Driver's JSON catalog determines the schemas; its raw result supplies canonical text, structured output, and image bytes. The computer-use service carries only the provider name and exclusive registration.

A rejected native call throws `CuaDriverError` with `CUA_DRIVER_FAILED`, keeping the SDK's message and its error as `cause`; once the call or the provider is canceled, the cancellation propagates instead. A raw result that is not JSON throws `CUA_DRIVER_INVALID_RESULT`. Upstream tool refusals reported in a result stay with the MCP result adapter.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Computer-use service](../computer-use/README.md) — exclusive named registration.
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

On Windows and Linux a second guidance section explains when to use real input instead of background delivery, how display coordinates work, that results name the window receiving input, that apps running as administrator, UAC prompts and the lock screen refuse input from a normal process, how to act on numbered controls and OCR text instead of guessing coordinates, how to start apps by name and wait for text, how to pass `expect` so a call checks its own outcome, and how to fill a file dialog. The `desktop_*` tools return text; `desktop_screenshot` returns the image with its coordinate mapping.

#### Token effect

The section and thirteen tool definitions add request tokens while the `desktop` group is loaded; with `onDemand` they cost nothing until then. A window read now carries an index, a centre point and states per control, which makes it somewhat longer than before but replaces screenshots for most checks. The driver's full essential catalog is about 21K tokens per request, so only the core window tools join `desktop` and the rest wait in `desktop-more`. `desktop_sequence` replaces several model round trips with one call. The `expect` argument adds about 900 characters to each of seven tool definitions (about 1.5K tokens while the group is loaded) and one guidance line; a verified action saves the separate read or screenshot that checking it would otherwise take. Window lists grow with the number of open windows.

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
- **What `expect` proves** — it checks the window's text or the window list, not the pixels: text that was already shown before the action passes at once, so pick text that only the outcome brings, or use `changed`. A window that reads no text (a canvas, a game) can only be checked through `window_title`. A retry repeats the action even when the first attempt took effect after the check gave up.
- **Releasing keys after a failure** — the release is sent for every modifier rather than only those still down: the provider does not ask the system which keys an interrupted chord left pressed (Windows could answer through `GetAsyncKeyState`; the Linux input tools cannot). Apps normally ignore the release of a key that is up. A key the person is physically holding at that moment is released too.
- **Failed shutdown** — if native shutdown fails, the registration remains occupied. Restart the host before mounting another computer-use provider.
- **Pinned upstream tools** — the driver's own tool schemas follow the pinned upstream SDK; the whole-desktop tools this package adds (`desktop_*`) are covered by its tests.
- **Secure desktop** — no process can operate UAC prompts or the lock screen; the tools tell the agent to ask the person. Apps running as administrator are reachable through the approved administrator helper.
- **Wayland windows** — Sway and Hyprland expose all windows. GNOME does through the [Window Calls](https://extensions.gnome.org/extension/4724/window-calls/) extension and KDE through `kdotool`; without them only X11 apps (through XWayland) are listed. The desktop portals do not help here: they share a screen or window the person picks and pass input, but list no windows. Input, screenshots, OCR and clipboard work on every compositor. The GNOME and KDE paths follow those tools' documented output and are tested against it, not yet on a running GNOME or KDE desktop.
- **Linux window text and controls** — need the AT-SPI accessibility bus (`python3-gi gir1.2-atspi-2.0 at-spi2-core`) and apps that expose accessibility; the error names the packages. Each call starts its own Python process, so a control's number is its place in one fixed walk of the window rather than a remembered element: numbers from a read stay valid while the window keeps the same controls, and a window whose controls changed must be read again. The script is tested against a stand-in for the bus, not yet on a running Linux desktop.
- **macOS** — the whole-desktop tools are not registered; the driver's own tools cover macOS.
- **GNOME's input permission** — GNOME 46 and later start XWayland with `-enable-ei-portal`, which passes `xdotool`'s input through the remote desktop portal. When its permission has lapsed, the next input makes GNOME show a "Remote Desktop" prompt, and it holds every key and click until the person answers, then delivers them (some characters lost) to whatever window has focus by then. Verified on Kali with GNOME 50, where a test's held keystrokes later opened tabs in another Chrome window. The tools therefore look for a showing portal dialog through AT-SPI before every input and send nothing while one is up, and after 20 seconds without input they first send a one-pixel pointer nudge: if that makes GNOME ask, only the nudge is held. A missed `expect` outcome names the prompt, and `desktop_setup` says when this applies. Denying the prompt discards what it holds.
- **GNOME keeps native windows above the app** — GNOME can give an X11 window the keyboard without raising it above a native Wayland window (such as the person's own app), and no X11 request raises it. X cannot see native windows, so before a press on GNOME's XWayland route the pointer moves, X is asked what is under it, and nothing is pressed where X reports its root window; keys need an X11 window these tools list to have the keyboard. A covered `desktop_element` click is pressed through the control's accessible action instead. Verified on Kali, where an earlier test's drag would otherwise have landed in the person's terminal.
- **GTK 4 positions** — GTK 4 apps (GNOME Calculator, Text Editor) report control positions inside their window only and (0, 0) on screen. Their controls get no point in a read, and a click on one is pressed through its accessible action.
- **Long values** — a read shows a text control's first and last 1000 characters (2000 for other values' 200) on both Windows and Linux, so text appended at the end of a long document can be verified.
- **Typing newlines on Linux** — `xdotool` types a newline as the Linefeed key, which single-line fields ignore, so each newline is pressed as Return.
- **Dialogs GNOME keeps from focus** — GNOME may refuse focus to a modal dialog an app opens while another window has it, and a real click on such a dialog's button can be lost; `desktop_element invoke` presses it through AT-SPI instead and needs no focus. The guidance tells the model to prefer `invoke` on Linux.
- **Launching an app** — `desktop_open` waits about a second after the first new window, reports the largest new window as the app's, and names any others, since apps such as Mousepad show a restore-session prompt before their main window after a crash.
- **Chromium browsers and apps the agent starts** — `desktop_open` hides the Wayland display from apps on desktops that keep native windows private, so Chromium-based browsers and Electron apps open under XWayland too, sets `ACCESSIBILITY_ENABLED=1` and `QT_ACCESSIBILITY=1` so Chromium and Qt expose their controls, and adds `--force-renderer-accessibility` to Chromium-based browsers so web pages can be read. A browser that is already running opens a new window inside that (possibly native Wayland) instance instead; start a separate one with `--user-data-dir`. Reads skip the web pages of background tabs and drop the object replacement characters web content fills container values with. A text field that takes no direct value is focused through accessibility before typing, and an app's own popups (a browser's sign-in bubble) count as its windows for the keyboard check.
- **Live verification** — on Kali Linux (GNOME 50 on Wayland, XWayland 24.1) [tests/linux-workflow.e2e.ts](tests/linux-workflow.e2e.ts) and [tests/linux-chrome.e2e.ts](tests/linux-chrome.e2e.ts) (a throwaway Chrome: its profile picker read and a profile chosen, three local pages in tabs, a form filled and sent, a counter pressed three times, notes typed, state kept across tab switches, the second profile opened from the profile menu) pass end to end; the first runs with two tasks at once: Mousepad and GNOME Calculator started together, tiled and reserved, a long paste and a calculation in parallel, a refused cross-task key press, the result copied between the apps, Save As through the dialog checked on disk, an edit and save in one sequence, text recognition and screenshots, and both apps closed. The live test in [tests/linux-live.e2e.ts](tests/linux-live.e2e.ts) also passes: launch as an X11 app, move, reserve, AT-SPI read and find, typing with a verified outcome, the settle wait, the drag checks, a refused click outside the reserved window, and closing through `invoke`.
- **Screenshots on GNOME** — `grim` only captures wlroots compositors. Without `gnome-screenshot`, GNOME sessions capture and read X11 windows (the apps the agent starts) through `import -window`; whole-screen captures and text recognition of the screen need the desktop's own tool.
- **X11 window positions** — under reparenting window managers such as Mutter and xfwm4, `wmctrl` and `xdotool` add the frame's offset a second time; the backend takes positions from `xwininfo` and `_NET_FRAME_EXTENTS` (both in `x11-utils`) instead, so window rectangles include the title bar and captures map to the content area. Without `xwininfo`, `wmctrl`'s numbers are used.
- **Wayland without ydotoold** — `xdotool` input reaches X11 apps only, so native Wayland windows (the shell, apps the person started) need the `ydotool` daemon, which `desktop_setup` explains how to start. Single-instance apps that are already running may open a new window inside their existing native process instead of a new X11 one; pass the app's own option for a separate process where it has one (`mousepad --disable-server`).
- **Linux paste** — needs `xclip` (X11) or `wl-clipboard` (Wayland); without it long text is typed.
- **Reservations** — they bind these tools only: the person, other programs and other computer-use providers can still change the window. Without a way to tell which window is under a point (Wayland), pointer input is checked against the window in front.
- **Drag checks** — the path is sampled at seven points between the ends, so a narrow window the pointer only clips can go unnoticed; the drag itself is still sent as one gesture.
- **OCR languages** — Windows OCR uses the languages installed for the person's profile; one without the optical character recognition feature reports how to add it.
- **Elevated windows** — controls of an app running as administrator are read from the normal session, where Windows may hide some of them; clicks still go through the administrator helper.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
