import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LINUX_PASTE, fitScale, linuxBackend, linuxDragArgs, parseWmctrl, parseXrandr, selectWindow, waitForWindow, windowOutcome, windowsBackend } from '../src/displays.ts'
import type { CommandRunner, WindowInfo } from '../src/displays.ts'
import { parseKeys } from '../src/keys.ts'

const XRANDR = [
  'Screen 0: minimum 320 x 200, current 4480 x 1440, maximum 16384 x 16384',
  'eDP-1 connected primary 1920x1080+0+360 (normal left inverted right x axis y axis) 309mm x 174mm',
  '   1920x1080     60.00*+',
  'HDMI-1 connected 2560x1440+1920+0 (normal left inverted right x axis y axis) 597mm x 336mm',
  'DP-1 disconnected (normal left inverted right x axis y axis)',
].join('\n')

describe('Linux displays', () => {
  it('reads every connected monitor and its position from xrandr', () => {
    expect(parseXrandr(XRANDR)).toEqual([
      { index: 0, name: 'eDP-1', primary: true, x: 0, y: 360, width: 1920, height: 1080 },
      { index: 1, name: 'HDMI-1', primary: false, x: 1920, y: 0, width: 2560, height: 1440 },
    ])
  })

  it('captures one display with a crop and clicks on the second monitor through xdotool', async () => {
    const calls: string[][] = []
    const run: CommandRunner = async (file, args) => { calls.push([file, ...args]); return file === 'xrandr' ? XRANDR : '' }
    const backend = linuxBackend(run, { DISPLAY: ':0' })
    const [, second] = await backend.list()
    expect(await backend.capture('/tmp/s.png', second, 1600)).toEqual({ width: 1600, height: 900, scale: 1600 / 2560 })
    await backend.pointer(2000, 100, 'left', 2)
    expect(calls.slice(1)).toEqual([
      ['import', '-window', 'root', '-crop', '2560x1440+1920+0', '-resize', '1600x1600>', '/tmp/s.png'],
      ['xdotool', 'mousemove', '--sync', '2000', '100', 'click', '--repeat', '2', '1'],
    ])
  })

  it('tells how to install a missing helper, or that Wayland needs an Xorg session', async () => {
    const missing: CommandRunner = async () => { throw new Error('spawn xrandr ENOENT') }
    await expect(linuxBackend(missing, { DISPLAY: ':0' }).list()).rejects.toThrow('sudo apt-get install -y x11-xserver-utils xdotool imagemagick')
    await expect(linuxBackend(missing, { WAYLAND_DISPLAY: 'wayland-0' }).list()).rejects.toThrow('Xorg session')
  })
})

