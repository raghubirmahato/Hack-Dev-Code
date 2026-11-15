import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { brandString } from '@hackdevcode/dsh-brand'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@hackdevcode/dsh-agent-loop-testkit'
import type { Agent } from '@hackdevcode/dsh-agent'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import type { SessionId } from '@hackdevcode/dsh-session'
import { parseStacking, registerDisplayTools, topWindowAt } from '../src/displays.ts'
import type { DisplayBackend, WindowInfo } from '../src/displays.ts'
import { waitForStable } from '../src/verify.ts'

/** Two apps side by side and a notification over the editor's right edge; records the input it is sent. */
function fakeDesktop(): { backend: DisplayBackend; actions: string[]; windows: WindowInfo[]; state: { text: Record<number, string> } } {
  const actions: string[] = []
  const state = { text: { 1: 'Document: Editor = draft', 2: 'Tree: Files' } as Record<number, string> }
  const windows: WindowInfo[] = [
    { handle: 1, pid: 10, process: 'Editor', title: 'Report - Editor', x: 0, y: 0, width: 800, height: 600, minimized: false, foreground: true },
    { handle: 2, pid: 20, process: 'Files', title: 'Downloads - Files', x: 1000, y: 0, width: 800, height: 600, minimized: false, foreground: false },
    { handle: 3, pid: 30, process: 'Toaster', title: 'Notification', x: 700, y: 250, width: 400, height: 100, minimized: false, foreground: false },
    { handle: 4, pid: 10, process: 'Editor', title: 'Save As', x: 200, y: 200, width: 300, height: 200, minimized: false, foreground: false },
  ]
  const backend: DisplayBackend = {
    list: async () => [{ index: 0, name: 'main', primary: true, x: 0, y: 0, width: 1920, height: 1080 }],
    capture: async () => ({ width: 1, height: 1, scale: 1 }),
    pointer: async (x, y, button, count) => { actions.push(`pointer ${String(x)},${String(y)} ${button} x${String(count)}`) },
    drag: async (x1, y1, x2, y2) => { actions.push(`drag ${String(x1)},${String(y1)} -> ${String(x2)},${String(y2)}`) },
    scroll: async () => { actions.push('scroll') },
    keys: async (chords) => { actions.push(`keys ${chords.map(chord => chord.names.join('+')).join(' ')}`) },
    type: async (text) => { actions.push(`type ${JSON.stringify(text)}`) },
    windows: async () => windows.map(window => ({ ...window })),
    window: async (handle, action) => {
      actions.push(`${action} ${String(handle)}`)
      if (action === 'focus') for (const window of windows) window.foreground = window.handle === handle
    },
    open: async () => {},
    readText: async handle => state.text[handle] ?? '',
    pressButton: async (_x, _y, which, down) => { actions.push(`${down ? 'press' : 'release'} ${which}`) },
    holdKeys: async (chord, down) => { actions.push(`${down ? 'hold' : 'release'} ${chord.names.join('+')}`) },
    place: async () => {},
    launch: async app => `Started ${app}`,
    // The notification is on top of everything it covers; then the windows in list order.
    windowAt: async (x, y) => topWindowAt(windows, [2, 1, 4, 3], x, y),
    close: () => {},
  }
  return { backend, actions, windows, state }
}

let ctx: Context
let first: Agent
let second: Agent

