/**
 * The desktop setup check: which desktop features work in this session, what is missing for the rest, and one
 * command that installs it, so a person can make desktop control reliable in one step.
 * @module @hackdevcode/dsh-computer-use-cua-driver-native/setup
 */

/** One feature of the desktop tools and whether it works here. */
export interface SetupCheck {
  /** What the feature lets the agent do. */
  readonly feature: string
  /** Whether it works in this session. */
  readonly ok: boolean
  /** What provides it, or what is missing. */
  readonly detail: string
  /** Packages that would provide it, by package manager; empty when nothing can be installed for it. */
  readonly packages?: Readonly<Partial<Record<PackageManager, readonly string[]>>>
  /** A step that is not a package, such as starting a service or enabling a setting. */
  readonly step?: string
}

/** The result of a setup check. */
export interface SetupReport {
  readonly checks: readonly SetupCheck[]
  /** One command that installs every missing package, when a known package manager is present. */
  readonly install?: string | undefined
}

/** Package managers whose package names are known. */
export type PackageManager = 'apt' | 'dnf' | 'pacman' | 'zypper'

/** Commands the Linux probe looks for. */
const COMMANDS = [
  'xdotool', 'wmctrl', 'xrandr', 'import', 'convert', 'xdg-open', 'xclip', 'xprop', 'tesseract', 'python3', 'ydotool',
  'wl-copy', 'grim', 'gnome-screenshot', 'spectacle', 'wlr-randr', 'swaymsg', 'hyprctl', 'kdotool', 'gdbus',
  'apt-get', 'dnf', 'pacman', 'zypper',
] as const

/**
 * Shell script that reports, one `name=yes|no` line each, which helper commands exist, whether the ydotoold service
 * runs, whether XWayland passes simulated input through the desktop's remote-desktop permission, whether Python can
 * load AT-SPI, whether GNOME's accessibility setting is on, and whether the GNOME Window
 * Calls extension answers.
 */
export const LINUX_PROBE = `for c in ${COMMANDS.join(' ')}; do if command -v "$c" >/dev/null 2>&1; then echo "$c=yes"; else echo "$c=no"; fi; done; `
  + 'if pgrep -x ydotoold >/dev/null 2>&1; then echo ydotoold=yes; else echo ydotoold=no; fi; '
  + 'if ps -o args= -C Xwayland 2>/dev/null | grep -q enable-ei-portal; then echo eiportal=yes; else echo eiportal=no; fi; '
  + 'if python3 -c "import gi; gi.require_version(\'Atspi\', \'2.0\'); from gi.repository import Atspi" >/dev/null 2>&1; then echo atspi=yes; else echo atspi=no; fi; '
  + 'a=$(gsettings get org.gnome.desktop.interface toolkit-accessibility 2>/dev/null); echo "a11y=$a"; '
  + 'if gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/Windows '
  + '--method org.gnome.Shell.Extensions.Windows.List >/dev/null 2>&1; then echo windowcalls=yes; else echo windowcalls=no; fi'

/** How to start the ydotool daemon, which needs root to write to /dev/uinput, so the person's own programs can use it. */
const YDOTOOLD_STEP = 'start the ydotool daemon: sudo ydotoold --socket-path=/tmp/.ydotool_socket --socket-own=$(id -u):$(id -g) & '
  + 'then start Hack Dev Code with YDOTOOL_SOCKET=/tmp/.ydotool_socket'

/** Package names of one helper on each package manager. */
type Packages = Readonly<Partial<Record<PackageManager, readonly string[]>>>

