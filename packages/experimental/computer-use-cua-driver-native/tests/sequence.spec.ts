import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import { registerDisplayTools } from '../src/displays.ts'
import type { DisplayBackend, WindowInfo } from '../src/displays.ts'

/** A one-pixel PNG. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/** A desktop that records every action and opens a window shortly after it is asked to. */
function fakeDesktop(): { backend: DisplayBackend; actions: string[] } {
  const actions: string[] = []
  const windows: WindowInfo[] = [{ handle: 1, pid: 1, process: 'explorer', title: 'Desktop', x: 0, y: 0, width: 1920, height: 1080, minimized: false, foreground: true }]
  const front = (handle: number): void => { for (const window of windows) window.foreground = window.handle === handle }
  const backend: DisplayBackend = {
    list: async () => [{ index: 0, name: 'main', primary: true, x: 0, y: 0, width: 1920, height: 1080 }],
    capture: async (path, area, maxDimension) => {
      actions.push(`capture ${area === undefined ? 'all' : `${String(area.x)},${String(area.y)} ${String(area.width)}x${String(area.height)}`} max ${String(maxDimension)}`)
      await writeFile(path, PIXEL)
      return { width: 1, height: 1, scale: 0.5 }
    },
    pointer: async (x, y, button, count) => { actions.push(`pointer ${String(x)},${String(y)} ${button} x${String(count)}`) },
    drag: async () => { actions.push('drag') },
    scroll: async () => { actions.push('scroll') },
    keys: async (chords) => {
      actions.push(`keys ${chords.map(chord => chord.names.join('+')).join(' ')}`)
      if (chords[0]?.names.join('+') === 'win+r') {
        setTimeout(() => { windows.push({ handle: 2, pid: 2, process: 'explorer', title: 'Run', x: 0, y: 0, width: 400, height: 200, minimized: false, foreground: false }); front(2) }, 30)
      }
    },
    type: async (text) => {
      actions.push(`type ${JSON.stringify(text)}`)
      if (text === 'notepad\n') setTimeout(() => { windows.push({ handle: 3, pid: 3, process: 'Notepad', title: 'Untitled - Notepad', x: 0, y: 0, width: 800, height: 600, minimized: false, foreground: false }); front(3) }, 30)
    },
    windows: async () => windows.map(window => ({ ...window })),
    window: async (handle, action) => { actions.push(`${action} ${String(handle)}`); if (action === 'focus') front(handle) },
    open: async (target) => { actions.push(`open ${target}`) },
    readText: async handle => handle === 3 ? 'Document: Text editor = hello\n' : '',
    pressButton: async (x, y, which, down) => { actions.push(`${down ? 'press' : 'release'} ${which} ${String(x)},${String(y)}`) },
    holdKeys: async (chord, down) => { actions.push(`${down ? 'hold' : 'release'} ${chord.names.join('+')}`) },
    place: async (handle, x, y, width, height) => { actions.push(`place ${String(handle)} ${String(x)},${String(y)} ${String(width)}x${String(height)}`) },
    launch: async (app) => {
      actions.push(`launch ${app}`)
      setTimeout(() => { windows.push({ handle: 4, pid: 4, process: 'CalculatorApp', title: 'Calculator', x: 0, y: 0, width: 400, height: 600, minimized: false, foreground: false }); front(4) }, 30)
      return `Started ${app} from the Start menu`
    },
    close: () => {},
  }
  return { backend, actions }
}

let ctx: Context

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

function call(name: string, args: Record<string, unknown>) {
  return executeToolFixture(ctx, { name, callId: ToolCallId('desktop-test'), arguments: args, signal: new AbortController().signal })
}

function run(steps: unknown[]) {
  return call('desktop_sequence', { steps })
}

function text(result: Awaited<ReturnType<typeof run>>): string {
  return JSON.stringify(result.content)
}

