/**
 * Wayland pieces of the Linux desktop backend: kernel key codes and argument builders for ydotool (input through
 * /dev/uinput, which every compositor accepts), the screenshot command for wlroots, GNOME and KDE, and window lists
 * from Sway and Hyprland.
 * @module @hackdevcode/dsh-computer-use-cua-driver-native/wayland
 */

import type { DisplayInfo, WindowInfo } from './displays.ts'

/** Packages for desktop control in a Wayland session (Debian and Ubuntu names). */
export const WAYLAND_HELPERS = 'sudo apt-get install -y ydotool wl-clipboard grim imagemagick xdg-utils, then start the ydotoold service '
  + '(sudo systemctl enable --now ydotoold, or run ydotoold) so it can write to /dev/uinput'

/**
 * Whether this Linux session is Wayland. `HACKDEV_DESKTOP_BACKEND=x11` or `=wayland` overrides the detection.
 * @param env - process environment.
 * @returns true for Wayland.
 */
export function isWaylandSession(env: Readonly<Record<string, string | undefined>>): boolean {
  const forced = (env['HACKDEV_DESKTOP_BACKEND'] ?? '').toLowerCase()
  if (forced === 'x11') return false
  if (forced === 'wayland') return true
  if ((env['XDG_SESSION_TYPE'] ?? '').toLowerCase() === 'wayland') return true
  return (env['WAYLAND_DISPLAY'] ?? '').length > 0 && (env['DISPLAY'] ?? '').length === 0
}

/** Linux input event codes (linux/input-event-codes.h) for the X11 keysym names the key parser produces. */
const EVDEV: Readonly<Record<string, readonly number[]>> = {
  ctrl: [29], shift: [42], alt: [56], super: [125],
  Return: [28], Tab: [15], space: [57], Escape: [1], BackSpace: [14], Delete: [111], Insert: [110],
  Home: [102], End: [107], Prior: [104], Next: [109], Up: [103], Down: [108], Left: [105], Right: [106],
  Menu: [127], Caps_Lock: [58], Num_Lock: [69], Scroll_Lock: [70], Print: [99], Pause: [119],
  XF86AudioRaiseVolume: [115], XF86AudioLowerVolume: [114], XF86AudioMute: [113],
  XF86AudioPlay: [164], XF86AudioNext: [163], XF86AudioPrev: [165],
  semicolon: [39], equal: [13], comma: [51], minus: [12], period: [52], slash: [53], grave: [41],
  bracketleft: [26], backslash: [43], bracketright: [27], apostrophe: [40], plus: [42, 13],
  q: [16], w: [17], e: [18], r: [19], t: [20], y: [21], u: [22], i: [23], o: [24], p: [25],
  a: [30], s: [31], d: [32], f: [33], g: [34], h: [35], j: [36], k: [37], l: [38],
  z: [44], x: [45], c: [46], v: [47], b: [48], n: [49], m: [50],
  1: [2], 2: [3], 3: [4], 4: [5], 5: [6], 6: [7], 7: [8], 8: [9], 9: [10], 0: [11],
  KP_7: [71], KP_8: [72], KP_9: [73], KP_4: [75], KP_5: [76], KP_6: [77], KP_1: [79], KP_2: [80], KP_3: [81], KP_0: [82],
}

/**
 * Kernel key codes for one X11 keysym name.
 * @param name - keysym from the key parser, such as `ctrl`, `Return`, `F5` or `a`.
 * @returns the codes pressed for it (`plus` is shift and equal).
 * @throws when the key has no kernel code here.
 */
export function evdevCodes(name: string): readonly number[] {
  const fn = /^F(\d{1,2})$/u.exec(name)
  if (fn?.[1] !== undefined) {
    const n = Number(fn[1])
    if (n >= 1 && n <= 10) return [58 + n]
    if (n === 11 || n === 12) return [76 + n]
    if (n >= 13 && n <= 24) return [170 + n]
  }
  const codes = EVDEV[name]
  if (codes === undefined) throw new Error(`the key "${name}" cannot be sent in a Wayland session`)
  return codes
}

