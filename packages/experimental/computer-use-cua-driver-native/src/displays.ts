/**
 * Every connected display, not only the primary one: list monitors with their positions, capture any of them,
 * and move or click the real pointer anywhere on the virtual desktop. Window-targeted Cua Driver tools already
 * work on windows on any monitor; these tools add the whole-screen view and input the driver limits to the
 * primary display.
 * @module @hackdevcode/dsh-experimental-computer-use-cua-driver-native/displays
 */

import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@hackdevcode/cordis'
import { defineTool } from '@hackdevcode/dsh-tools'

/** One monitor in virtual-desktop pixels; a display left of or above the primary has negative coordinates. */
export interface DisplayInfo {
  /** Zero-based index used by the other display tools. */
  index: number
  /** Platform name of the output, such as `\\.\DISPLAY2` or `HDMI-1`. */
  name: string
  primary: boolean
  x: number
  y: number
  width: number
  height: number
}

/** Runs one helper program and returns its standard output. */
export type CommandRunner = (file: string, args: readonly string[]) => Promise<string>

/** Default runner: no shell, bounded time, Windows console window hidden. */
export const runCommand: CommandRunner = (file, args) => new Promise((resolve, reject) => {
  execFile(file, [...args], { timeout: 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error !== null) reject(new Error(`${file} failed: ${stderr.trim() || error.message}`))
    else resolve(stdout)
  })
})

/** Desktop operations on every display of one platform. */
export interface DisplayBackend {
  list(): Promise<DisplayInfo[]>
  /** Capture one display, or the whole virtual desktop when `display` is omitted, into a PNG file. */
  capture(path: string, display?: DisplayInfo): Promise<void>
  /** Move the real pointer, then press the button `count` times unless `button` is `none`. */
  pointer(x: number, y: number, button: 'left' | 'right' | 'middle' | 'none', count: number): Promise<void>
}