describe('desktop_sequence', () => {
  it('runs a predictable flow in one call and reports each step and the window in front', async () => {
    const { backend, actions } = fakeDesktop()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    const result = await run([
      { action: 'keys', keys: 'win+r' },
      { action: 'wait', title: 'Run', timeout_ms: 2000 },
      { action: 'type', text: 'notepad\n', title: 'Run' },
      { action: 'wait', title: 'Notepad', timeout_ms: 2000 },
      { action: 'type', text: 'hello', title: 'Notepad' },
      { action: 'click', x: 100, y: 200, count: 2 },
      { action: 'read', title: 'Notepad' },
    ])
    expect(result.isError).toBe(false)
    expect(actions).toEqual(['keys win+r', 'focus 2', 'type "notepad\\n"', 'focus 3', 'type "hello"', 'pointer 100,200 left x2'])
    expect(text(result)).toContain('5. typed 5 characters into handle 3 pid 3 Notepad')
    expect(text(result)).toContain('7. text of \\"Untitled - Notepad\\":\\nDocument: Text editor = hello')
    expect(text(result)).toContain('Foreground now: handle 3 pid 3 Notepad')
  })

  it('stops at the first failing step and lists what already happened', async () => {
    const { backend, actions } = fakeDesktop()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    const result = await run([
      { action: 'open', target: 'ms-settings:display' },
      { action: 'keys', keys: 'ctrl+hyper' },
      { action: 'type', text: 'never' },
    ])
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('step 2 (keys) failed: unknown key \\"hyper\\"')
    expect(text(result)).toContain('1. opened ms-settings:display')
    expect(actions).toEqual(['open ms-settings:display'])
  })

  it('launches an app by name, moves its window and waits for text in one call', async () => {
    const { backend, actions } = fakeDesktop()
    backend.readText = async handle => handle === 4 ? 'Text: Display is 12\n' : ''
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    const result = await run([
      { action: 'launch', app: 'Calculator' },
      { action: 'move', title: 'Calculator', x: 10, y: 20 },
      { action: 'wait', title: 'Calculator', text: 'display is 12', timeout_ms: 1000 },
      { action: 'element', element_action: 'click', name: 'Seven' },
    ])
    expect(actions.slice(0, 2)).toEqual(['launch Calculator', 'place 4 10,20 400x600'])
    expect(text(result)).toContain('1. Started Calculator from the Start menu. New window: handle 4')
    expect(text(result)).toContain('3. Found the text')
    // This desktop has no control access, so the element step explains what to use instead.
    expect(text(result)).toContain('step 4 (element) failed: controls are not available on this platform')
  })

  it('rejects empty, oversized and unknown sequences', async () => {
    const { backend } = fakeDesktop()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    expect(text(await run([]))).toContain('steps is empty')
    expect(text(await run(Array.from({ length: 31 }, () => ({ action: 'sleep', ms: 50 }))))).toContain('at most 30 steps')
    expect(text(await run([{ action: 'teleport' }]))).toContain('unknown action \\"teleport\\"')
  })
})

describe('holding buttons and keys', () => {
  it('presses and releases a button and a chord across calls, and releases what is left on unload', async () => {
    const { backend, actions } = fakeDesktop()
    const fork = await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    expect(text(await call('desktop_keys', { keys: 'shift', hold: 'down' }))).toContain('Holding shift down')
    expect(text(await call('desktop_pointer', { x: 10, y: 20, press: 'down' }))).toContain('holding the left button')
    expect(text(await call('desktop_pointer', { x: 30, y: 40, press: 'up' }))).toContain('Released the left button')
    expect(text(await call('desktop_pointer', { x: 30, y: 40, press: 'sideways' }))).toContain('press must be down or up')
    expect(text(await call('desktop_keys', { keys: 'ctrl shift', hold: 'down' }))).toContain('hold takes one chord')
    expect(actions).toEqual(['hold shift', 'press left 10,20', 'release left 30,40'])
    await fork.dispose()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(actions.at(-1)).toBe('release shift')
  })
})

describe('reading and seeing windows', () => {
  it('reads the text of a window by title', async () => {
    const { backend } = fakeDesktop()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    await run([{ action: 'keys', keys: 'win+r' }, { action: 'wait', title: 'Run' }, { action: 'type', text: 'notepad\n' }, { action: 'wait', title: 'Notepad' }])
    const result = await call('desktop_window', { action: 'read', title: 'Notepad' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Text of handle 3 pid 3 Notepad')
    expect(text(result)).toContain('Document: Text editor = hello')
  })

  it('captures one window and returns the image with its coordinate mapping', async () => {
    const { backend, actions } = fakeDesktop()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    const result = await call('desktop_screenshot', { title: 'Desktop', max_dimension: 800 })
    expect(result.isError).toBe(false)
    expect(actions).toEqual(['capture 0,0 1920x1080 max 800'])
    expect(text(result)).toContain('desktop x = 0 + image x / 0.5000')
    const raw = JSON.stringify(result)
    expect(raw).toContain('image/png')
  })
})