const same = (name: string): Packages => ({ apt: [name], dnf: [name], pacman: [name], zypper: [name] })
const IMAGEMAGICK: Packages = { apt: ['imagemagick'], dnf: ['ImageMagick'], pacman: ['imagemagick'], zypper: ['ImageMagick'] }
const XRANDR: Packages = { apt: ['x11-xserver-utils'], dnf: ['xrandr'], pacman: ['xorg-xrandr'], zypper: ['xrandr'] }
const XPROP: Packages = { apt: ['x11-utils'], dnf: ['xprop'], pacman: ['xorg-xprop'], zypper: ['xprop'] }
const TESSERACT: Packages = { apt: ['tesseract-ocr'], dnf: ['tesseract'], pacman: ['tesseract', 'tesseract-data-eng'], zypper: ['tesseract-ocr'] }
const GRIM: Packages = { apt: ['grim', 'imagemagick'], dnf: ['grim', 'ImageMagick'], pacman: ['grim', 'imagemagick'], zypper: ['grim', 'ImageMagick'] }
const GNOME_SCREENSHOT: Packages = { apt: ['gnome-screenshot', 'imagemagick'], dnf: ['gnome-screenshot', 'ImageMagick'], pacman: ['gnome-screenshot', 'imagemagick'], zypper: ['gnome-screenshot', 'ImageMagick'] }
const SPECTACLE: Packages = { apt: ['kde-spectacle', 'imagemagick'], dnf: ['spectacle', 'ImageMagick'], pacman: ['spectacle', 'imagemagick'], zypper: ['spectacle', 'ImageMagick'] }
const ATSPI: Packages = {
  apt: ['python3-gi', 'gir1.2-atspi-2.0', 'at-spi2-core'], dnf: ['python3-gobject', 'at-spi2-core'],
  pacman: ['python-gobject', 'at-spi2-core'], zypper: ['python3-gobject', 'typelib-1_0-Atspi-2_0', 'at-spi2-core'],
}

/**
 * Parse the Linux probe output.
 * @param out - `name=value` lines.
 * @returns the values by name.
 */