/** PowerShell prelude: physical pixels across mixed-DPI monitors, plus the pointer calls. */
const WINDOWS_PRELUDE = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace HackDev -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extra);
'@
[void][HackDev.Native]::SetProcessDpiAwarenessContext([System.IntPtr]-4)
`

/** Every screen as JSON: device name, whether primary, and bounds in physical pixels. */
const LIST_SCREENS = '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ name = $_.DeviceName; primary = $_.Primary; '
  + 'x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height } } | ConvertTo-Json -Compress'

/** Quote a value for a single-quoted PowerShell string. */
function psQuote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/**
 * Windows backend through Windows PowerShell and .NET, which every Windows 10 and 11 installation has.
 * @param run - helper runner.
 * @returns the backend.
 */
export function windowsBackend(run: CommandRunner = runCommand): DisplayBackend {
  const ps = (script: string): Promise<string> => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PRELUDE + script])
  return {
    async list() {
      const out = await ps(LIST_SCREENS)
      const parsed = JSON.parse(out.trim().length === 0 ? '[]' : out) as Omit<DisplayInfo, 'index'> | Omit<DisplayInfo, 'index'>[]
      return (Array.isArray(parsed) ? parsed : [parsed]).map((display, index) => ({ index, ...display }))
    },
    async capture(path, display) {
      const bounds = display === undefined ? '[System.Windows.Forms.SystemInformation]::VirtualScreen' : `New-Object System.Drawing.Rectangle(${String(display.x)}, ${String(display.y)}, ${String(display.width)}, ${String(display.height)})`
      await ps(`$b = ${bounds}; $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $bmp.Save(${psQuote(path)}, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`)
    },
    async pointer(x, y, button, count) {
      const flags = { left: [0x2, 0x4], right: [0x8, 0x10], middle: [0x20, 0x40], none: [] }[button]
      const press = flags.length === 0 ? '' : `for ($i = 0; $i -lt ${String(count)}; $i++) { [HackDev.Native]::mouse_event(${String(flags[0])}, 0, 0, 0, [System.UIntPtr]::Zero); [HackDev.Native]::mouse_event(${String(flags[1])}, 0, 0, 0, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 60 }`
      await ps(`[void][HackDev.Native]::SetCursorPos(${String(Math.round(x))}, ${String(Math.round(y))}); Start-Sleep -Milliseconds 40; ${press}`)
    },
  }
}

/**
 * Parse `xrandr --query` monitor lines such as `HDMI-1 connected primary 1920x1080+1920+0 ...`.
 * @param text - xrandr output.
 * @returns the active displays.
 */
export function parseXrandr(text: string): DisplayInfo[] {
  const displays: DisplayInfo[] = []
  for (const line of text.split(/\r?\n/u)) {
    const [, name, primary, width, height, x, y] = /^(\S+) connected (primary )?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/u.exec(line) ?? []
    if (name === undefined || width === undefined || height === undefined || x === undefined || y === undefined) continue
    displays.push({
      index: displays.length, name, primary: primary !== undefined,
      x: Number(x), y: Number(y), width: Number(width), height: Number(height),
    })
  }
  return displays
}

/** Packages that provide the Linux helpers on Debian and Ubuntu. */
export const LINUX_HELPERS = 'sudo apt-get install -y x11-xserver-utils xdotool imagemagick'

/**
 * Linux (X11) backend through xrandr, ImageMagick and xdotool.
 * @param run - helper runner.
 * @param env - environment used to tell Wayland apart.
 * @returns the backend.
 */
export function linuxBackend(
  run: CommandRunner = runCommand,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DisplayBackend {
  const helper = async (file: string, args: readonly string[]): Promise<string> => {
    try { return await run(file, args) } catch (error) {
      const wayland = (env['WAYLAND_DISPLAY'] ?? '').length > 0 && (env['DISPLAY'] ?? '').length === 0
      throw new Error(`${String(error instanceof Error ? error.message : error)}. ${wayland
        ? 'This is a Wayland session without XWayland; log in to an Xorg session for full desktop control.'
        : `Install the helpers with: ${LINUX_HELPERS}`}`, { cause: error })
    }
  }
  return {
    async list() {
      return parseXrandr(await helper('xrandr', ['--query']))
    },
    async capture(path, display) {
      const crop = display === undefined ? [] : ['-crop', `${String(display.width)}x${String(display.height)}+${String(display.x)}+${String(display.y)}`]
      await helper('import', ['-window', 'root', ...crop, path])
    },
    async pointer(x, y, button, count) {
      const press = button === 'none' ? [] : ['click', '--repeat', String(count), { left: '1', middle: '2', right: '3' }[button]]
      await helper('xdotool', ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y)), ...press])
    },
  }
}

/**
 * The backend for this platform, or undefined where the platform's own provider covers every display.
 * @param platform - Node platform name.
 * @returns the backend.
 */
export function displayBackend(platform: NodeJS.Platform = process.platform): DisplayBackend | undefined {
  if (platform === 'win32') return windowsBackend()
  if (platform === 'linux') return linuxBackend()
  return undefined
}

/** Find a display by index; throws a model-readable error for an unknown one. */
function pick(displays: readonly DisplayInfo[], index: number): DisplayInfo {
  const display = displays.find(candidate => candidate.index === index)
  if (display === undefined) throw new Error(`no display ${String(index)}; connected displays: ${displays.map(d => String(d.index)).join(', ') || 'none'}`)
  return display
}

/** Summary line for one display. */
function describe(display: DisplayInfo): string {
  return `${String(display.index)}: ${display.name}${display.primary ? ' (primary)' : ''} ${String(display.width)}x${String(display.height)} at (${String(display.x)}, ${String(display.y)})`
}

/** Guidance placed next to the display tools. */
export const DISPLAY_GUIDANCE = 'Several monitors may be connected. desktop_list_displays shows each display with its position on the virtual desktop. '
  + 'desktop_screenshot captures one display (or all of them) to a PNG you can open with read. desktop_pointer moves the real mouse and clicks at virtual-desktop '
  + 'coordinates on any display: add the display\'s x and y to a point measured in its screenshot. Prefer the window tools (element_index or window-local coordinates) for apps; they work on every monitor.'

/**
 * Register the display tools.
 * @param ctx - context with the tool registry.
 * @param backend - platform backend.
 */
export function registerDisplayTools(ctx: Context, backend: DisplayBackend, group?: { name: string; description: string }): void {
  const options = group === undefined ? {} : { group }
  ctx.tools.register(defineTool({
    name: 'desktop_list_displays',
    description: 'List every connected display with its index, name, whether it is primary, and its size and position in virtual-desktop pixels.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string', required: true }, count: { type: 'number', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute() {
      const displays = await backend.list()
      return { summary: displays.length === 0 ? 'No display found.' : displays.map(describe).join('\n'), count: displays.length }
    },
  }), options)
  ctx.tools.register(defineTool({
    name: 'desktop_screenshot',
    description: 'Capture one display, or the whole virtual desktop across all displays, to a PNG file. Open the returned path with read to see it.',
    parameters: {
      display: { type: 'number', description: 'Display index from desktop_list_displays; omit to capture every display at once.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, area: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Saved ${value.area} to ${value.path}` }],
    },
    async execute(args: { display?: number }) {
      const displays = await backend.list()
      const display = args.display === undefined ? undefined : pick(displays, args.display)
      const path = join(await mkdtemp(join(tmpdir(), 'hackdev-screen-')), display === undefined ? 'desktop.png' : `display-${String(display.index)}.png`)
      await backend.capture(path, display)
      return { path, area: display === undefined ? `all ${String(displays.length)} displays` : `display ${describe(display)}` }
    },
  }), options)
  ctx.tools.register(defineTool({
    name: 'desktop_pointer',
    description: 'Move the real mouse pointer to virtual-desktop coordinates on any display and optionally click. Coordinates of a display start at its x and y from desktop_list_displays.',
    parameters: {
      x: { type: 'number', required: true, description: 'Virtual-desktop x in pixels.' },
      y: { type: 'number', required: true, description: 'Virtual-desktop y in pixels.' },
      button: { type: 'string', description: 'left (default), right, middle, or none to move only.' },
      count: { type: 'number', description: 'Clicks to send: 1 (default) or 2 for a double-click.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { done: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.done }],
    },
    async execute(args: { x: number; y: number; button?: string; count?: number }) {
      const button = args.button ?? 'left'
      if (button !== 'left' && button !== 'right' && button !== 'middle' && button !== 'none') throw new Error('button must be left, right, middle or none')
      const count = args.count ?? 1
      if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('count must be 1, 2 or 3')
      const displays = await backend.list()
      const on = displays.find(d => args.x >= d.x && args.x < d.x + d.width && args.y >= d.y && args.y < d.y + d.height)
      if (on === undefined) throw new Error(`(${String(args.x)}, ${String(args.y)}) is on no display; displays: ${displays.map(describe).join('; ')}`)
      await backend.pointer(args.x, args.y, button, count)
      return { done: `${button === 'none' ? 'Moved to' : `${button} click x${String(count)} at`} (${String(args.x)}, ${String(args.y)}) on display ${describe(on)}` }
    },
  }), options)
}
