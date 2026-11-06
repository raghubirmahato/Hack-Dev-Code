import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { linuxBackend, parseXrandr, windowsBackend } from '../src/displays.ts'
import type { CommandRunner } from '../src/displays.ts'

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
    await backend.capture('/tmp/s.png', second)
    await backend.pointer(2000, 100, 'left', 2)
    expect(calls.slice(1)).toEqual([
      ['import', '-window', 'root', '-crop', '2560x1440+1920+0', '/tmp/s.png'],
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
    const two: CommandRunner = async () => JSON.stringify([
      { name: '\\\\.\\DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080 },
      { name: '\\\\.\\DISPLAY2', primary: false, x: -1280, y: 0, width: 1280, height: 1024 },
    ])
    expect((await windowsBackend(two).list()).map(d => [d.index, d.x, d.primary])).toEqual([[0, 0, true], [1, -1280, false]])
    const one: CommandRunner = async () => JSON.stringify({ name: '\\\\.\\DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080 })
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
      await backend.capture(path)
      expect(existsSync(path) && statSync(path).size > 1000).toBe(true)
      const first = displays[0]!
      await backend.pointer(first.x + 5, first.y + 5, 'none', 1)
    } finally {
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
    expect(provider.Config({})).toEqual({ toolset: 'essential', onDemand: true })
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
