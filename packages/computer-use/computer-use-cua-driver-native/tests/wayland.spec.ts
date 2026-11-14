import { describe, expect, it } from 'vitest'
import { linuxBackend } from '../src/displays.ts'
import type { CommandRunner } from '../src/displays.ts'
import { parseKeys } from '../src/keys.ts'
import {
  WAYLAND_PASTE, evdevCodes, isWaylandSession, parseHyprClients, parseSwayTree, parseWlrRandr,
  ydotoolClickCode, ydotoolHoldArgs, ydotoolKeyArgs, ydotoolMoveArgs,
} from '../src/wayland.ts'

const WAYLAND = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }

/** A runner that records every call and answers from a table keyed by the command name. */
function recorder(answers: Record<string, string | Error> = {}) {
  const calls: string[][] = []
  const run: CommandRunner = async (file, args) => {
    calls.push([file, ...args])
    const answer = file === 'sh' && args[0] === '-c' && args[2] === 'sh' && args[3] !== undefined && args[1]?.startsWith('command -v "$1"') === true
      ? answers[`has ${args[3]}`] ?? ''
      : answers[file]
    if (answer instanceof Error) throw answer
    return answer ?? ''
  }
  return { calls, run }
}

describe('Wayland session detection', () => {
  it('reads the session type, a display-less Wayland socket, and the override', () => {
    expect(isWaylandSession(WAYLAND)).toBe(true)
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true)
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' })).toBe(false)
    expect(isWaylandSession({ DISPLAY: ':0' })).toBe(false)
    expect(isWaylandSession({ ...WAYLAND, HACKDEV_DESKTOP_BACKEND: 'x11' })).toBe(false)
    expect(isWaylandSession({ DISPLAY: ':0', HACKDEV_DESKTOP_BACKEND: 'Wayland' })).toBe(true)
  })
})

describe('ydotool arguments', () => {
  it('maps keys to kernel codes and presses chords in order, releasing in reverse', () => {
    expect(evdevCodes('ctrl')).toEqual([29])
    expect(evdevCodes('F1')).toEqual([59])
    expect(evdevCodes('F12')).toEqual([88])
    expect(evdevCodes('F13')).toEqual([183])
    expect(evdevCodes('plus')).toEqual([42, 13])
    expect(() => evdevCodes('XF86Unknown')).toThrow('cannot be sent in a Wayland session')
    const chords = parseKeys('ctrl+shift+t enter').map(chord => chord.x11)
    expect(ydotoolKeyArgs(chords)).toEqual(['key', '29:1', '42:1', '20:1', '20:0', '42:0', '29:0', '28:1', '28:0'])
    expect(ydotoolHoldArgs('shift', true)).toEqual(['key', '42:1'])
    expect(ydotoolHoldArgs('ctrl+alt', false)).toEqual(['key', '56:0', '29:0'])
  })

  it('encodes clicks and absolute moves', () => {
    expect(ydotoolClickCode('left', 'click')).toBe('0xC0')
    expect(ydotoolClickCode('right', 'down')).toBe('0x41')
    expect(ydotoolClickCode('middle', 'up')).toBe('0x82')
    expect(ydotoolMoveArgs(10.4, 20.6)).toEqual(['mousemove', '--absolute', '-x', '10', '-y', '21'])
  })
})

