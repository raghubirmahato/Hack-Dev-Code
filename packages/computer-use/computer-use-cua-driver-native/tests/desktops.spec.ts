import { describe, expect, it } from 'vitest'
import { linuxBackend } from '../src/displays.ts'
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
