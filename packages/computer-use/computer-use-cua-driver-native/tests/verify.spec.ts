import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import { registerDisplayTools } from '../src/displays.ts'
import type { DisplayBackend, WindowInfo } from '../src/displays.ts'
import { checkedExpectation, describeExpectation, waitForChange } from '../src/verify.ts'

/** One editor window whose text the test changes, and a backend that records every input it is sent. */
function fakeDesktop(): { backend: DisplayBackend; actions: string[]; state: { text: string; onPointer: (() => void) | undefined } } {
  const actions: string[] = []
  const state: { text: string; onPointer: (() => void) | undefined } = { text: 'Document: Editor = draft', onPointer: undefined }
  const windows: WindowInfo[] = [{ handle: 7, pid: 7, process: 'Editor', title: 'Report - Editor', x: 0, y: 0, width: 800, height: 600, minimized: false, foreground: true }]
  const backend: DisplayBackend = {
    list: async () => [{ index: 0, name: 'main', primary: true, x: 0, y: 0, width: 1920, height: 1080 }],
    capture: async () => ({ width: 1, height: 1, scale: 1 }),
    pointer: async (x, y, button, count) => {
      actions.push(`pointer ${String(x)},${String(y)} ${button} x${String(count)}`)
      state.onPointer?.()
    },
    drag: async () => { actions.push('drag') },
    scroll: async () => { actions.push('scroll') },
    keys: async (chords) => {
      actions.push(`keys ${chords.map(chord => chord.names.join('+')).join(' ')}`)
      if (chords[0]?.names.join('+') === 'ctrl+o') setTimeout(() => { windows.push({ ...windows[0] as WindowInfo, handle: 8, title: 'Open', foreground: false }) }, 30)
    },
    type: async (text) => { actions.push(`type ${JSON.stringify(text)}`) },
    windows: async () => windows.map(window => ({ ...window })),
    window: async (handle, action) => { actions.push(`${action} ${String(handle)}`) },
    open: async (target) => { actions.push(`open ${target}`) },
    readText: async () => state.text,
    pressButton: async (_x, _y, which, down) => { actions.push(`${down ? 'press' : 'release'} ${which}`) },
    holdKeys: async (chord, down) => { actions.push(`${down ? 'hold' : 'release'} ${chord.names.join('+')}`) },
    place: async () => {},
    launch: async app => `Started ${app}`,
    close: () => {},
  }
  return { backend, actions, state }
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

async function mount(backend: DisplayBackend): Promise<void> {
  await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
}

function call(name: string, args: Record<string, unknown>) {
  return executeToolFixture(ctx, { name, callId: ToolCallId('verify-test'), arguments: args, signal: new AbortController().signal })
}

function text(result: Awaited<ReturnType<typeof call>>): string {
  return JSON.stringify(result.content)
}

describe('expectation validation', () => {
  it('needs exactly one outcome and bounded timeouts and retries', () => {
    expect(checkedExpectation(undefined, true)).toBeUndefined()
    expect(() => checkedExpectation({}, true)).toThrow('exactly one of text, window_title or changed')
    expect(() => checkedExpectation({ text: 'Saved', changed: true }, true)).toThrow('exactly one')
    expect(() => checkedExpectation({ text: '   ' }, true)).toThrow('exactly one')
    expect(() => checkedExpectation({ text: 'Saved', timeout_ms: 100 }, true)).toThrow('between 500 and 60000')
    expect(() => checkedExpectation({ text: 'Saved', retries: 4 }, true)).toThrow('0 to 3')
    expect(() => checkedExpectation({ text: 'Saved', retries: 1.5 }, true)).toThrow('0 to 3')
    expect(() => checkedExpectation({ changed: true, gone: true }, true)).toThrow('gone applies to text and window_title')
    expect(() => checkedExpectation({ window_title: 'Open', in: 'Editor' }, true)).toThrow('in applies to text and changed')
    expect(checkedExpectation({ text: ' Saved ', in: 'Report', retries: 2 }, true)).toEqual({ kind: 'text', text: 'Saved', gone: false, in: 'Report', timeoutMs: 5000, retries: 2 })
  })

  it('refuses repeats for actions that are not safe to repeat but still checks them once', () => {
    expect(() => checkedExpectation({ text: 'hello', retries: 1 }, 'typing again would enter the text a second time'))
      .toThrow('expect.retries is not available here: typing again would enter the text a second time')
    expect(checkedExpectation({ text: 'hello' }, 'typing again would enter the text a second time')?.retries).toBe(0)
  })

  it('describes each outcome for the result', () => {
    expect(describeExpectation({ kind: 'text', text: 'Saved', gone: false, timeoutMs: 500, retries: 0 })).toBe('"Saved" shown')
    expect(describeExpectation({ kind: 'window', title: 'Save As', gone: true, timeoutMs: 500, retries: 0 })).toBe('a window titled "Save As" closed')
    expect(describeExpectation({ kind: 'changed', in: 'Report', timeoutMs: 500, retries: 0 })).toBe('the text of "Report" changed')
  })

  it('waits for a change, ignoring reflowed white space', async () => {
    let value = 'a  b'
    setTimeout(() => { value = 'a b' }, 20)
    setTimeout(() => { value = 'a b c' }, 60)
    await expect(waitForChange(async () => value, 'a b', 2000, undefined, 10)).resolves.toMatch(/^The window text changed after \d+ ms\.$/u)
    await expect(waitForChange(async () => 'same', 'same', 30, undefined, 10)).rejects.toThrow('did not change within 30 ms')
  })
})

describe('verified desktop actions', () => {
  it('waits for the expected text after a click and reports it verified', async () => {
    const { backend, actions, state } = fakeDesktop()
    state.onPointer = () => { setTimeout(() => { state.text = 'Document: Editor = draft\nText: Saved' }, 50) }
    await mount(backend)
    const result = await call('desktop_pointer', { x: 10, y: 20, expect: { text: 'saved', timeout_ms: 2000 } })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('left click x1 at (10, 20)')
    expect(text(result)).toContain('Verified: Found the text \\"saved\\"')
    expect(actions).toEqual(['pointer 10,20 left x1'])
  })

  it('repeats a click whose outcome did not show, up to retries', async () => {
    const { backend, actions, state } = fakeDesktop()
    let clicks = 0
    // The first click is lost; the second one works.
    state.onPointer = () => { clicks++; if (clicks === 2) state.text = 'Text: Saved' }
    await mount(backend)
    const result = await call('desktop_pointer', { x: 10, y: 20, expect: { text: 'Saved', timeout_ms: 500, retries: 2 } })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Verified on attempt 2 of 3')
    expect(actions).toEqual(['pointer 10,20 left x1', 'pointer 10,20 left x1'])
  })

  it('fails with what is in front when the outcome never shows, and says the action was sent', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_keys', { keys: 'ctrl+s', expect: { text: 'Saved', timeout_ms: 500, retries: 1 } })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Pressed ctrl+s into handle 7')
    expect(text(result)).toContain('but \\"Saved\\" shown did not show (attempt 1:')
    expect(text(result)).toContain('attempt 2:')
    expect(text(result)).toContain('The action was sent; check the window before repeating it.')
    expect(text(result)).toContain('Now in front: handle 7 pid 7 Editor')
    expect(text(result)).toContain('Document: Editor = draft')
    expect(actions).toEqual(['keys ctrl+s', 'keys ctrl+s'])
  })

  it('verifies a window that opens after a shortcut', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_keys', { keys: 'ctrl+o', expect: { window_title: 'open', timeout_ms: 2000 } })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Verified: Appeared: handle 8')
    expect(actions).toEqual(['keys ctrl+o'])
  })

  it('verifies that the text changed, reading it before the action', async () => {
    const { backend, state } = fakeDesktop()
    state.onPointer = () => { state.text = 'Document: Editor = draft 2' }
    await mount(backend)
    const result = await call('desktop_pointer', { x: 1, y: 1, expect: { changed: true, in: 'Report' } })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Verified: The window text changed after')
  })

  it('refuses repeats of typing before any key is sent', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_type', { text: 'hello', expect: { text: 'hello', retries: 1 } })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('typing again would enter the text a second time')
    expect(actions).toEqual([])
  })

  it('refuses expect on held keys and buttons, where the outcome comes later', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    expect(text(await call('desktop_keys', { keys: 'shift', hold: 'down', expect: { changed: true } }))).toContain('expect does not apply to hold down or up')
    expect(text(await call('desktop_pointer', { x: 1, y: 1, press: 'down', expect: { changed: true } }))).toContain('expect does not apply to press down or up')
    expect(actions).toEqual([])
  })
})