describe('compositor window lists and outputs', () => {
  it('reads Sway views, including scratchpad windows as minimized', () => {
    const tree = JSON.stringify({
      type: 'root', nodes: [
        { type: 'output', name: '__i3', nodes: [{ type: 'workspace', name: '__i3_scratch', floating_nodes: [{ type: 'floating_con', id: 9, pid: 90, name: 'Notes', app_id: 'gedit', rect: { x: 0, y: 0, width: 400, height: 300 } }] }] },
        { type: 'output', name: 'eDP-1', nodes: [{ type: 'workspace', name: '1', nodes: [
          { type: 'con', id: 4, pid: 40, name: 'Terminal', app_id: 'foot', focused: true, visible: true, rect: { x: 0, y: 0, width: 960, height: 1080 } },
          { type: 'con', id: 5, pid: 50, name: 'Firefox', window_properties: { class: 'firefox' }, visible: true, rect: { x: 960, y: 0, width: 960, height: 1080 } },
        ] }] },
      ],
    })
    expect(parseSwayTree(tree)).toEqual([
      { handle: 9, pid: 90, process: 'gedit', title: 'Notes', x: 0, y: 0, width: 400, height: 300, minimized: true, foreground: false },
      { handle: 4, pid: 40, process: 'foot', title: 'Terminal', x: 0, y: 0, width: 960, height: 1080, minimized: false, foreground: true },
      { handle: 5, pid: 50, process: 'firefox', title: 'Firefox', x: 960, y: 0, width: 960, height: 1080, minimized: false, foreground: false },
    ])
  })

  it('reads Hyprland clients and marks the active one', () => {
    const clients = JSON.stringify([
      { address: '0x55d1c0b0a1f0', pid: 7, class: 'kitty', title: 'shell', at: [10, 20], size: [800, 600], mapped: true },
      { address: '0x55d1c0b0a2f0', pid: 8, class: 'code', title: 'editor', at: [0, 0], size: [1920, 1080], hidden: true },
      { address: '0x1', mapped: false },
    ])
    const windows = parseHyprClients(clients, JSON.stringify({ address: '0x55d1c0b0a1f0' }))
    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({ handle: 0x55d1c0b0a1f0, pid: 7, process: 'kitty', foreground: true, minimized: false, x: 10, width: 800 })
    expect(windows[1]).toMatchObject({ foreground: false, minimized: true })
    expect(parseHyprClients(clients, '')[0]?.foreground).toBe(false)
  })

  it('reads wlr-randr outputs in logical pixels', () => {
    const outputs = JSON.stringify([
      { name: 'eDP-1', enabled: true, position: { x: 0, y: 0 }, scale: 2, modes: [{ width: 2880, height: 1800, current: true }] },
      { name: 'DP-1', enabled: true, position: { x: 1440, y: 0 }, transform: '90', modes: [{ width: 1920, height: 1080, current: true }] },
      { name: 'HDMI-1', enabled: false, modes: [] },
    ])
    expect(parseWlrRandr(outputs)).toEqual([
      { name: 'eDP-1', primary: true, x: 0, y: 0, width: 1440, height: 900 },
      { name: 'DP-1', primary: false, x: 1440, y: 0, width: 1080, height: 1920 },
    ])
  })
})