export function parseProbe(out: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>()
  for (const line of out.split(/\r?\n/u)) {
    const at = line.indexOf('=')
    if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return values
}

/**
 * The Linux setup report for one session.
 * @param probe - the probe's values.
 * @param env - the session's environment, which tells X11, Wayland and the desktop apart.
 * @param wayland - whether the session is Wayland.
 * @returns every feature with what provides or is missing for it, and the install command.
 */
export function linuxSetup(
  probe: ReadonlyMap<string, string>, env: Readonly<Record<string, string | undefined>>, wayland: boolean,
): SetupReport {
  const has = (name: string): boolean => probe.get(name) === 'yes'
  const desktop = (env['XDG_CURRENT_DESKTOP'] ?? '').toLowerCase()
  const checks: SetupCheck[] = []
  const need = (feature: string, ok: boolean, provider: string, missing: string, packages?: Packages, step?: string): void => {
    if (ok) {
      checks.push({ feature, ok, detail: provider })
      return
    }
    checks.push({ feature, ok, detail: missing, ...packages === undefined ? {} : { packages }, ...step === undefined ? {} : { step } })
  }
  if (wayland) {
    const xwayland = (env['DISPLAY'] ?? '').length > 0
    // Without ydotoold, input goes through xdotool to X11 apps under XWayland, which include the apps the agent starts.
    const xinput = !has('ydotoold') && xwayland && has('xdotool')
    // XWayland started with -enable-ei-portal hands simulated input to the compositor only after the person allows it.
    const permission = xinput && probe.get('eiportal') === 'yes'
      ? '; GNOME passes this input through its remote desktop permission, so the first input of a session shows a prompt the person must allow on screen, and keys and clicks are dropped until they do'
      : ''
    need('Real mouse and keyboard input', (has('ydotool') && has('ydotoold')) || xinput,
      xinput ? `xdotool through XWayland, which reaches X11 apps, including the apps the agent starts${permission}; for every app, ${YDOTOOLD_STEP}` : 'ydotool through the ydotoold service',
      !has('ydotool') ? 'ydotool is missing' : 'the ydotoold service is not running, and xdotool cannot stand in without XWayland',
      has('ydotool') ? same('xdotool') : { apt: ['ydotool', 'xdotool'], dnf: ['ydotool', 'xdotool'], pacman: ['ydotool', 'xdotool'], zypper: ['ydotool', 'xdotool'] },
      YDOTOOLD_STEP)
    // Each compositor family has its own screen capture: grim only works on wlroots compositors such as Sway.
    const gnomeDesktop = desktop.includes('gnome')
    const kdeDesktop = desktop.includes('kde')
    const tool = gnomeDesktop ? 'gnome-screenshot' : kdeDesktop ? 'spectacle' : 'grim'
    const shot = has(tool) && has('convert')
    const windowsOnly = !shot && xwayland && has('import')
    need('Screenshots', shot || windowsOnly,
      shot ? `${tool} and ImageMagick` : `X11 windows only, through XWayland, which include the apps the agent starts; the whole screen needs ${tool}`,
      has(tool) ? 'ImageMagick is missing' : `${tool} is missing`,
      has(tool) ? IMAGEMAGICK : gnomeDesktop ? GNOME_SCREENSHOT : kdeDesktop ? SPECTACLE : GRIM)
    const paste = xinput ? has('xclip') : has('wl-copy')
    need('Long text through the clipboard', paste, xinput ? 'xclip through XWayland' : 'wl-clipboard',
      `${xinput ? 'xclip' : 'wl-clipboard'} is missing; long text is typed instead`, same(xinput ? 'xclip' : 'wl-clipboard'))
    need('Displays', has('wlr-randr') || (env['DISPLAY'] ?? '').length > 0, has('wlr-randr') ? 'wlr-randr' : 'XWayland',
      'neither wlr-randr nor XWayland answers', same('wlr-randr'))
    const sway = (env['SWAYSOCK'] ?? '').length > 0 && has('swaymsg')
    const hypr = (env['HYPRLAND_INSTANCE_SIGNATURE'] ?? '').length > 0 && has('hyprctl')
    const kde = desktop.includes('kde') && has('kdotool')
    const gnome = desktop.includes('gnome') && has('windowcalls')
    const lists = sway ? 'Sway' : hypr ? 'Hyprland' : kde ? 'KWin through kdotool' : gnome ? 'GNOME Shell through the Window Calls extension' : undefined
    need('Listing and moving every window', lists !== undefined, lists ?? '',
      `${desktop.includes('kde') ? 'KDE keeps its windows private without kdotool' : desktop.includes('gnome')
        ? 'GNOME keeps its windows private without the Window Calls extension' : 'this compositor keeps its windows private'}; `
        + 'only X11 apps are listed, which include the apps the agent starts (they open under XWayland)',
      undefined,
      desktop.includes('kde')
        ? 'install kdotool (cargo install kdotool, or the kdotool package where the distribution has one)'
        : desktop.includes('gnome') ? 'install the Window Calls extension from https://extensions.gnome.org/extension/4724/window-calls/ and log in again' : undefined)
  } else {
    need('Real mouse and keyboard input', has('xdotool'), 'xdotool', 'xdotool is missing', same('xdotool'))
    need('Listing and moving windows', has('wmctrl'), 'wmctrl', 'wmctrl is missing', same('wmctrl'))
    need('Displays', has('xrandr'), 'xrandr', 'xrandr is missing', XRANDR)
    need('Screenshots', has('import'), 'ImageMagick', 'ImageMagick is missing', IMAGEMAGICK)
    need('The window under a point (safer drags, reservations)', has('xprop'), 'xprop', 'xprop is missing', XPROP)
    need('Long text through the clipboard', has('xclip'), 'xclip', 'xclip is missing; long text is typed instead', same('xclip'))
  }
  need('Text recognition on screen', has('tesseract'), 'tesseract', 'tesseract is missing', TESSERACT)
  // GTK apps expose AT-SPI either way; the GNOME setting decides whether Qt and older toolkits do.
  const a11yOff = probe.get('a11y') === 'false'
  need('Window text and controls by name', has('atspi'),
    `AT-SPI through Python${a11yOff ? '; Qt apps also need assistive technologies on: gsettings set org.gnome.desktop.interface toolkit-accessibility true, then restart them' : ''}`,
    'Python cannot load AT-SPI', ATSPI)
  need('Opening files, folders and links', has('xdg-open'), 'xdg-open', 'xdg-open is missing', same('xdg-utils'))
  const manager: PackageManager | undefined = has('apt-get') ? 'apt' : has('dnf') ? 'dnf' : has('pacman') ? 'pacman' : has('zypper') ? 'zypper' : undefined
  const missing = checks.filter(check => !check.ok)
  const wanted = manager === undefined ? [] : [...new Set(missing.flatMap(check => check.packages?.[manager] ?? []))]
  const install = wanted.length === 0 || manager === undefined ? undefined : {
    apt: `sudo apt-get install -y ${wanted.join(' ')}`,
    dnf: `sudo dnf install -y ${wanted.join(' ')}`,
    pacman: `sudo pacman -S --needed ${wanted.join(' ')}`,
    zypper: `sudo zypper install -y ${wanted.join(' ')}`,
  }[manager]
  return { checks, install }
}

/** PowerShell that reports, one `name=value` line each, UI Automation, the text recognition languages, elevation and GDI+. */
export const WINDOWS_PROBE = "$o = @(); $o += 'uia=' + [bool]('HackDev.Uia' -as [type]); "
  + 'try { Add-Type -AssemblyName System.Runtime.WindowsRuntime; $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]; '
  + "$o += 'ocr=' + ((@([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) | ForEach-Object { $_.LanguageTag }) -join ',') } catch { $o += 'ocr=' }; "
  + "$o += 'elevated=' + [HackDev.Desk]::SelfElevated(); $o += 'gdi=' + [bool]('System.Drawing.Bitmap' -as [type]); $o -join [char]10"

/**
 * The Windows setup report from the probe's values.
 * @param probe - the probe's values.
 * @returns every feature with what provides or is missing for it.
 */
export function windowsSetup(probe: ReadonlyMap<string, string>): SetupReport {
  const languages = (probe.get('ocr') ?? '').split(',').filter(language => language.length > 0)
  const elevated = probe.get('elevated') === 'True'
  return { checks: [
    { feature: 'Real mouse and keyboard input, windows and displays', ok: true, detail: 'the built-in Windows helper' },
    { feature: 'Screenshots', ok: probe.get('gdi') === 'True', detail: probe.get('gdi') === 'True' ? 'GDI+' : 'System.Drawing could not be loaded' },
    {
      feature: 'Window text and controls by name', ok: probe.get('uia') === 'True',
      detail: probe.get('uia') === 'True' ? 'UI Automation' : 'UI Automation could not be loaded',
    },
    {
      feature: 'Text recognition on screen', ok: languages.length > 0,
      detail: languages.length > 0 ? `Windows text recognition, languages ${languages.join(', ')}` : 'no text recognition language is installed',
      ...languages.length > 0 ? {} : { step: 'add a language with the Optical character recognition feature in Settings > Time & language > Language & region' },
    },
    {
      feature: 'Apps running as administrator', ok: true,
      detail: elevated ? 'this app runs as administrator' : 'reached through a one-time administrator prompt the person approves',
    },
  ] }
}

/**
 * The report as text for the model and the person.
 * @param report - the setup report.
 * @returns one line per feature, then what to do.
 */
export function formatSetup(report: SetupReport): string {
  const lines = report.checks.map(check => `${check.ok ? 'ready' : 'missing'}: ${check.feature} (${check.detail})`)
  const missing = report.checks.filter(check => !check.ok)
  if (missing.length === 0) return `${lines.join('\n')}\nEverything the desktop tools use is available.`
  const steps = missing.flatMap(check => check.step === undefined ? [] : [`- ${check.step}`])
  const unpackaged = report.install === undefined && missing.some(check => check.packages !== undefined)
  return [
    ...lines,
    ...report.install === undefined ? [] : [`Install the missing packages with: ${report.install}`],
    ...unpackaged ? ['No known package manager was found; install the packages named above with the system\'s own one.'] : [],
    ...steps.length > 0 ? ['Then:', ...steps] : [],
  ].join('\n')
}