beforeEach(async () => {
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  first = (await ctx.agents.create({ sessionId: brandString<SessionId>('desktop-task-one') })).agent
  second = (await ctx.agents.create({ sessionId: brandString<SessionId>('desktop-task-two') })).agent
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

async function mount(backend: DisplayBackend): Promise<void> {
  await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
}

function call(name: string, args: Record<string, unknown>, agent: Agent = first) {
  return executeToolFixture(ctx, { name, callId: ToolCallId('control-test'), arguments: args, agent, signal: new AbortController().signal })
}

function text(result: Awaited<ReturnType<typeof call>>): string {
  return JSON.stringify(result.content)
}

describe('waiting for the screen to settle', () => {
  it('returns once the text stays the same for the quiet time', async () => {
    let value = 'Loading 1'
    const timers = [setTimeout(() => { value = 'Loading 2' }, 40), setTimeout(() => { value = 'Loaded' }, 120)]
    const started = Date.now()
    await expect(waitForStable(async () => value, 200, 3000, undefined, 20)).resolves.toMatch(/^The window stayed the same for 200 ms/u)
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    for (const timer of timers) clearTimeout(timer)
  })

  it('fails while the window keeps changing, and checks its limits', async () => {
    let tick = 0
    await expect(waitForStable(async () => String(tick++), 200, 500, undefined, 20)).rejects.toThrow('still changing after 500 ms')
    await expect(waitForStable(async () => '', 100, 1000)).rejects.toThrow('quiet_ms must be between 200 and 10000')
    await expect(waitForStable(async () => '', 1000, 100)).rejects.toThrow('timeout_ms must be between 500 and 60000')
  })

  it('waits through desktop_window and a sequence step', async () => {
    const { backend, state } = fakeDesktop()
    const timer = setTimeout(() => { state.text[1] = 'Document: Editor = final' }, 100)
    await mount(backend)
    const result = await call('desktop_window', { action: 'wait', stable: true, title: 'Report', quiet_ms: 300, timeout_ms: 3000 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('The window stayed the same for 300 ms')
    const step = await call('desktop_sequence', { steps: [{ action: 'wait', stable: true, title: 'Report', quiet_ms: 200, timeout_ms: 2000 }] })
    expect(text(step)).toContain('1. The window stayed the same for 200 ms')
    expect(text(await call('desktop_window', { action: 'wait', stable: true, text: 'final' }))).toContain('pass text or gone in a separate wait')
    clearTimeout(timer)
  })
})

describe('several tasks at once', () => {
  it('keeps each task\'s focus and typing together, so text never lands in another task\'s window', async () => {
    const { backend, windows } = fakeDesktop()
    const landed: string[] = []
    const slow = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 40))
    // Focus and typing both take time, as they do on a real desktop; text goes to the window in front.
    backend.window = async (handle, action) => {
      await slow()
      if (action === 'focus') for (const window of windows) window.foreground = window.handle === handle
    }
    backend.type = async (text) => {
      await slow()
      landed.push(`${text} -> ${String(windows.find(window => window.foreground)?.handle)}`)
    }
    await mount(backend)
    await Promise.all([
      call('desktop_type', { text: 'report text', title: 'Report' }, first),
      call('desktop_type', { text: 'file name', title: 'Downloads' }, second),
      call('desktop_type', { text: 'more report text', title: 'Report' }, first),
    ])
    expect(landed.toSorted()).toEqual(['file name -> 2', 'more report text -> 1', 'report text -> 1'])
  })

  it('waits until a window really is in front before typing, and sends nothing when it never comes', async () => {
    const { backend, windows } = fakeDesktop()
    const landed: string[] = []
    let focusable = true
    // Like a real window manager: the focus change lands a moment after it is asked for, or not at all.
    backend.window = async (handle, action) => {
      if (action === 'focus' && focusable) setTimeout(() => { for (const window of windows) window.foreground = window.handle === handle }, 300)
    }
    backend.type = async (text) => { landed.push(`${text} -> ${String(windows.find(window => window.foreground)?.handle)}`) }
    await mount(backend)
    expect((await call('desktop_type', { text: 'late focus', title: 'Downloads' }, second)).isError).toBe(false)
    expect(landed).toEqual(['late focus -> 2'])
    focusable = false
    const refused = await call('desktop_type', { text: 'never', title: 'Report' })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('\\"Report - Editor\\" did not come to the front within 2000 ms; handle 2 pid 20 Files')
    expect(text(refused)).toContain('stayed in front, so nothing was sent')
    expect(landed).toEqual(['late focus -> 2'])
  })

  it('lets a cancelled wait for the turn go without unblocking the actions queued behind it', async () => {
    const { backend } = fakeDesktop()
    let typing = 0
    let most = 0
    backend.type = async () => {
      typing++
      most = Math.max(most, typing)
      await new Promise(resolve => setTimeout(resolve, 60))
      typing--
    }
    await mount(backend)
    const cancelled = new AbortController()
    const calls = [
      call('desktop_type', { text: 'one' }),
      executeToolFixture(ctx, { name: 'desktop_type', callId: ToolCallId('cancelled'), arguments: { text: 'two' }, agent: first, signal: cancelled.signal }),
      call('desktop_type', { text: 'three' }),
    ]
    cancelled.abort()
    const results = await Promise.all(calls)
    expect(results.map(result => result.isError)).toEqual([false, true, false])
    expect(most).toBe(1)
  })
})

describe('starting an app', () => {
  it('reports the main window that follows a first prompt, and names a prompt that stays', async () => {
    const { backend, windows } = fakeDesktop()
    // Like Mousepad after a crash: a small restore prompt first, the editor a moment later.
    backend.launch = async (app) => {
      setTimeout(() => { windows.push({ handle: 9, pid: 90, process: 'mousepad', title: 'Mousepad', x: 600, y: 300, width: 570, height: 177, minimized: false, foreground: true }) }, 50)
      setTimeout(() => { windows.push({ handle: 10, pid: 90, process: 'mousepad', title: 'Untitled 1 - Mousepad', x: 25, y: 92, width: 700, height: 518, minimized: false, foreground: false }) }, 500)
      return `Started ${app}`
    }
    await mount(backend)
    const opened = text(await call('desktop_open', { app: 'mousepad' }))
    expect(opened).toContain('New window: handle 10 pid 90 mousepad \\"Untitled 1 - Mousepad\\"')
    expect(opened).toContain('It also opened handle 9 pid 90 mousepad \\"Mousepad\\" 570x177')
    expect(opened).toContain('a prompt there may need an answer first')
  })

  it('does not count another app started at the same moment as this one\'s prompt', async () => {
    const { backend, windows } = fakeDesktop()
    backend.launch = async (app) => {
      setTimeout(() => {
        windows.push({ handle: 11, pid: 110, process: 'mousepad', title: 'Untitled 1 - Mousepad', x: 0, y: 0, width: 700, height: 518, minimized: false, foreground: false })
        windows.push({ handle: 12, pid: 120, process: 'gnome-calculator', title: 'Calculator', x: 0, y: 0, width: 410, height: 666, minimized: false, foreground: true })
      }, 50)
      return `Started ${app}`
    }
    await mount(backend)
    const opened = text(await call('desktop_open', { app: 'gnome-calculator' }))
    expect(opened).toContain('New window: handle 12 pid 120 gnome-calculator \\"Calculator\\"')
    expect(opened).not.toContain('also opened')
  })
})

describe('moving a window', () => {
  it('says where the window manager put a window that did not land where it was asked', async () => {
    const { backend } = fakeDesktop()
    await mount(backend)
    // The fake window manager leaves windows where they are, like a top bar or work area pushing them back.
    expect(text(await call('desktop_window', { action: 'move', handle: 2, x: 1000, y: 0 }))).not.toContain('placed it')
    expect(text(await call('desktop_window', { action: 'move', handle: 2, x: 50, y: 60 })))
      .toContain('The window manager placed it at (1000, 0) instead of (50, 60), for example below a top bar; use the position above.')
  })
})

describe('window under a point', () => {
  it('reads the X11 stacking order and picks the topmost window containing the point', () => {
    expect(parseStacking('_NET_CLIENT_LIST_STACKING: window id # 0x1e00003, 0x2200007\n')).toEqual([0x1e00003, 0x2200007])
    expect(parseStacking('_NET_CLIENT_LIST_STACKING:  no such atom on any window.')).toEqual([])
    const { windows } = fakeDesktop()
    expect(topWindowAt(windows, [2, 1, 4, 3], 750, 300)).toBe(3)
    expect(topWindowAt(windows, [2, 1, 4, 3], 300, 250)).toBe(4)
    expect(topWindowAt(windows, [2, 1, 4, 3], 100, 100)).toBe(1)
    expect(topWindowAt(windows, [2, 1, 4, 3], 1900, 1000)).toBe(0)
  })
})

describe('safer drags', () => {
  it('names the windows under both ends and mentions an overlay the pointer passes over', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_drag', { from_x: 100, from_y: 300, to_x: 1300, to_y: 300 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('from \\"Report - Editor\\" (Editor) onto \\"Downloads - Files\\" (Files); on the way it passed over \\"Notification\\" (Toaster)')
    expect(actions).toEqual(['drag 100,300 -> 1300,300'])
  })

  it('refuses before pressing anything when onto is not under the drop point', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_drag', { from_x: 100, from_y: 100, to_x: 750, to_y: 300, onto: 'Files' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('the drop point (750, 300) is over \\"Notification\\" (Toaster), not \\"Files\\"')
    expect(text(result)).toContain('Nothing was dragged.')
    expect(text(result)).not.toContain('Released')
    expect(actions).toEqual([])
    const fine = await call('desktop_sequence', { steps: [{ action: 'drag', x: 100, y: 100, to_x: 1300, to_y: 100, onto: 'downloads' }] })
    expect(text(fine)).toContain('onto \\"Downloads - Files\\" (Files)')
  })

  it('cannot check onto where the platform does not say which window is on top', async () => {
    const { backend, actions } = fakeDesktop()
    delete backend.windowAt
    await mount(backend)
    expect(text(await call('desktop_drag', { from_x: 1, from_y: 1, to_x: 5, to_y: 5, onto: 'Files' }))).toContain('onto cannot be checked')
    expect(text(await call('desktop_drag', { from_x: 1, from_y: 1, to_x: 5, to_y: 5 }))).toContain('Dragged with left from (1, 1) to (5, 5)')
    expect(actions).toEqual(['drag 1,1 -> 5,5'])
  })
})

