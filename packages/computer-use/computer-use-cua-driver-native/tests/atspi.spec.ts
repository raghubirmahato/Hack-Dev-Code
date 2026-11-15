import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import { atspiArgs, PORTAL_PROMPT } from '../src/atspi.ts'
import { linuxBackend, registerDisplayTools } from '../src/displays.ts'
import type { CommandRunner } from '../src/displays.ts'

/** A Python 3 on this machine, if any: the script runs for real against a stand-in for the AT-SPI bus. */
const PYTHON = ['python3', 'python'].find(command => spawnSync(command, ['-c', 'import sys; assert sys.version_info >= (3, 8)']).status === 0)

/** The stand-in `gi` package. */
const FAKE_GI = fileURLToPath(new URL('./fixtures/fake-gi', import.meta.url))

/** A settings window with a slider, a check box, a text box, a list, a button with no actions and a hidden button. */
function tree(): unknown {
  const shown = ['sensitive', 'showing']
  return [
    { pid: 99, children: [{ name: 'Other app', role: 'frame' }] },
    { pid: 42, children: [{
      name: 'Display Settings', role: 'frame', states: shown, box: [0, 0, 800, 600], children: [
        { name: 'Brightness', role: 'label', states: shown, box: [10, 10, 100, 20] },
        { name: 'Brightness level', role: 'slider', value: 40, states: shown, box: [120, 10, 200, 20] },
        { name: 'Night light', role: 'check box', states: [...shown, 'checkable'], box: [10, 40, 120, 20], actions: ['toggle'] },
        { name: 'Profile name', role: 'entry', text: 'Ada', states: [...shown, 'editable', 'focused'], box: [10, 70, 200, 24], editable: true, id: 'profile' },
        { name: 'Colours', role: 'list', states: shown, selectable: true, box: [10, 100, 200, 60], children: [
          { name: 'Red', role: 'list item', states: shown, box: [10, 100, 200, 20] },
          { name: 'Blue', role: 'list item', states: [...shown, 'selected'], box: [10, 120, 200, 20] },
        ] },
        { name: 'Apply', role: 'push button', states: shown, box: [600, 550, 80, 30] },
        { name: 'Advanced', role: 'push button', states: ['sensitive'], box: [0, 0, 0, 0] },
      ],
    }] },
  ]
}

let directory: string
let log: string
let treeFile: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hackdev-atspi-'))
  log = join(directory, 'calls.log')
  treeFile = join(directory, 'tree.json')
  writeFileSync(log, '')
  writeFileSync(treeFile, JSON.stringify(tree()))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** Run the script with the stand-in bus; resolves with stdout, rejects with stderr like the backend's runner. */
function python(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(PYTHON as string, [...args], {
      env: { ...process.env, PYTHONPATH: [FAKE_GI, process.env['PYTHONPATH'] ?? ''].join(delimiter), FAKE_ATSPI_TREE: treeFile, FAKE_ATSPI_LOG: log, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      timeout: 20_000,
    }, (error, stdout, stderr) => { if (error) reject(new Error(stderr.trim() || error.message)); else resolve(stdout.replace(/\r\n/gu, '\n')) })
  })
}

function calls(): string[] {
  return readFileSync(log, 'utf8').split(/\r?\n/u).filter(line => line.length > 0)
}

