/**
 * Key names for real keyboard input: one vocabulary the model writes (`ctrl+shift+esc`, `win+r`, `alt+tab enter`)
 * mapped to Windows virtual-key codes and to X11 keysyms for xdotool.
 * @module @hackdevcode/dsh-computer-use-cua-driver-native/keys
 */

/** One named key on both platforms. */
interface KeyCode {
  /** Windows virtual-key code. */
  readonly vk: number
  /** xdotool keysym name. */
  readonly x11: string
}

const NAMED: Readonly<Record<string, KeyCode>> = {
  ctrl: { vk: 0x11, x11: 'ctrl' }, control: { vk: 0x11, x11: 'ctrl' },
  shift: { vk: 0x10, x11: 'shift' },
  alt: { vk: 0x12, x11: 'alt' }, option: { vk: 0x12, x11: 'alt' },
  win: { vk: 0x5B, x11: 'super' }, windows: { vk: 0x5B, x11: 'super' }, super: { vk: 0x5B, x11: 'super' },
  meta: { vk: 0x5B, x11: 'super' }, cmd: { vk: 0x5B, x11: 'super' },
  enter: { vk: 0x0D, x11: 'Return' }, return: { vk: 0x0D, x11: 'Return' },
  tab: { vk: 0x09, x11: 'Tab' }, space: { vk: 0x20, x11: 'space' },
  esc: { vk: 0x1B, x11: 'Escape' }, escape: { vk: 0x1B, x11: 'Escape' },
  backspace: { vk: 0x08, x11: 'BackSpace' }, delete: { vk: 0x2E, x11: 'Delete' }, del: { vk: 0x2E, x11: 'Delete' },
  insert: { vk: 0x2D, x11: 'Insert' }, home: { vk: 0x24, x11: 'Home' }, end: { vk: 0x23, x11: 'End' },
  pageup: { vk: 0x21, x11: 'Prior' }, pagedown: { vk: 0x22, x11: 'Next' },
  up: { vk: 0x26, x11: 'Up' }, down: { vk: 0x28, x11: 'Down' }, left: { vk: 0x25, x11: 'Left' }, right: { vk: 0x27, x11: 'Right' },
  menu: { vk: 0x5D, x11: 'Menu' }, apps: { vk: 0x5D, x11: 'Menu' },
  capslock: { vk: 0x14, x11: 'Caps_Lock' }, numlock: { vk: 0x90, x11: 'Num_Lock' }, scrolllock: { vk: 0x91, x11: 'Scroll_Lock' },
  printscreen: { vk: 0x2C, x11: 'Print' }, pause: { vk: 0x13, x11: 'Pause' },
  volumeup: { vk: 0xAF, x11: 'XF86AudioRaiseVolume' }, volumedown: { vk: 0xAE, x11: 'XF86AudioLowerVolume' },
  volumemute: { vk: 0xAD, x11: 'XF86AudioMute' }, playpause: { vk: 0xB3, x11: 'XF86AudioPlay' },
  nexttrack: { vk: 0xB0, x11: 'XF86AudioNext' }, prevtrack: { vk: 0xB1, x11: 'XF86AudioPrev' },
  ';': { vk: 0xBA, x11: 'semicolon' }, '=': { vk: 0xBB, x11: 'equal' }, ',': { vk: 0xBC, x11: 'comma' },
  '-': { vk: 0xBD, x11: 'minus' }, '.': { vk: 0xBE, x11: 'period' }, '/': { vk: 0xBF, x11: 'slash' },
  '`': { vk: 0xC0, x11: 'grave' }, '[': { vk: 0xDB, x11: 'bracketleft' }, '\\': { vk: 0xDC, x11: 'backslash' },
  ']': { vk: 0xDD, x11: 'bracketright' }, '\'': { vk: 0xDE, x11: 'apostrophe' },
  plus: { vk: 0xBB, x11: 'plus' }, minus: { vk: 0xBD, x11: 'minus' },
}

/** Look up one key name, case-insensitively for names and letters. */
function lookup(raw: string): KeyCode | undefined {
  const name = raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase().replace(/[\s_]/gu, '')
  if (/^[a-z]$/u.test(name)) return { vk: name.toUpperCase().charCodeAt(0), x11: name }
  if (/^[0-9]$/u.test(name)) return { vk: name.charCodeAt(0), x11: name }
  const fn = /^f([1-9]|1\d|2[0-4])$/u.exec(name)
  if (fn?.[1] !== undefined) return { vk: 0x6F + Number(fn[1]), x11: `F${fn[1]}` }
  const pad = /^(?:numpad|num)([0-9])$/u.exec(name)
  if (pad?.[1] !== undefined) return { vk: 0x60 + Number(pad[1]), x11: `KP_${pad[1]}` }
  return NAMED[name]
}

/** A chord: keys pressed together, released in reverse order. */
export interface Chord {
  readonly names: readonly string[]
  readonly vk: readonly number[]
  readonly x11: string
}

/**
 * Parse `ctrl+shift+t`, or several chords separated by spaces (`alt+tab enter`). A literal `+` is written `plus`.
 * @param keys - key expression.
 * @returns the chords in order.
 * @throws when a key name is unknown or the expression is empty.
 */
export function parseKeys(keys: string): Chord[] {
  const chords = keys.trim().split(/\s+/u).filter(part => part.length > 0).map((expression) => {
    const names = expression.split('+').filter(part => part.length > 0)
    if (names.length === 0) throw new Error(`empty key chord in "${keys}"`)
    const codes = names.map((name) => {
      const code = lookup(name)
      if (code === undefined) throw new Error(`unknown key "${name}"; use names like ctrl, shift, alt, win, enter, tab, esc, up, f5, a, 1`)
      return code
    })
    return { names, vk: codes.map(code => code.vk), x11: codes.map(code => code.x11).join('+') }
  })
  if (chords.length === 0) throw new Error('keys is empty')
  return chords
}