describe('input left pressed by a failed action', () => {
  it('releases the modifier keys and the mouse button after a failed click', async () => {
    const { backend, actions } = fakeDesktop()
    backend.pointer = async (x, y) => {
      actions.push(`pointer ${String(x)},${String(y)}`)
      throw new Error('input was blocked')
    }
    await mount(backend)
    const result = await call('desktop_pointer', { x: 5, y: 5, modifiers: 'ctrl' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('input was blocked Released ctrl, shift, alt, win and the left button in case the action left them pressed.')
    expect(actions).toEqual(['pointer 5,5', 'release ctrl+shift+alt+win', 'release left'])
  })

  it('keeps keys and buttons held on purpose', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    await call('desktop_keys', { keys: 'shift', hold: 'down' })
    await call('desktop_pointer', { x: 1, y: 1, press: 'down' })
    backend.drag = async () => { throw new Error('drag failed') }
    const result = await call('desktop_drag', { from_x: 1, from_y: 1, to_x: 50, to_y: 50 })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('drag failed Released ctrl, alt, win in case the action left them pressed.')
    expect(actions).toEqual(['hold shift', 'press left', 'release ctrl+alt+win'])
  })

  it('reports keys it could not release', async () => {
    const { backend } = fakeDesktop()
    backend.keys = async () => { throw new Error('helper stopped') }
    backend.holdKeys = async () => { throw new Error('helper stopped') }
    await mount(backend)
    const result = await call('desktop_keys', { keys: 'ctrl+c' })
    expect(text(result)).toContain('Could not release ctrl, shift, alt, win (helper stopped): check that no key or button is stuck before continuing.')
  })

  it('releases nothing when the action failed before sending input', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_keys', { keys: 'ctrl+hyper' })
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain('Released')
    expect(actions).toEqual([])
  })
})