describe('Linux backend in a Wayland session', () => {
  it('sends input through ydotool', async () => {
    const { calls, run } = recorder()
    const backend = linuxBackend(run, WAYLAND)
    await backend.pointer(100, 200, 'left', 2, parseKeys('ctrl')[0])
    await backend.keys(parseKeys('alt+tab'))
    await backend.scroll(5, 6, 3, false)
    await backend.pressButton(undefined, undefined, 'right', true)
    await backend.type('hi', false)
    expect(calls).toEqual([
      ['ydotool', 'key', '29:1'],
      ['ydotool', 'mousemove', '--absolute', '-x', '100', '-y', '200'],
      ['ydotool', 'click', '--repeat', '2', '--next-delay', '60', '0xC0'],
      ['ydotool', 'key', '29:0'],
      ['ydotool', 'key', '56:1', '15:1', '15:0', '56:0'],
      ['ydotool', 'mousemove', '--absolute', '-x', '5', '-y', '6'],
      ['ydotool', 'mousemove', '--wheel', '-x', '0', '-y', '-3'],
      ['ydotool', 'click', '0x41'],
      ['ydotool', 'type', '--key-delay', '12', '--', 'hi'],
    ])
  })

  it('drags in steps and always releases the button', async () => {
    const { calls, run } = recorder()
    await linuxBackend(run, WAYLAND).drag(0, 0, 400, 0, 'left')
    expect(calls[0]).toEqual(['ydotool', 'mousemove', '--absolute', '-x', '0', '-y', '0'])
    expect(calls[1]).toEqual(['ydotool', 'click', '0x40'])
    expect(calls.filter(call => call[1] === 'mousemove')).toHaveLength(1 + 16)
    expect(calls.at(-1)).toEqual(['ydotool', 'click', '0x80'])
  })

  it('pastes long text through wl-clipboard', async () => {
    const { calls, run } = recorder({ sh: 'PASTED\n' })
    await linuxBackend(run, WAYLAND).type('long text', true)
    expect(calls).toEqual([['sh', '-c', WAYLAND_PASTE, 'sh', 'long text']])
  })

  it('lists and manages Sway windows through swaymsg', async () => {
    const tree = JSON.stringify({ type: 'root', nodes: [{ type: 'con', id: 4, pid: 40, name: 'Terminal', app_id: 'foot', focused: true }] })
    const { calls, run } = recorder({ 'has swaymsg': 'yes\n', swaymsg: tree })
    const backend = linuxBackend(run, { ...WAYLAND, SWAYSOCK: '/run/sway.sock' })
    expect((await backend.windows()).map(window => window.title)).toEqual(['Terminal'])
    await backend.window(4, 'close')
    await backend.place?.(4, 10, 20, 300, 200)
    expect(calls.filter(call => call[0] === 'swaymsg').map(call => call.slice(1))).toEqual([
      ['-t', 'get_tree', '--raw'],
      ['[con_id=4] kill'],
      ['[con_id=4] floating enable, move absolute position 10 20, resize set 300 200'],
    ])
  })

  it('lists and manages Hyprland windows through hyprctl', async () => {
    const clients = JSON.stringify([{ address: '0x10', pid: 7, class: 'kitty', title: 'shell', at: [0, 0], size: [10, 10] }])
    const { calls, run } = recorder({ 'has hyprctl': 'yes\n', hyprctl: clients })
    const backend = linuxBackend(run, { ...WAYLAND, HYPRLAND_INSTANCE_SIGNATURE: 'abc' })
    expect((await backend.windows())[0]?.handle).toBe(16)
    await backend.window(16, 'focus')
    expect(calls.at(-1)).toEqual(['hyprctl', 'dispatch', 'focuswindow', 'address:0x10'])
  })

  it('explains what works when the compositor keeps its windows private', async () => {
    const { run } = recorder()
    await expect(linuxBackend(run, WAYLAND).windows()).rejects.toThrow('does not let programs list its windows')
  })

  it('takes screenshots with the compositor tool and names the tools to install when none works', async () => {
    const { calls, run } = recorder({ 'wlr-randr': JSON.stringify([{ name: 'eDP-1', modes: [{ width: 1920, height: 1080, current: true }] }]) })
    const backend = linuxBackend(run, WAYLAND)
    expect(await backend.list()).toEqual([{ index: 0, name: 'eDP-1', primary: true, x: 0, y: 0, width: 1920, height: 1080 }])
    const shot = await backend.capture('/tmp/out.png', undefined, 960)
    expect(shot).toEqual({ width: 960, height: 540, scale: 0.5 })
    const convert = calls.find(call => call[0] === 'convert')
    // The physical capture is first brought to the logical desktop size.
    expect(convert?.slice(2)).toEqual(['-resize', '1920x1080!', '-resize', '960x960>', '/tmp/out.png'])
    const failing = recorder({ 'wlr-randr': JSON.stringify([{ name: 'eDP-1', modes: [{ width: 800, height: 600, current: true }] }]), sh: new Error('exit 3') })
    await expect(linuxBackend(failing.run, WAYLAND).capture('/tmp/x.png', undefined, 1280)).rejects.toThrow('install grim')
  })

  it('names the Wayland helpers when ydotool is missing', async () => {
    const { run } = recorder({ ydotool: new Error('spawn ydotool ENOENT') })
    await expect(linuxBackend(run, WAYLAND).keys(parseKeys('enter'))).rejects.toThrow('ydotoold')
  })
})