describe('Windows displays', () => {
  it('turns one or several screens from PowerShell into indexed displays', async () => {
    const two = async (): Promise<string> => JSON.stringify([
      { name: '\\\\.\\DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080 },
      { name: '\\\\.\\DISPLAY2', primary: false, x: -1280, y: 0, width: 1280, height: 1024 },
    ])
    expect((await windowsBackend(two).list()).map(d => [d.index, d.x, d.primary])).toEqual([[0, 0, true], [1, -1280, false]])
    const one = async (): Promise<string> => JSON.stringify({ name: '\\\\.\\DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080 })
    expect(await windowsBackend(one).list()).toHaveLength(1)
  })

  it.runIf(process.platform === 'win32')('lists, captures and moves the pointer on this machine', async () => {
    const backend = windowsBackend()
    const displays = await backend.list()
    expect(displays.length).toBeGreaterThan(0)
    expect(displays.some(d => d.primary)).toBe(true)
    const dir = await mkdtemp(join(tmpdir(), 'displays-'))
    try {
      const path = join(dir, 'all.png')
      const size = await backend.capture(path, undefined, 800)
      expect(existsSync(path) && statSync(path).size > 1000).toBe(true)
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(800)
      const first = displays[0]!
      const windows = await backend.windows()
      // An administrator window in front blocks unelevated pointer moves; that path is covered by elevated.spec.ts.
      if (!windows.some(window => window.foreground && window.elevated === true)) await backend.pointer(first.x + 5, first.y + 5, 'none', 1)
      expect(windows.length).toBeGreaterThan(0)
      expect(windows.every(window => typeof window.handle === 'number' && window.title.length > 0)).toBe(true)
    } finally {
      backend.close()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('window snapshot defaults', () => {
  it('bounds a window snapshot unless the model asks otherwise, and leaves other tools alone', async () => {
    const { withSnapshotDefaults } = await import('../src/snapshot.ts')
    expect(withSnapshotDefaults('get_window_state', { pid: 1, window_id: 2 })).toEqual({ pid: 1, window_id: 2, max_elements: 400, max_dimension: 1280 })
    expect(withSnapshotDefaults('get_window_state', { pid: 1, window_id: 2, query: 'Save', max_dimension: 600 }))
      .toEqual({ pid: 1, window_id: 2, query: 'Save', max_dimension: 600 })
    expect(withSnapshotDefaults('get_window_state', { pid: 1, window_id: 2, max_elements: 9000 })).toMatchObject({ max_elements: 9000 })
    expect(withSnapshotDefaults('click', { pid: 1 })).toEqual({ pid: 1 })
  })
})

describe('essential tool set', () => {
  it('leaves out recording, cursor-overlay, configuration and session bookkeeping tools by default', async () => {
    const provider = await import('../src/index.ts')
    expect(provider.Config({})).toEqual({ toolset: 'essential', onDemand: true, elevation: 'ask' })
    expect(provider.DESKTOP_GROUP.name).toBe('desktop')
    for (const name of ['start_recording', 'set_agent_cursor_theme', 'set_config', 'end_session', 'install_ffmpeg']) {
      expect(provider.NON_ESSENTIAL_TOOLS.has(name)).toBe(true)
    }
    for (const name of ['click', 'type_text', 'get_window_state', 'list_windows', 'launch_app', 'browser_navigate', 'clipboard_read']) {
      expect(provider.NON_ESSENTIAL_TOOLS.has(name)).toBe(false)
    }
  })
})

describe('snapshot identity', () => {
  it('puts the snapshot id and token format in the text the model reads', async () => {
    const { withSnapshotIdentity } = await import('../src/snapshot.ts')
    const raw = { content: [{ type: 'text', text: 'window_id=7 pid=9 elements=2' }], structuredContent: { snapshot_id: 's00000004', elements: [] } }
    const out = withSnapshotIdentity('get_window_state', raw) as { content: { text: string }[] }
    expect(out.content[0]!.text).toMatch(/^snapshot_id=s00000004\. Address an element with element_token "s00000004:<element_index>"/u)
    expect(out.content[0]!.text).toContain('window_id=7 pid=9 elements=2')
    expect(withSnapshotIdentity('click', raw)).toBe(raw)
    expect(withSnapshotIdentity('get_window_state', { content: [] })).toEqual({ content: [] })
  })
})

describe('real keyboard input', () => {
  it('parses chords and sequences into virtual keys and X11 keysyms', () => {
    expect(parseKeys('ctrl+shift+esc')).toEqual([{ names: ['ctrl', 'shift', 'esc'], vk: [0x11, 0x10, 0x1B], x11: 'ctrl+shift+Escape' }])
    expect(parseKeys('Win+R  enter').map(chord => chord.x11)).toEqual(['super+r', 'Return'])
    expect(parseKeys('alt+F4')[0]?.vk).toEqual([0x12, 0x73])
    expect(parseKeys('ctrl+plus')[0]?.vk).toEqual([0x11, 0xBB])
    expect(parseKeys('page_down numpad7')[1]?.x11).toBe('KP_7')
    expect(() => parseKeys('ctrl+hyper')).toThrow('unknown key "hyper"')
    expect(() => parseKeys('   ')).toThrow('keys is empty')
  })

  it('sends chords, text, drags and wheel turns through one Windows script each', async () => {
    const scripts: string[] = []
    const backend = windowsBackend(async (script) => { scripts.push(script); return '' })
    const text = 'h\u00e9llo\n'
    await backend.keys(parseKeys('win+r enter'))
    await backend.type(text)
    await backend.drag(10, 20, 300, 40, 'left')
    await backend.scroll(5, 6, -3, false)
    await backend.window(4242, 'close')
    await backend.open("C:\\it's here")
    const normal = (body: string): string => `if ([HackDev.Desk]::ForegroundNeedsElevation()) { 'HACKDEV_NEEDS_ELEVATION' } else { ${body} }`
    const at = (x: number, y: number, body: string): string => `if ([HackDev.Desk]::PointNeedsElevation(${String(x)}, ${String(y)})) { 'HACKDEV_NEEDS_ELEVATION' } else { ${body} }`
    expect(scripts[0]).toBe(normal('[HackDev.Desk]::Chord([uint16[]]@(91,82)); Start-Sleep -Milliseconds 60; [HackDev.Desk]::Chord([uint16[]]@(13))'))
    expect(scripts[1]).toContain(Buffer.from(text, 'utf8').toString('base64'))
    expect(scripts.slice(2)).toEqual([
      at(10, 20, '[HackDev.Desk]::Drag(10, 20, 300, 40, 2, 4)'),
      at(5, 6, '[HackDev.Desk]::Wheel(5, 6, -3, $false)'),
      "if ([HackDev.Desk]::WindowNeedsElevation(4242)) { 'HACKDEV_NEEDS_ELEVATION' } else { [HackDev.Desk]::Act([IntPtr]4242, 'close') }",
      "Start-Process -FilePath 'C:\\it''s here'",
    ])
  })

  it('drives xdotool and wmctrl on Linux', async () => {
    const calls: string[][] = []
    const run: CommandRunner = async (file, args) => { calls.push([file, ...args]); return '' }
    const backend = linuxBackend(run, { DISPLAY: ':0' })
    await backend.keys(parseKeys('ctrl+alt+t'))
    await backend.type('ls -la\n')
    await backend.scroll(1, 2, 4, false)
    await backend.scroll(1, 2, -2, true)
    await backend.drag(0, 0, 50, 60, 'right')
    await backend.window(0x1400007, 'maximize')
    await backend.open('https://example.com')
    expect(calls).toEqual([
      ['xdotool', 'key', '--clearmodifiers', 'ctrl+alt+t'],
      ['xdotool', 'type', '--clearmodifiers', '--delay', '12', '--', 'ls -la\n'],
      ['xdotool', 'mousemove', '--sync', '1', '2', 'click', '--repeat', '4', '4'],
      ['xdotool', 'mousemove', '--sync', '1', '2', 'click', '--repeat', '2', '6'],
      ['xdotool', ...linuxDragArgs(0, 0, 50, 60, '3')],
      ['wmctrl', '-ir', '0x1400007', '-b', 'add,maximized_vert,maximized_horz'],
      ['xdg-open', 'https://example.com'],
    ])
  })
})

describe('Linux drags and paste', () => {
  it('drags in steps so drop targets see the pointer travel', () => {
    const args = linuxDragArgs(0, 0, 400, 0, '1')
    expect(args.slice(0, 7)).toEqual(['mousemove', '--sync', '0', '0', 'mousedown', '1', 'sleep'])
    expect(args.filter(arg => arg === 'mousemove')).toHaveLength(1 + 16)
    expect(args.slice(-9)).toEqual(['mousemove', '400', '0', 'sleep', '0.012', 'sleep', '0.08', 'mouseup', '1'])
  })

  it('pastes long text through xclip and types when xclip is missing', async () => {
    const calls: string[][] = []
    const withXclip: CommandRunner = async (file, args) => { calls.push([file, ...args]); return file === 'sh' ? 'PASTED\n' : '' }
    await linuxBackend(withXclip, { DISPLAY: ':0' }).type('long text', true)
    expect(calls).toEqual([['sh', '-c', LINUX_PASTE, 'sh', 'long text']])
    const typed: string[][] = []
    const noXclip: CommandRunner = async (file, args) => { typed.push([file, ...args]); if (file === 'sh') throw new Error('exit 3'); return '' }
    await linuxBackend(noXclip, { DISPLAY: ':0' }).type('long text', true)
    expect(typed.at(-1)).toEqual(['xdotool', 'type', '--clearmodifiers', '--delay', '12', '--', 'long text'])
  })
})

describe('window selection', () => {
  const window = (handle: number, title: string, foreground = false): WindowInfo => ({
    handle, pid: handle, process: 'app', title, x: 0, y: 0, width: 800, height: 600, minimized: false, foreground,
  })
  const windows = [window(1, 'Untitled - Notepad'), window(2, 'notes.txt - Notepad', true), window(3, 'Calculator')]

  it('picks by handle, by a unique title fragment, or by an exact title among several', () => {
    expect(selectWindow(windows, 3).title).toBe('Calculator')
    expect(selectWindow(windows, undefined, 'calc').handle).toBe(3)
    expect(selectWindow([...windows, window(4, 'Calculator Help')], undefined, 'calculator').handle).toBe(3)
  })

  it('explains ambiguous and missing matches', () => {
    expect(() => selectWindow(windows, undefined, 'notepad')).toThrow(/2 windows match "notepad"; pass handle:\nhandle 1/u)
    expect(() => selectWindow(windows, undefined, 'paint')).toThrow('no window title contains "paint"')
    expect(() => selectWindow(windows, 9)).toThrow('no visible top-level window with handle 9')
    expect(() => selectWindow(windows)).toThrow('pass handle or title')
  })

  it('reads wmctrl windows and skips sticky panels', () => {
    const text = '0x01400007  0 4321   10 20  800 600  host  Terminal - bash\n0x00e00003 -1 999 0 0 1920 32 host  Top Panel\n'
    expect(parseWmctrl(text, 0x1400007)).toEqual([
      { handle: 0x1400007, pid: 4321, process: '', title: 'Terminal - bash', x: 10, y: 20, width: 800, height: 600, minimized: false, foreground: true },
    ])
  })

  it('scales captures to fit the longest side', () => {
    expect(fitScale(1920, 1080, 1600)).toBeCloseTo(1600 / 1920)
    expect(fitScale(1280, 720, 1600)).toBe(1)
  })
})

describe('waiting for windows', () => {
  const window = (title: string): WindowInfo => ({ handle: 7, pid: 7, process: 'app', title, x: 0, y: 0, width: 10, height: 10, minimized: false, foreground: false })

  it('returns once a matching window appears, or once it is gone', async () => {
    const lists = [[], [], [window('Settings')]]
    let calls = 0
    const appearing = { windows: async (): Promise<WindowInfo[]> => lists[Math.min(calls++, lists.length - 1)] ?? [] }
    await expect(waitForWindow(appearing, 'settings', false, 2000, undefined, 5)).resolves.toMatch(/^Appeared: handle 7/u)
    expect(calls).toBe(3)
    const closing = { windows: async (): Promise<WindowInfo[]> => [] }
    await expect(waitForWindow(closing, 'Save As', true, 2000, undefined, 5)).resolves.toBe('No window title contains "Save As" any more.')
  })

  it('times out, honours cancellation and validates its arguments', async () => {
    const never = { windows: async (): Promise<WindowInfo[]> => [window('Other')] }
    await expect(waitForWindow(never, 'Paint', false, 500, undefined, 50)).rejects.toThrow('no window title contained "Paint" within 500 ms')
    const aborted = AbortSignal.abort()
    await expect(waitForWindow(never, 'Paint', false, 5000, aborted)).rejects.toThrow()
    await expect(waitForWindow(never, '  ', false, 5000)).rejects.toThrow('wait needs title')
    await expect(waitForWindow(never, 'Paint', false, 100)).rejects.toThrow('timeout_ms must be between 500 and 60000')
  })
})

describe('window action results', () => {
  const window = (handle: number, title: string, extra: Partial<WindowInfo> = {}): WindowInfo => ({
    handle, pid: 50, process: 'app', title, x: 10, y: 10, width: 400, height: 300, minimized: false, foreground: false, ...extra,
  })

  it('reports the state after the action, not before it', async () => {
    const before = window(9, 'Calculator', { minimized: true, x: -32000, y: -32000 })
    const backend = { windows: async (): Promise<WindowInfo[]> => [window(9, 'Calculator', { foreground: true })] }
    const text = await windowOutcome(backend, before, 'restore', undefined, 1)
    expect(text).toBe('restore done; now handle 9 pid 50 app "Calculator" 400x300 at (10, 10) [foreground]')
  })

  it('confirms a close, or points at a save prompt that kept the window open', async () => {
    const target = window(9, 'notes.txt - Editor')
    const gone = { windows: async (): Promise<WindowInfo[]> => [] }
    await expect(windowOutcome(gone, target, 'close', undefined, 1, 50)).resolves.toBe('Closed "notes.txt - Editor" (handle 9); it is no longer open.')
    const prompting = { windows: async (): Promise<WindowInfo[]> => [target, window(10, 'Save changes?')] }
    const text = await windowOutcome(prompting, target, 'close', undefined, 1, 20)
    expect(text).toMatch(/^Asked "notes.txt - Editor" to close, but it is still open/u)
    expect(text).toContain('possibly a save prompt: handle 10 pid 50 app "Save changes?"')
  })
})

describe('Linux window text and modifier clicks', () => {
  it('reads a window through AT-SPI by its process and title', async () => {
    const calls: string[][] = []
    const run: CommandRunner = async (file, args) => {
      calls.push([file, ...args.slice(file === 'python3' ? 2 : 0)])
      if (file === 'wmctrl') return '0x01400007  0 4321   10 20  800 600  host  Calculator\n'
      return 'Frame: Calculator\n  Label: 56\n'
    }
    const backend = linuxBackend(run, { DISPLAY: ':0' })
    await expect(backend.readText(0x1400007)).resolves.toBe('Frame: Calculator\n  Label: 56\n')
    expect(calls).toEqual([['wmctrl', '-lpG'], ['python3', '4321', 'Calculator']])
    await expect(backend.readText(5)).rejects.toThrow('no window with handle 5')
  })

  it('explains how to enable window text when the accessibility bus is missing', async () => {
    const run: CommandRunner = async (file) => {
      if (file === 'wmctrl') return '0x01400007  0 4321   10 20  800 600  host  Calculator\n'
      throw new Error('python3 failed: ValueError: Namespace Atspi not available')
    }
    await expect(linuxBackend(run, { DISPLAY: ':0' }).readText(0x1400007)).rejects.toThrow('python3-gi gir1.2-atspi-2.0')
  })

  it('holds modifier keys around a click', async () => {
    const calls: string[][] = []
    const backend = linuxBackend(async (file, args) => { calls.push([file, ...args]); return '' }, { DISPLAY: ':0' })
    await backend.pointer(5, 6, 'left', 1, parseKeys('ctrl+shift')[0])
    expect(calls).toEqual([['xdotool', 'mousemove', '--sync', '5', '6', 'keydown', 'ctrl', 'keydown', 'shift', 'click', '--repeat', '1', '1', 'keyup', 'shift', 'keyup', 'ctrl']])
  })

  it('sends a modifier click on Windows as one ClickWith call', async () => {
    const scripts: string[] = []
    const backend = windowsBackend(async (script) => { scripts.push(script); return '' })
    await backend.pointer(5, 6, 'left', 1, parseKeys('ctrl')[0])
    expect(scripts[0]).toContain('[HackDev.Desk]::ClickWith([uint16[]]@(17), 2, 4, 1)')
  })
})

describe('Linux typing limits and cancellation', () => {
  it('gives long text a time limit that grows with its length', async () => {
    const limits: (number | undefined)[] = []
    const backend = linuxBackend(async (_file, _args, timeoutMs) => { limits.push(timeoutMs); return '' }, { DISPLAY: ':0' })
    await backend.type('x'.repeat(10_000))
    expect(limits).toEqual([30_000 + 10_000 * 15])
  })

  it('stops waiting at once when cancelled, without killing the running xdotool', async () => {
    let finished = false
    const backend = linuxBackend(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
      finished = true
      return ''
    }, { DISPLAY: ':0' })
    const controller = new AbortController()
    const started = Date.now()
    const typing = backend.type('hello', false, controller.signal)
    setTimeout(() => { controller.abort() }, 30)
    await expect(typing).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(300)
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(finished).toBe(true)
  })
})