/** Codes of a chord (`ctrl+shift+t`), in press order, without repeats. */
function chordCodes(x11: string): number[] {
  return [...new Set(x11.split('+').flatMap(evdevCodes))]
}

/**
 * ydotool `key` arguments that press the chords one after another, each released in reverse order.
 * @param chords - X11 chord strings.
 * @returns the arguments after `ydotool`.
 */
export function ydotoolKeyArgs(chords: readonly string[]): string[] {
  return ['key', ...chords.flatMap((chord) => {
    const codes = chordCodes(chord)
    return [...codes.map(code => `${String(code)}:1`), ...codes.toReversed().map(code => `${String(code)}:0`)]
  })]
}

/**
 * ydotool `key` arguments that only press (`down`) or only release a chord.
 * @param chord - X11 chord string.
 * @param down - press or release.
 * @returns the arguments after `ydotool`.
 */
export function ydotoolHoldArgs(chord: string, down: boolean): string[] {
  const codes = chordCodes(chord)
  return ['key', ...(down ? codes : codes.toReversed()).map(code => `${String(code)}:${down ? '1' : '0'}`)]
}

/** ydotool button numbers: left 0, right 1, middle 2. */
export const YDOTOOL_BUTTONS = { left: 0, right: 1, middle: 2 } as const

/**
 * ydotool `click` code: the button number plus 0x40 for press and 0x80 for release.
 * @param button - which button.
 * @param press - `click` for press and release, `down` or `up` for one half.
 * @returns the hexadecimal code.
 */
export function ydotoolClickCode(button: keyof typeof YDOTOOL_BUTTONS, press: 'click' | 'down' | 'up'): string {
  const flags = press === 'click' ? 0xC0 : press === 'down' ? 0x40 : 0x80
  return `0x${(flags | YDOTOOL_BUTTONS[button]).toString(16).toUpperCase()}`
}

/**
 * ydotool arguments that move the pointer to an absolute point.
 * @param x - desktop x.
 * @param y - desktop y.
 * @returns the arguments after `ydotool`.
 */
export function ydotoolMoveArgs(x: number, y: number): string[] {
  return ['mousemove', '--absolute', '-x', String(Math.round(x)), '-y', String(Math.round(y))]
}

/**
 * Shell script that saves a full-desktop screenshot to $1 with the first tool the compositor supports, prints the
 * tool's name, and exits 3 when none is installed.
 */
export const WAYLAND_SCREENSHOT = 'f="$1"; '
  + 'if command -v grim >/dev/null 2>&1 && grim "$f" 2>/dev/null; then echo grim; '
  + 'elif command -v gnome-screenshot >/dev/null 2>&1 && gnome-screenshot -f "$f" 2>/dev/null; then echo gnome-screenshot; '
  + 'elif command -v spectacle >/dev/null 2>&1 && spectacle -b -n -f -o "$f" 2>/dev/null; then echo spectacle; '
  + 'else exit 3; fi'

/** Shell script that pastes $1 through the Wayland clipboard with ydotool and restores the earlier text; prints PASTED. */
export const WAYLAND_PASTE = 'command -v wl-copy >/dev/null 2>&1 || exit 3; '
  + 'old=$(wl-paste --no-newline 2>/dev/null); had=$?; '
  + 'printf %s "$1" | wl-copy || exit 4; '
  + 'ydotool key 29:1 47:1 47:0 29:0; sleep 0.6; '
  + 'if [ "$had" = 0 ]; then printf %s "$old" | wl-copy; fi; echo PASTED'

/** A node of `swaymsg -t get_tree`, reduced to the fields used here. */
interface SwayNode {
  id?: number
  name?: string | null
  pid?: number
  app_id?: string | null
  focused?: boolean
  visible?: boolean
  type?: string
  rect?: { x?: number; y?: number; width?: number; height?: number }
  window_properties?: { class?: string }
  nodes?: SwayNode[]
  floating_nodes?: SwayNode[]
}

