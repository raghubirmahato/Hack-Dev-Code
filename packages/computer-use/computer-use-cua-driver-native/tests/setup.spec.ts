import { describe, expect, it } from 'vitest'
import { formatSetup, LINUX_PROBE, linuxSetup, parseProbe, windowsSetup } from '../src/setup.ts'
import { linuxBackend } from '../src/displays.ts'

/** Probe output where the named commands exist and everything else is missing. */
function probe(present: readonly string[], extra: Record<string, string> = {}): ReadonlyMap<string, string> {
  const names = ['xdotool', 'wmctrl', 'xrandr', 'import', 'convert', 'xdg-open', 'xclip', 'xprop', 'tesseract', 'python3', 'ydotool', 'wl-copy', 'grim',
    'gnome-screenshot', 'spectacle', 'wlr-randr', 'swaymsg', 'hyprctl', 'kdotool', 'gdbus', 'apt-get', 'dnf', 'pacman', 'zypper', 'ydotoold', 'atspi', 'windowcalls']
  const lines = names.map(name => `${name}=${present.includes(name) ? 'yes' : 'no'}`)
  return parseProbe([...lines, ...Object.entries(extra).map(([key, value]) => `${key}=${value}`)].join('\n'))
}

describe('Linux setup report', () => {
  it('lists what an X11 session lacks and one apt command that installs all of it', () => {
    const report = linuxSetup(probe(['xdotool', 'wmctrl', 'xrandr', 'xdg-open', 'python3', 'apt-get']), { XDG_SESSION_TYPE: 'x11' }, false)
    expect(report.checks.filter(check => !check.ok).map(check => check.feature)).toEqual([
      'Screenshots', 'The window under a point (safer drags, reservations)', 'Long text through the clipboard', 'Text recognition on screen', 'Window text and controls by name',
    ])
    expect(report.install).toBe('sudo apt-get install -y imagemagick x11-utils xclip tesseract-ocr python3-gi gir1.2-atspi-2.0 at-spi2-core')
    const text = formatSetup(report)
    expect(text).toContain('ready: Real mouse and keyboard input (xdotool)')
    expect(text).toContain('missing: Text recognition on screen (tesseract is missing)')
    expect(text).toContain('Install the missing packages with: sudo apt-get install -y imagemagick')
  })

  it('uses the names of the package manager it finds', () => {
    expect(linuxSetup(probe(['dnf']), {}, false).install).toContain('sudo dnf install -y xdotool wmctrl xrandr ImageMagick xprop xclip tesseract python3-gobject at-spi2-core xdg-utils')
    expect(linuxSetup(probe(['pacman']), {}, false).install).toContain('sudo pacman -S --needed xdotool wmctrl xorg-xrandr imagemagick xorg-xprop xclip tesseract tesseract-data-eng python-gobject')
    const none = linuxSetup(probe([]), {}, false)
    expect(none.install).toBeUndefined()
    expect(formatSetup(none)).toContain('No known package manager was found')
  })

  it('reports a stopped ydotoold service and the GNOME Window Calls extension on Wayland', () => {
    const report = linuxSetup(probe(['ydotool', 'gnome-screenshot', 'convert', 'wl-copy', 'tesseract', 'atspi', 'xdg-open', 'apt-get']), {
      XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME', DISPLAY: ':0',
    }, true)
    const text = formatSetup(report)
    expect(text).toContain('missing: Real mouse and keyboard input (the ydotoold service is not running)')
    expect(text).toContain('ready: Screenshots (gnome-screenshot and ImageMagick)')
    expect(text).toContain('ready: Displays (XWayland)')
    expect(text).toContain('missing: Listing and moving every window (GNOME keeps its windows private without the Window Calls extension')
    expect(text).toContain('- start the input service with: sudo systemctl enable --now ydotoold')
    expect(text).toContain('- install the Window Calls extension from https://extensions.gnome.org/extension/4724/window-calls/')
    expect(report.install).toBeUndefined()
  })

  it('counts KDE with kdotool, Sway and GNOME with the extension as full window control', () => {
    const lists = (present: string[], env: Record<string, string>): string | undefined =>
      linuxSetup(probe(present), { XDG_SESSION_TYPE: 'wayland', ...env }, true).checks.find(check => check.feature === 'Listing and moving every window')?.detail
    expect(lists(['kdotool'], { XDG_CURRENT_DESKTOP: 'KDE' })).toBe('KWin through kdotool')
    expect(lists(['swaymsg'], { SWAYSOCK: '/run/user/1000/sway.sock' })).toBe('Sway')
    expect(lists(['windowcalls'], { XDG_CURRENT_DESKTOP: 'GNOME' })).toBe('GNOME Shell through the Window Calls extension')
    expect(lists([], { XDG_CURRENT_DESKTOP: 'KDE' })).toContain('KDE keeps its windows private without kdotool')
  })

  it('asks for assistive technologies when GNOME has them turned off', () => {
    const text = formatSetup(linuxSetup(probe(['atspi']), {}, false))
    expect(text).toContain('ready: Window text and controls by name')
    const off = formatSetup(linuxSetup(probe(['atspi'], { a11y: 'false' }), {}, false))
    expect(off).toContain('missing: Window text and controls by name (assistive technologies are turned off)')
    expect(off).toContain('gsettings set org.gnome.desktop.interface toolkit-accessibility true')
  })

  it('runs the probe through the backend', async () => {
    const backend = linuxBackend(async (file, args) => {
      expect([file, args[0], args[1]]).toEqual(['sh', '-c', LINUX_PROBE])
      return 'xdotool=yes\nwmctrl=yes\nxrandr=yes\nimport=yes\nxprop=yes\nxclip=yes\ntesseract=yes\natspi=yes\nxdg-open=yes\n'
    }, { XDG_SESSION_TYPE: 'x11' })
    expect(formatSetup(await backend.setup!())).toContain('Everything the desktop tools use is available.')
  })
})

describe('Windows setup report', () => {
  it('names the text recognition languages and how to add one', () => {
    expect(formatSetup(windowsSetup(parseProbe('uia=True\nocr=en-US,de-DE\nelevated=False\ngdi=True')))).toContain('ready: Text recognition on screen (Windows text recognition, languages en-US, de-DE)')
    const none = formatSetup(windowsSetup(parseProbe('uia=False\nocr=\nelevated=True\ngdi=True')))
    expect(none).toContain('missing: Window text and controls by name (UI Automation could not be loaded)')
    expect(none).toContain('- add a language with the Optical character recognition feature in Settings > Time & language > Language & region')
    expect(none).toContain('ready: Apps running as administrator (this app runs as administrator)')
  })
})
