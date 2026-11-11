/**
 * The machine Hack Dev Code runs on, detected once at launch and told to every agent, so commands, paths and
 * package managers fit Windows, Debian/Ubuntu or another system without the agent guessing.
 * @module @hackdevcode/dsh-tool-hackdev/host
 */

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { posix, win32 } from 'node:path'

/** Facts about the host operating system and the tools on it. */
export interface HostFacts {
  /** Node platform name: `win32`, `linux`, `darwin` and so on. */
  platform: NodeJS.Platform
  /** Human-readable system name, such as `Windows 11 Pro` or `Ubuntu 24.04.1 LTS`. */
  system: string
  /** Distribution id and its family on Linux, such as `ubuntu` and `debian`. */
  distro?: { id: string; like: string[] }
  /** CPU architecture, such as `x64` or `arm64`. */
  arch: string
  /** Logical CPU count. */
  cpus: number
  /** Total memory in GiB, rounded to one decimal. */
  memoryGiB: number
  /** Shell the command tool runs. */
  shell: string
  /** Package managers found on the PATH, in preference order. */
  packageManagers: string[]
  /** Whether a graphical desktop is available for desktop control. */
  desktop: boolean
  /** Whether the process runs as root; unknown on Windows. */
  elevated?: boolean
  /** Home directory of the current user. */
  home: string
}

/** Filesystem and environment reads, replaceable in tests. */
export interface HostProbe {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  exists: (path: string) => boolean
  read: (path: string) => string | undefined
  release: string
  version: string
  arch: string
  cpus: number
  totalMemory: number
  home: string
  uid: number | undefined
}

/** Read the live host. */
export function liveProbe(): HostProbe {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    read: (path) => {
      try { return readFileSync(path, 'utf8') } catch { return undefined }
    },
    release: os.release(),
    version: os.version(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    home: os.homedir(),
    uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
  }
}

/** Parse `/etc/os-release` key=value lines. */
function osRelease(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split(/\r?\n/u)) {
    const [, key, value] = /^([A-Z_]+)=(.*)$/u.exec(line.trim()) ?? []
    if (key === undefined || value === undefined) continue
    fields[key] = value.replace(/^["']|["']$/gu, '')
  }
  return fields
}

/** Whether an executable is on the PATH. */
function onPath(probe: HostProbe, names: string[]): boolean {
  // The probed platform decides the PATH separator and path style, not the platform this code runs on.
  const path = probe.platform === 'win32' ? win32 : posix
  const dirs = (probe.env['PATH'] ?? probe.env['Path'] ?? '').split(path.delimiter).filter(dir => dir.length > 0)
  return dirs.some(dir => names.some(name => probe.exists(path.join(dir, name))))
}

/** Names of the package managers whose executable is on the PATH, in the given order. */
function installed(probe: HostProbe, candidates: readonly (readonly [name: string, file: string])[]): string[] {
  return candidates.filter(([, file]) => onPath(probe, [file])).map(([name]) => name)
}

/**
 * Detect the host once.
 * @param probe - the reads to use; the live machine by default.
 * @returns the facts agents are told.
 */
export function detectHost(probe: HostProbe = liveProbe()): HostFacts {
  const common = {
    platform: probe.platform,
    arch: probe.arch,
    cpus: probe.cpus,
    memoryGiB: Math.round(probe.totalMemory / 1024 ** 3 * 10) / 10,
    home: probe.home,
  }
  if (probe.platform === 'win32') {
    const managers = installed(probe, [['winget', 'winget.exe'], ['choco', 'choco.exe'], ['scoop', 'scoop.cmd']])
    const pwsh7 = onPath(probe, ['pwsh.exe'])
    return {
      ...common,
      system: probe.version.length > 0 ? `${probe.version} (build ${probe.release})` : `Windows ${probe.release}`,
      shell: pwsh7 ? 'PowerShell 7 (pwsh)' : 'Windows PowerShell 5.1',
      packageManagers: managers,
      desktop: true,
    }
  }
  if (probe.platform === 'linux') {
    const fields = osRelease(probe.read('/etc/os-release') ?? probe.read('/usr/lib/os-release') ?? '')
    const id = (fields['ID'] ?? 'linux').toLowerCase()
    const like = (fields['ID_LIKE'] ?? '').toLowerCase().split(/\s+/u).filter(part => part.length > 0)
    const managers = installed(probe, [
      ['apt', 'apt-get'], ['dnf', 'dnf'], ['yum', 'yum'], ['pacman', 'pacman'], ['zypper', 'zypper'], ['apk', 'apk'], ['snap', 'snap'], ['flatpak', 'flatpak'],
    ])
    return {
      ...common,
      system: fields['PRETTY_NAME'] ?? `Linux ${probe.release}`,
      distro: { id, like },
      shell: 'bash',
      packageManagers: managers,
      desktop: (probe.env['DISPLAY'] ?? '').length > 0 || (probe.env['WAYLAND_DISPLAY'] ?? '').length > 0,
      elevated: probe.uid === 0,
    }
  }
  return {
    ...common,
    system: probe.platform === 'darwin' ? `macOS (Darwin ${probe.release})` : `${probe.platform} ${probe.release}`,
    shell: 'bash',
    packageManagers: onPath(probe, ['brew']) ? ['brew'] : [],
    desktop: probe.platform === 'darwin',
    elevated: probe.uid === 0,
  }
}

/** Whether a Linux distribution belongs to the Debian family (Debian, Ubuntu, Mint, Pop!_OS and others). */
export function isDebianFamily(facts: HostFacts): boolean {
  return facts.distro !== undefined && (facts.distro.id === 'debian' || facts.distro.like.includes('debian') || facts.distro.like.includes('ubuntu'))
}

/**
 * Render the facts as model guidance.
 * @param facts - detected host facts.
 * @returns the system prompt section text.
 */
export function describeHost(facts: HostFacts): string {
  const lines = [
    'Host machine (detected when Hack Dev Code started):',
    `- System: ${facts.system}, ${facts.arch}, ${String(facts.cpus)} CPUs, ${String(facts.memoryGiB)} GiB memory.`,
    `- Command shell: ${facts.shell}. Home directory: ${facts.home}.`,
    `- Package managers: ${facts.packageManagers.length === 0 ? 'none found on PATH' : facts.packageManagers.join(', ')}.`,
    `- Graphical desktop: ${facts.desktop ? 'available' : 'not detected (no DISPLAY or WAYLAND_DISPLAY)'}.`
      + (facts.elevated === undefined ? '' : ` Running as ${facts.elevated ? 'root' : 'a regular user'}.`),
  ]
  if (facts.platform === 'win32') {
    lines.push('- Use PowerShell syntax and Windows paths (C:\\...). Prefer winget for installs when available; quote paths that contain spaces.')
  } else if (isDebianFamily(facts)) {
    lines.push(`- Debian family: install system packages with ${facts.elevated === true ? '' : 'sudo '}apt-get install -y <package> (run apt-get update first when a package is missing); use bash syntax and POSIX paths.`)
  } else if (facts.platform === 'linux') {
    lines.push('- Use bash syntax and POSIX paths; install packages with the package manager listed above.')
  }
  return lines.join('\n')
}