/**
 * Windows from `swaymsg -t get_tree` output: every view (a node with a pid), with its container id as the handle.
 * @param json - the tree.
 * @returns the windows.
 */
export function parseSwayTree(json: string): WindowInfo[] {
  const out: WindowInfo[] = []
  const walk = (node: SwayNode, scratch: boolean): void => {
    const isScratch = scratch || node.name === '__i3_scratch'
    if (typeof node.pid === 'number' && typeof node.id === 'number' && (node.type === 'con' || node.type === 'floating_con')) {
      out.push({
        handle: node.id,
        pid: node.pid,
        process: node.app_id ?? node.window_properties?.class ?? '',
        title: node.name ?? '',
        x: node.rect?.x ?? 0, y: node.rect?.y ?? 0, width: node.rect?.width ?? 0, height: node.rect?.height ?? 0,
        minimized: isScratch || node.visible === false,
        foreground: node.focused === true,
      })
    }
    for (const child of [...(node.nodes ?? []), ...(node.floating_nodes ?? [])]) walk(child, isScratch)
  }
  walk(JSON.parse(json) as SwayNode, false)
  return out
}

/** One entry of `hyprctl clients -j`, reduced to the fields used here. */
interface HyprClient {
  address?: string
  pid?: number
  class?: string
  title?: string
  at?: [number, number]
  size?: [number, number]
  hidden?: boolean
  mapped?: boolean
}

/**
 * Windows from `hyprctl clients -j` and the address from `hyprctl activewindow -j`; the window address is the handle.
 * @param clients - the client list.
 * @param active - the active window, or an empty string.
 * @returns the windows.
 */
export function parseHyprClients(clients: string, active: string): WindowInfo[] {
  const activeAddress = active.trim().startsWith('{') ? (JSON.parse(active) as HyprClient).address : undefined
  return (JSON.parse(clients) as HyprClient[])
    .filter(client => client.mapped !== false && typeof client.address === 'string')
    .map(client => ({
      handle: Number.parseInt(client.address ?? '0', 16),
      pid: client.pid ?? 0,
      process: client.class ?? '',
      title: client.title ?? '',
      x: client.at?.[0] ?? 0, y: client.at?.[1] ?? 0, width: client.size?.[0] ?? 0, height: client.size?.[1] ?? 0,
      minimized: client.hidden === true,
      foreground: client.address === activeAddress,
    }))
}

/** One entry of `wlr-randr --json`, reduced to the fields used here. */
interface WlrOutput {
  name?: string
  enabled?: boolean
  position?: { x?: number; y?: number }
  scale?: number
  transform?: string
  modes?: Array<{ width?: number; height?: number; current?: boolean }>
}

/**
 * Displays from `wlr-randr --json` in logical (scaled) pixels; the first output is reported as primary.
 * @param json - the output list.
 * @returns the displays without their index.
 */
export function parseWlrRandr(json: string): Array<Omit<DisplayInfo, 'index'>> {
  return (JSON.parse(json) as WlrOutput[])
    .filter(output => output.enabled !== false)
    .flatMap((output, index) => {
      const mode = output.modes?.find(candidate => candidate.current === true)
      if (mode?.width === undefined || mode.height === undefined) return []
      const scale = output.scale !== undefined && output.scale > 0 ? output.scale : 1
      const turned = output.transform === '90' || output.transform === '270' || output.transform === 'flipped-90' || output.transform === 'flipped-270'
      const width = Math.round((turned ? mode.height : mode.width) / scale)
      const height = Math.round((turned ? mode.width : mode.height) / scale)
      return [{ name: output.name ?? `output ${String(index)}`, primary: index === 0, x: output.position?.x ?? 0, y: output.position?.y ?? 0, width, height }]
    })
}