describe('window reservations', () => {
  it('keeps one task\'s input inside its reserved app and lets its dialogs through', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    expect(text(await call('desktop_window', { action: 'reserve', title: 'Report' }))).toContain('Reserved handle 1 pid 10 Editor')
    // The editor is in front: typing goes there.
    expect((await call('desktop_type', { text: 'hello' })).isError).toBe(false)
    // A click over the Save As dialog of the same app is fine; one over the notification is not.
    expect((await call('desktop_pointer', { x: 300, y: 250 })).isError).toBe(false)
    const stray = await call('desktop_pointer', { x: 750, y: 300 })
    expect(stray.isError).toBe(true)
    expect(text(stray)).toContain('this task reserved \\"Report - Editor\\" (handle 1), but the input would go to handle 3 pid 30 Toaster')
    expect(text(stray)).toContain('Nothing was sent')
    expect(actions).toEqual(['type "hello"', 'pointer 300,250 left x1'])
  })

  it('refuses input from the task that does not hold the window, until it is released', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    await call('desktop_window', { action: 'reserve', handle: 1, seconds: 30 }, first)
    const blocked = await call('desktop_keys', { keys: 'ctrl+a' }, second)
    expect(blocked.isError).toBe(true)
    expect(text(blocked)).toMatch(/handle 1 pid 10 Editor .* is reserved by another task for \d+ more seconds/u)
    expect(text(await call('desktop_window', { action: 'reserve', handle: 1 }, second))).toContain('already reserved by another task')
    expect(text(await call('desktop_window', { action: 'close', handle: 1 }, second))).toContain('reserved by another task')
    // The other task may still work in other windows.
    expect((await call('desktop_pointer', { x: 1300, y: 100 }, second)).isError).toBe(false)
    expect(text(await call('desktop_window', { action: 'release' }, first))).toContain('Released \\"Report - Editor\\"')
    expect((await call('desktop_keys', { keys: 'ctrl+a' }, second)).isError).toBe(false)
    expect(actions).toEqual(['pointer 1300,100 left x1', 'keys ctrl+a'])
  })

  it('reserves and releases inside a sequence and stops a step aimed elsewhere', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_sequence', { steps: [
      { action: 'reserve', title: 'Report' },
      { action: 'type', text: 'one' },
      { action: 'click', x: 1300, y: 100 },
      { action: 'type', text: 'never' },
    ] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('step 3 (click) failed: this task reserved')
    expect(actions).toEqual(['type "one"'])
    const done = await call('desktop_sequence', { steps: [{ action: 'release' }, { action: 'click', x: 1300, y: 100 }] })
    expect(text(done)).toContain('1. Released')
    expect(actions).toEqual(['type "one"', 'pointer 1300,100 left x1'])
  })

  it('checks the lease limits', async () => {
    const { backend } = fakeDesktop()
    await mount(backend)
    expect(text(await call('desktop_window', { action: 'reserve', handle: 1, seconds: 5 }))).toContain('seconds must be between 10 and 600')
    expect(text(await call('desktop_window', { action: 'release' }))).toContain('This task holds no matching reservation.')
  })
})
