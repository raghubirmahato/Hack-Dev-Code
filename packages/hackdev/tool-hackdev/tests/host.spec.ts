import { describe, expect, it } from 'vitest'
import { describeHost, detectHost, isDebianFamily, liveProbe } from '../src/host.ts'
import type { HostProbe } from '../src/host.ts'

function probe(overrides: Partial<HostProbe>, files: Record<string, string> = {}): HostProbe {
  return {
    platform: 'linux',
    env: {},
    exists: path => Object.hasOwn(files, path.replace(/\\/gu, '/')),
    read: path => files[path],
    release: '6.8.0',
    version: '',
    arch: 'x64',
    cpus: 8,
    totalMemory: 16 * 1024 ** 3,
    home: '/home/dev',
    uid: 1000,
    ...overrides,
  }
}

describe('detectHost', () => {
  it('recognizes Ubuntu as Debian family with apt, a desktop and sudo installs', () => {
    const facts = detectHost(probe({ env: { PATH: '/usr/bin:/bin', DISPLAY: ':0' } }, {
      '/etc/os-release': 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\nID_LIKE=debian\n',
      '/usr/bin/apt-get': '',
      '/usr/bin/snap': '',
    }))
    expect(facts.system).toBe('Ubuntu 24.04.1 LTS')
    expect(isDebianFamily(facts)).toBe(true)
    expect(facts.packageManagers).toEqual(['apt', 'snap'])
    expect(facts.desktop).toBe(true)
    expect(facts.elevated).toBe(false)
    const text = describeHost(facts)
    expect(text).toContain('Ubuntu 24.04.1 LTS, x64, 8 CPUs, 16 GiB memory')
    expect(text).toContain('sudo apt-get install -y')
  })

  it('recognizes Debian run as root without a desktop', () => {
    const facts = detectHost(probe({ env: { PATH: '/usr/bin' }, uid: 0 }, {
      '/etc/os-release': 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\n',
      '/usr/bin/apt-get': '',
    }))
    expect(isDebianFamily(facts)).toBe(true)
    expect(facts.desktop).toBe(false)
    const text = describeHost(facts)
    expect(text).toContain('Running as root')
    expect(text).toContain('apt-get install -y')
    expect(text).not.toContain('sudo apt-get')
    expect(text).toContain('not detected')
  })

  it('treats another distribution as plain Linux', () => {
    const facts = detectHost(probe({ env: { PATH: '/usr/bin' } }, { '/etc/os-release': 'ID=fedora\n', '/usr/bin/dnf': '' }))
    expect(isDebianFamily(facts)).toBe(false)
    expect(facts.packageManagers).toEqual(['dnf'])
    expect(describeHost(facts)).toContain('Use bash syntax')
  })

  it('recognizes Windows, its PowerShell and winget', () => {
    const facts = detectHost(probe({
      platform: 'win32', version: 'Windows 11 Pro', release: '10.0.26300', home: 'C:\\Users\\dev',
      env: { Path: 'C:/Windows/System32;C:/Users/dev/AppData/Local/Microsoft/WindowsApps' },
    }, { 'C:/Users/dev/AppData/Local/Microsoft/WindowsApps/winget.exe': '' }))
    expect(facts.system).toBe('Windows 11 Pro (build 10.0.26300)')
    expect(facts.shell).toBe('Windows PowerShell 5.1')
    expect(facts.packageManagers).toEqual(['winget'])
    expect(facts.elevated).toBeUndefined()
    expect(describeHost(facts)).toContain('Use PowerShell syntax')
  })

  it('describes the machine it runs on', () => {
    const text = describeHost(detectHost(liveProbe()))
    expect(text).toContain('Host machine')
    expect(text).toContain(`${String(liveProbe().cpus)} CPUs`)
  })
})