describe.skipIf(PYTHON === undefined)('AT-SPI controls script', () => {
  it('reads a window as numbered controls with centre points and states, in the Windows line format', async () => {
    const out = await python(atspiArgs('read', 42, 'Display Settings'))
    expect(out.trimEnd().split('\n')).toEqual([
      '  [1] Text "Brightness" @(60,20)',
      '  [2] Slider "Brightness level" = "40" @(220,20)',
      '  [3] CheckBox "Night light" @(70,50) (unchecked)',
      '  [4] Edit "Profile name" = "Ada" @(110,82) (focused)',
      '  [5] List "Colours" @(110,130)',
      '    [6] ListItem "Red" @(110,110)',
      '    [7] ListItem "Blue" @(110,130) (selected)',
      '  [8] Button "Apply" @(640,565)',
      '(1 more controls are hidden, such as the items of closed menus; open the menu, or find them by name)',
    ])
  })

  it('keeps the items of closed menus out of a read, so the editor after a long menu bar is still listed', async () => {
    // Like Mousepad on GNOME: a menu bar whose closed menus hold hundreds of items, then the text area. Each element
    // lists up to 300 children, so the menu stays under that.
    const shown = ['sensitive', 'showing']
    const items = Array.from({ length: 250 }, (_, index) => ({ name: `Filetype ${String(index)}`, role: 'menu item', states: ['sensitive'] }))
    writeFileSync(treeFile, JSON.stringify([{ pid: 50, children: [{ name: 'Untitled 1 - Mousepad', role: 'frame', states: shown, box: [0, 0, 700, 480], children: [
      { name: 'File', role: 'menu', states: shown, box: [0, 30, 40, 20], children: items },
      { role: 'text', text: 'hackdev live check', states: [...shown, 'editable', 'focused'], box: [0, 60, 700, 400], editable: true },
    ] }] }]))
    const out = (await python(atspiArgs('read', 50, 'Untitled 1 - Mousepad'))).trimEnd().split('\n')
    expect(out).toEqual([
      '  [1] MenuItem "File" @(20,40)',
      '  [252] Edit = "hackdev live check" @(350,260) (focused)',
      '(250 more controls are hidden, such as the items of closed menus; open the menu, or find them by name)',
    ])
    // The hidden items keep their numbers for find and act.
    const found = (await python(atspiArgs('find', 50, 'Untitled 1 - Mousepad', 'filetype 7', '', '', '15'))).trim().split('\n')
    expect(found[0]).toBe('=[9] MenuItem "Filetype 7"')
    expect(found[1]).toBe('~[72] MenuItem "Filetype 70"')
  })

  it('finds controls by name, type and accessible id, exact matches first', async () => {
    expect((await python(atspiArgs('find', 42, 'Display Settings', 'apply', '', '', '15'))).trim()).toBe('=[8] Button "Apply" @(640,565)')
    expect((await python(atspiArgs('find', 42, 'Display Settings', 'bright', '', '', '15'))).trim().split('\n'))
      .toEqual(['~[1] Text "Brightness" @(60,20)', '~[2] Slider "Brightness level" = "40" @(220,20)'])
    expect((await python(atspiArgs('find', 42, 'Display Settings', '', 'Button', '', '15'))).trim().split('\n'))
      .toEqual(['=[8] Button "Apply" @(640,565)', '=[9] Button "Advanced"'])
    expect((await python(atspiArgs('find', 42, 'Display Settings', '', '', 'profile', '15'))).trim()).toBe('=[4] Edit "Profile name" = "Ada" @(110,82) (focused)')
    expect((await python(atspiArgs('find', 42, 'Display Settings', 'missing', '', '', '15'))).trim()).toBe('')
  })

  it('operates controls through their accessible actions and interfaces', async () => {
    expect((await python(atspiArgs('act', 42, 'Display Settings', '3', 'toggle', ''))).trim()).toBe('CheckBox "Night light" @(70,50) (checked)')
    expect((await python(atspiArgs('act', 42, 'Display Settings', '4', 'set_value', 'Grace'))).trim()).toBe('Edit "Profile name" = "Grace" @(110,82) (focused)')
    expect((await python(atspiArgs('act', 42, 'Display Settings', '2', 'set_value', '75'))).trim()).toBe('Slider "Brightness level" = "75" @(220,20)')
    expect((await python(atspiArgs('act', 42, 'Display Settings', '6', 'select', ''))).trim()).toBe('ListItem "Red" @(110,110)')
    expect((await python(atspiArgs('act', 42, 'Display Settings', '4', 'focus', ''))).trim()).toContain('Edit "Profile name"')
    expect(calls()).toEqual([
      'do_action Night light toggle',
      'set_text_contents Profile name Grace',
      'set_current_value Brightness level 75.0',
      'select_child Colours 0',
      'grab_focus Profile name',
    ])
  })

  it('does not walk into a background tab\'s page, so the browser\'s own controls fit in the walk', async () => {
    const shown = ['sensitive', 'showing']
    const hiddenPage = Array.from({ length: 50 }, (_, index) => ({ name: `Hidden link ${String(index)}`, role: 'link', states: ['sensitive'] }))
    writeFileSync(treeFile, JSON.stringify([{ pid: 80, children: [{ name: 'Browser', role: 'frame', states: shown, box: [0, 0, 800, 600], children: [
      { name: 'Background tab', role: 'document web', states: ['sensitive'], children: hiddenPage },
      { name: 'Work test', role: 'push button', states: shown, box: [700, 10, 40, 30] },
    ] }] }]))
    const found = (await python(atspiArgs('find', 80, 'Browser', 'hidden link', '', '', '15'))).trim()
    expect(found).toBe('')
    expect((await python(atspiArgs('find', 80, 'Browser', 'work test', 'Button', '', '15'))).trim()).toBe('=[2] Button "Work test" @(720,25)')
  })

  it('finds a consent prompt the desktop portal is showing', async () => {
    writeFileSync(treeFile, JSON.stringify([
      { pid: 70, name: 'xdg-desktop-portal-gnome', children: [{ name: 'Allow remote interaction', role: 'dialog', states: ['showing'] }] },
      { pid: 71, name: 'mousepad', children: [{ name: 'Untitled 1 - Mousepad', role: 'frame', states: ['showing'] }] },
    ]))
    expect((await python(['-c', PORTAL_PROMPT])).trim()).toBe('PROMPT Allow remote interaction')
    writeFileSync(treeFile, JSON.stringify([{ pid: 70, name: 'xdg-desktop-portal-gnome', children: [{ name: 'Hidden', role: 'dialog', states: [] }] }]))
    expect((await python(['-c', PORTAL_PROMPT])).trim()).toBe('NONE')
  })

  it('gives no screen point for GTK 4 controls, which know positions inside their window only', async () => {
    const shown = ['sensitive', 'showing']
    writeFileSync(treeFile, JSON.stringify([{ pid: 60, children: [{ name: 'Calculator', role: 'frame', states: shown, box: [0, 0, 360, 616], children: [
      { name: '7', role: 'push button', states: shown, box: [0, 0, 64, 44], window_box: [24, 428, 64, 44], actions: ['click'] },
      { role: 'text', text: '5535', states: shown, box: [0, 0, 92, 23], window_box: [246, 251, 92, 23] },
    ] }] }]))
    expect((await python(atspiArgs('read', 60, 'Calculator'))).trimEnd().split('\n')).toEqual(['  [1] Button "7"', '  [2] Edit = "5535" (read-only)'])
    await expect(python(atspiArgs('point', 60, 'Calculator', '1'))).rejects.toThrow('element [1] has no screen position (the app reports positions inside its window only); press it with invoke')
    expect((await python(atspiArgs('act', 60, 'Calculator', '1', 'invoke', ''))).trim()).toBe('Button "7"')
    expect(calls()).toEqual(['do_action 7 click'])
  })

  it('shows the start and the end of a long text, where new typing lands', async () => {
    const shown = ['sensitive', 'showing']
    const text = `${'a'.repeat(3000)}MIDDLE${'b'.repeat(3000)}THE END`
    writeFileSync(treeFile, JSON.stringify([{ pid: 61, children: [{ name: 'Notes', role: 'frame', states: shown, box: [0, 0, 400, 300], children: [
      { role: 'text', text, states: [...shown, 'editable'], box: [0, 0, 400, 300], editable: true },
    ] }] }]))
    const line = (await python(atspiArgs('read', 61, 'Notes'))).trim()
    expect(line).toContain('THE END')
    expect(line).not.toContain('MIDDLE')
    expect(line).toMatch(/^\[1\] Edit = "a{1000} \.\.\. .*b{900,}THE END" @\(200,150\)$/u)
  })

  it('falls back to a real click at the control when it has no matching action', async () => {
    expect((await python(atspiArgs('act', 42, 'Display Settings', '8', 'invoke', ''))).trim()).toBe('CLICK 640 565')
    expect((await python(atspiArgs('point', 42, 'Display Settings', '8'))).trim()).toBe('640 565')
    expect(calls()).toEqual([])
  })

  it('reports hidden and unknown elements and a window without accessibility', async () => {
    await expect(python(atspiArgs('point', 42, 'Display Settings', '9'))).rejects.toThrow('element [9] is off screen or hidden')
    await expect(python(atspiArgs('act', 42, 'Display Settings', '9', 'invoke', ''))).rejects.toThrow('does not support invoke and is not on screen')
    await expect(python(atspiArgs('point', 42, 'Display Settings', '40'))).rejects.toThrow('element [40] is unknown for this window')
    await expect(python(atspiArgs('read', 7, 'Nothing'))).rejects.toThrow('no accessible window for this process')
  })
})