describe('verified sequence steps', () => {
  it('checks every expectation before the first step runs', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_sequence', { steps: [
      { action: 'click', x: 1, y: 1 },
      { action: 'read', expect: { text: 'Saved' } },
    ] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('step 2 (read): expect is not available for read steps')
    expect(actions).toEqual([])
  })

  it('stops the sequence at a step whose outcome does not show', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_sequence', { steps: [
      { action: 'keys', keys: 'ctrl+o', expect: { window_title: 'Open', timeout_ms: 2000 } },
      { action: 'click', x: 3, y: 3, expect: { text: 'wrapped', timeout_ms: 500 } },
      { action: 'type', text: 'never' },
    ] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('1. pressed ctrl+o into handle 7')
    expect(text(result)).toContain('Verified: Appeared: handle 8')
    expect(text(result)).toContain('step 2 (click) failed: left click x1 at (3, 3), but \\"wrapped\\" shown did not show')
    expect(actions).toEqual(['keys ctrl+o', 'pointer 3,3 left x1'])
  })

  it('refuses repeats of a toggle step', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_sequence', { steps: [
      { action: 'element', element_action: 'toggle', name: 'Wrap', expect: { changed: true, retries: 1 } },
    ] })
    expect(text(result)).toContain('toggling again would undo the first toggle')
    expect(actions).toEqual([])
  })
})
