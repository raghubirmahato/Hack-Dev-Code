import { describe, expect, it } from 'vitest'
import { applyX11Geometry, LAUNCH_SCRIPT, launchWords, linuxBackend, parsePsNames, X11_APP_ENV, X11_GEOMETRY } from '../src/displays.ts'
import { parseKeys } from '../src/keys.ts'
import type { CommandRunner } from '../src/displays.ts'
import { gvariantString, parseKdotoolGeometry, parseWindowCalls } from '../src/wayland.ts'

describe('GNOME Shell through the Window Calls extension', () => {
  it('unwraps the GVariant string gdbus prints', () => {
    expect(gvariantString("('[{\"id\": 1}]',)\n")).toBe('[{"id": 1}]')
    expect(gvariantString("('it\\'s \\\\ here',)")).toBe("it's \\ here")
    expect(() => gvariantString('Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown')).toThrow('unexpected reply from GNOME Shell')
  })

  it('lists normal windows and dialogs, completing old list replies with Details', async () => {
    const asked: number[] = []
    const windows = await parseWindowCalls(JSON.stringify([
      { id: 11, pid: 300, wm_class: 'org.gnome.TextEditor', title: 'notes.txt', x: 10, y: 20, width: 800, height: 600, focus: true, window_type: 0 },
      { id: 12, pid: 301, wm_class: 'firefox', window_type: 0 },
      { id: 13, pid: 1, wm_class: 'gnome-shell', window_type: 2 },
    ]), async (id) => {
      asked.push(id)
      return JSON.stringify({ id, title: 'Mozilla Firefox', x: 900, y: 0, width: 1000, height: 900, minimized: true })
    })
    expect(asked).toEqual([12])
    expect(windows).toEqual([
      { handle: 11, pid: 300, process: 'org.gnome.TextEditor', title: 'notes.txt', x: 10, y: 20, width: 800, height: 600, minimized: false, foreground: true },
      { handle: 12, pid: 301, process: 'firefox', title: 'Mozilla Firefox', x: 900, y: 0, width: 1000, height: 900, minimized: true, foreground: false },
    ])
  })

  it('lists, focuses, maximizes and places windows through gdbus in a GNOME Wayland session', async () => {
    const calls: string[] = []
    const run: CommandRunner = async (file, args) => {
      if (file === 'gdbus') {
        const method = String(args[args.indexOf('--method') + 1]).replace('org.gnome.Shell.Extensions.Windows.', '')
        calls.push([method, ...args.slice(args.indexOf('--method') + 2)].join(' '))
        if (method === 'List') return "('[{\"id\": 7, \"pid\": 50, \"wm_class\": \"gedit\", \"title\": \"Draft\", \"x\": 0, \"y\": 0, \"width\": 640, \"height\": 480, \"focus\": true}]',)\n"
        return '()\n'
      }
      throw new Error(`unexpected command ${file}`)
    }
    const backend = linuxBackend(run, { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME', WAYLAND_DISPLAY: 'wayland-0' })
    expect(await backend.windows()).toEqual([{ handle: 7, pid: 50, process: 'gedit', title: 'Draft', x: 0, y: 0, width: 640, height: 480, minimized: false, foreground: true }])
    await backend.window(7, 'focus')
    await backend.window(7, 'maximize')
    await backend.window(7, 'close')
    await backend.place(7, 100, 50, 900, 700)
    expect(calls.filter(call => call !== 'List')).toEqual(['Activate 7', 'Maximize 7', 'Close 7', 'Unmaximize 7', 'MoveResize 7 100 50 900 700'])
  })
})

describe('KWin through kdotool', () => {
  it('reads the position and size kdotool prints', () => {
    expect(parseKdotoolGeometry('Window {a1}\n  Position: 120,45 (screen: 0)\n  Geometry: 800x600\n')).toEqual({ x: 120, y: 45, width: 800, height: 600 })
    expect(parseKdotoolGeometry('Position: -10.5,3\nGeometry: 300.4x200')).toEqual({ x: -10, y: 3, width: 300, height: 200 })
  })

  it('numbers KWin windows for the session and acts on them by UUID in a KDE Wayland session', async () => {
    const sent: string[] = []
    const windows: Record<string, { name: string; pid: string; cls: string; geometry: string }> = {
      '{5f1c}': { name: 'Document - Kate', pid: '700', cls: 'org.kde.kate', geometry: 'Window {5f1c}\n  Position: 0,0\n  Geometry: 1000x700\n' },
      '{9a2e}': { name: 'Dolphin', pid: '701', cls: 'org.kde.dolphin', geometry: 'Window {9a2e}\n  Position: 1000,0\n  Geometry: 900x700\n' },
    }
    const run: CommandRunner = async (file, args) => {
      if (file === 'sh') return 'yes\n'
      if (file !== 'kdotool') throw new Error(`unexpected command ${file}`)
      const [command, uuid = ''] = args
      if (command === 'search') return '{5f1c}\n{9a2e}\n'
      if (command === 'getactivewindow') return '{9a2e}\n'
      const window = windows[uuid]
      if (command === 'getwindowname') return `${window?.name ?? ''}\n`
      if (command === 'getwindowpid') return `${window?.pid ?? ''}\n`
      if (command === 'getwindowclassname') return `${window?.cls ?? ''}\n`
      if (command === 'getwindowgeometry') return window?.geometry ?? ''
      sent.push(args.join(' '))
      return ''
    }
    const backend = linuxBackend(run, { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'KDE', WAYLAND_DISPLAY: 'wayland-0' })
    const listed = await backend.windows()
    const rows = listed.map(window => [window.handle, window.title, window.process, window.pid, window.x, window.width, window.foreground])
    expect(rows).toEqual([
      [1, 'Document - Kate', 'org.kde.kate', 700, 0, 1000, false],
      [2, 'Dolphin', 'org.kde.dolphin', 701, 1000, 900, true],
    ])
    // The numbers stay the same when the windows are listed again.
    expect((await backend.windows()).map(window => window.handle)).toEqual([1, 2])
    await backend.window(1, 'focus')
    await backend.window(2, 'maximize')
    await backend.place(1, 10, 20, 600, 400)
    expect(sent).toEqual([
      'windowactivate {5f1c}', 'windowstate --add MAXIMIZED_VERT {9a2e}', 'windowstate --add MAXIMIZED_HORZ {9a2e}',
      'windowmove {5f1c} 10 20', 'windowsize {5f1c} 600 400',
    ])
    await expect(backend.window(9, 'close')).rejects.toThrow('no window with handle 9; list the windows again')
  })
})

describe('GNOME on Wayland without the extension or ydotoold', () => {
  /** A GNOME Wayland session with XWayland, one X11 Mousepad window, and ydotoold stopped or running. */
  function session(daemon: boolean, covered = { pointer: false, keyboard: false }): { run: CommandRunner; sent: string[] } {
    const sent: string[] = []
    const run: CommandRunner = async (file, args) => {
      if (file === 'sh' && String(args[1]).startsWith('pgrep -x ydotoold')) return daemon ? 'yes\n' : ''
      if (file === 'sh' && args[1] === 'command -v "$1" >/dev/null 2>&1 && echo yes') return args[3] === 'xdotool' ? 'yes\n' : ''
      if (file === 'gdbus') throw new Error('GDBus.Error:org.freedesktop.DBus.Error.UnknownMethod')
      // As measured on Kali: the content at (80, 118) under a 38-pixel title bar, while wmctrl says (105, 181).
      if (file === 'sh' && args[1] === X11_GEOMETRY) return '0x2a00004 80 118 0 0 38 0\n'
      if (file === 'ps') return ' 4100 mousepad\n'
      if (file === 'wmctrl' && args[0] === '-lpG') return '0x02a00004  0 4100   105 181  700 480  kali  Untitled 1 - Mousepad\n'
      if (file === 'xprop') return '_NET_CLIENT_LIST_STACKING: window id # 0x2a00004\n'
      // The shell (GNOME's placeholder window) has the keyboard, or Mousepad does.
      if (file === 'xdotool' && args[0] === 'getactivewindow') return String(covered.keyboard ? 0x400003 : 0x2a00004)
      // X reports the root window under the pointer where a native Wayland window covers the point.
      if (file === 'xwininfo') return 'xwininfo: Window id: 0x2e9 (the root window) (has no name)\n'
      if (file === 'xdotool' && args[0] === 'getmouselocation') return `X=100\nY=120\nSCREEN=0\nWINDOW=${String(covered.pointer ? 0x2e9 : 0x2a00002)}\n`
      sent.push(`${file} ${file === 'sh' ? args.slice(3).join(' ') : args.join(' ')}`)
      return ''
    }
    return { run, sent }
  }
  const env = { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'GNOME', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }

  it('starts apps as X11 apps, sends input through xdotool and knows the X11 window under a point', async () => {
    const { run, sent } = session(false)
    const backend = linuxBackend(run, env)
    expect(await backend.launch('mousepad --disable-server')).toBe('Started mousepad --disable-server as an X11 app, so its windows can be listed and operated')
    await backend.keys(parseKeys('ctrl+s'))
    await backend.pointer(100, 120, 'left', 1)
    expect((await backend.windows())[0]).toMatchObject({ x: 80, y: 80, width: 700, height: 518, process: 'mousepad' })
    expect(await backend.windowAt?.(100, 90)).toBe(0x2a00004)
    expect(await backend.windowAt?.(1500, 800)).toBe(0)
    // A move asks for the outer size, title bar included; wmctrl sets the content size.
    await backend.place(0x2a00004, 80, 80, 700, 480)
    expect(sent).toEqual([
      `sh mousepad --disable-server ${X11_APP_ENV.join(' ')}`,
      'xdotool key --clearmodifiers ctrl+s',
      'xdotool mousemove --sync 100 120',
      'xdotool click --repeat 1 1',
      'wmctrl -ir 0x2a00004 -b remove,maximized_vert,maximized_horz',
      'wmctrl -ir 0x2a00004 -e 0,80,80,700,442',
    ])
  })

  it('presses nothing where a window X cannot see covers the point, and types nothing while the shell has the keyboard', async () => {
    const pointer = session(false, { pointer: true, keyboard: false })
    const covered = linuxBackend(pointer.run, env)
    await expect(covered.pointer(100, 120, 'left', 1)).rejects.toThrow('at (100, 120) a window these tools cannot see is on top')
    await expect(covered.drag(100, 120, 300, 120, 'left')).rejects.toThrow('the pointer moved there but nothing was pressed')
    expect(pointer.sent).toEqual(['xdotool mousemove --sync 100 120', 'xdotool mousemove --sync 300 120'])
    const keyboard = session(false, { pointer: false, keyboard: true })
    const elsewhere = linuxBackend(keyboard.run, env)
    await expect(elsewhere.keys(parseKeys('ctrl+a'))).rejects.toThrow('the keyboard is with a window these tools cannot reach')
    await expect(elsewhere.type('secret', false)).rejects.toThrow('nothing was typed')
    expect(keyboard.sent).toEqual([])
  })

  it('sends input through ydotool while ydotoold runs, and then cannot tell which window is under a point', async () => {
    const { run, sent } = session(true)
    const backend = linuxBackend(run, env)
    await backend.keys(parseKeys('ctrl+s'))
    expect(await backend.windowAt?.(100, 120)).toBeUndefined()
    expect(sent).toEqual(['ydotool key 29:1 31:1 31:0 29:0'])
  })

  it('starts apps natively where the compositor lists them, and on X11', async () => {
    const x11: string[] = []
    const backend = linuxBackend(async (file, args) => { x11.push(`${file} ${args.slice(3).join(' ')}`); return '' }, { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })
    expect(await backend.launch('gedit')).toBe('Started gedit')
    expect(x11).toEqual(['sh gedit'])
    expect(LAUNCH_SCRIPT).toContain('set -f')
  })
})

describe('X11 window geometry', () => {
  it('replaces wmctrl positions with the real ones and keeps the content area for captures', () => {
    const listed = [
      { handle: 0x1400007, pid: 1, process: '', title: 'Mousepad', x: 1049, y: 377, width: 700, height: 480, minimized: false, foreground: true },
      { handle: 0x1600003, pid: 2, process: '', title: 'Terminal', x: 10, y: 10, width: 300, height: 200, minimized: false, foreground: false },
    ]
    const placed = applyX11Geometry(listed, '0x1400007 1024 314 0 0 38 0\n0x1600003\nnot a line\n')
    expect(placed.windows[0]).toMatchObject({ x: 1024, y: 276, width: 700, height: 518 })
    expect(placed.windows[1]).toMatchObject({ x: 10, y: 10, width: 300, height: 200 })
    expect(placed.clients.get(0x1400007)).toEqual({ x: 1024, y: 314, width: 700, height: 480 })
    expect(placed.clients.has(0x1600003)).toBe(false)
  })
})

describe('naming apps on Linux', () => {
  it('reads process names from ps', () => {
    expect([...parsePsNames('  4100 mousepad --disable-server\n 52 /usr/bin/gnome-calculator\nnot a line\n')]).toEqual([[4100, 'mousepad'], [52, 'gnome-calculator']])
  })

  it('takes the words that find an app\'s window from its command, without options or paths', () => {
    expect(launchWords('gnome-calculator')).toEqual(['gnome', 'calculator'])
    expect(launchWords('mousepad --disable-server')).toEqual(['mousepad'])
    expect(launchWords('/usr/bin/gnome-text-editor /tmp/notes.txt')).toEqual(['gnome', 'text', 'editor'])
    expect(launchWords('Visual Studio Code')).toEqual(['visual', 'studio', 'code'])
  })
})