describe.skipIf(PYTHON === undefined)('desktop_element on Linux', () => {
  let ctx: Context
  const sent: string[] = []

  beforeEach(async () => {
    sent.length = 0
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    // An X11 session: wmctrl lists the settings window, xdotool records input, python3 runs the real script.
    const run: CommandRunner = async (file, args) => {
      if (file === 'python3') return python(args)
      if (file === 'wmctrl') return '0x04000007  0 42     0    0    800  600  host Display Settings\n'
      if (file === 'xrandr') return 'Screen 0: minimum 8 x 8, current 1920 x 1080\nHDMI-1 connected primary 1920x1080+0+0 (normal) 527mm x 296mm\n'
      if (file === 'xdotool' && args[0] === 'getactivewindow') return String(0x04000007)
      if (file === 'xdotool' || file === 'xprop') {
        sent.push(`${file} ${args.join(' ')}`)
        return file === 'xprop' ? '_NET_CLIENT_LIST_STACKING: window id # 0x4000007\n' : ''
      }
      throw new Error(`unexpected command ${file}`)
    }
    const backend = linuxBackend(run, { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  function call(name: string, args: Record<string, unknown>) {
    return executeToolFixture(ctx, { name, callId: ToolCallId('atspi-test'), arguments: args, signal: new AbortController().signal })
  }

  it('clicks a button by its name at the point the app reports', async () => {
    const result = await call('desktop_element', { action: 'click', name: 'Apply', title: 'Display Settings' })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('click on [8] at (640, 565) in \\"Display Settings\\"')
    expect(sent).toContain('xdotool mousemove --sync 640 565 click --repeat 1 1')
  })

  it('toggles a check box and reads the window as numbered controls', async () => {
    const toggled = await call('desktop_element', { action: 'toggle', name: 'Night light', title: 'Display Settings' })
    expect(JSON.stringify(toggled.content)).toContain('toggle [3] done; now CheckBox \\"Night light\\" @(70,50) (checked)')
    const read = await call('desktop_window', { action: 'read', title: 'Display Settings' })
    expect(JSON.stringify(read.content)).toContain('[4] Edit \\"Profile name\\" = \\"Ada\\" @(110,82) (focused)')
    expect(calls()).toEqual(['do_action Night light toggle'])
  })
})

describe.skipIf(PYTHON === undefined)('desktop_element under GNOME on Wayland', () => {
  it('presses a covered control through its accessible action instead of clicking a window it cannot see', async () => {
    // Apply has a press action here, so the fallback can use it.
    const data = tree() as Array<{ pid: number; children: Array<{ children: Array<Record<string, unknown>> }> }>
    const apply = data[1]?.children[0]?.children.find(child => child['name'] === 'Apply')
    if (apply !== undefined) apply['actions'] = ['press']
    writeFileSync(treeFile, JSON.stringify(data))
    const sent: string[] = []
    const run: CommandRunner = async (file, args) => {
      if (file === 'python3') return python(args)
      if (file === 'sh' && String(args[1]).startsWith('pgrep -x ydotoold')) return ''
      if (file === 'sh' && args[1] === 'command -v "$1" >/dev/null 2>&1 && echo yes') return args[3] === 'xdotool' ? 'yes\n' : ''
      if (file === 'gdbus') throw new Error('no Window Calls extension')
      if (file === 'wlr-randr') throw new Error('wlr-randr is not installed')
      if (file === 'wmctrl' && args[0] === '-lpG') return '0x04000007  0 42     0    0    800  600  host Display Settings\n'
      if (file === 'xrandr') return 'HDMI-1 connected primary 1920x1080+0+0 (normal) 527mm x 296mm\n'
      if (file === 'xdotool' && args[0] === 'getactivewindow') return String(0x04000007)
      // A native Wayland window covers the point: X reports its root window there.
      if (file === 'xwininfo') return 'xwininfo: Window id: 0x2e9 (the root window) (has no name)\n'
      if (file === 'xdotool' && args[0] === 'getmouselocation') return 'X=640\nY=565\nSCREEN=0\nWINDOW=745\n'
      if (file === 'sh' || file === 'ps') return ''
      sent.push(`${file} ${args.join(' ')}`)
      return ''
    }
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const backend = linuxBackend(run, { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' })
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    try {
      const result = await executeToolFixture(ctx, {
        name: 'desktop_element', callId: ToolCallId('covered'), arguments: { action: 'click', name: 'Apply', title: 'Display Settings' }, signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result.content)).toContain('[8] is covered by a window these tools cannot see, so it was pressed through its accessible action')
      expect(calls()).toEqual(['do_action Apply press'])
      // The pointer moved to look, but no button was pressed.
      expect(sent).toEqual(['xdotool mousemove --sync 640 565'])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
