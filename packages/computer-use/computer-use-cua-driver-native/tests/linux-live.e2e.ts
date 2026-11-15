/**
 * Live check of the whole-desktop tools on a Linux desktop (X11): report the setup, open a Mousepad window of its
 * own, reserve it, read its controls through AT-SPI, type into it with a verified outcome, find a control by type,
 * wait for it to settle, check a drag's drop target, show that a click outside the reserved window is refused
 * before it is sent, and close the window without saving. It acts only in the window it opens.
 *
 * Run it from the repository root in a terminal of the graphical session (not over SSH), with no Mousepad window
 * open: `HACKDEV_LIVE_DESKTOP=1 npx vitest run --config vitest.e2e.config.ts` followed by this file's path.
 * `HACKDEV_LIVE_APP` and `HACKDEV_LIVE_TITLE` pick another editor (default `mousepad` and `Mousepad`).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import { linuxBackend, registerDisplayTools } from '../src/displays.ts'

const APP = process.env['HACKDEV_LIVE_APP'] ?? 'mousepad'
const TITLE = process.env['HACKDEV_LIVE_TITLE'] ?? 'Mousepad'

describe.runIf(process.platform === 'linux' && process.env['HACKDEV_LIVE_DESKTOP'] === '1')('live Linux desktop', () => {
  it('drives its own editor window like a person', { timeout: 240_000 }, async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const backend = linuxBackend()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    /** Run one tool, print what it returned, and give back its text and whether it failed. */
    const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; failed: boolean }> => {
      const result = await executeToolFixture(ctx, { name, callId: ToolCallId('linux-live'), arguments: args, signal: new AbortController().signal })
      const text = result.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('\n')
      console.log(`--- ${name} ${JSON.stringify(args)}${result.isError ? ' (FAILED)' : ''}\n${text.slice(0, 2500)}`)
      return { text, failed: result.isError }
    }
    let handle: number | undefined
    try {
      const setup = await call('desktop_setup', {})
      expect.soft(setup.text).toContain('ready: Real mouse and keyboard input')
      expect.soft(setup.text).toContain('ready: Window text and controls by name')
      const displays = await call('desktop_list_displays', {})
      expect(displays.failed).toBe(false)

      expect((await call('desktop_open', { app: APP })).failed).toBe(false)
      expect((await call('desktop_window', { action: 'wait', title: TITLE, timeout_ms: 20_000 })).failed).toBe(false)
      const listed = await call('desktop_window', { action: 'list' })
      const line = listed.text.split('\n').find(row => row.toLowerCase().includes(TITLE.toLowerCase()))
      handle = Number(/handle (\d+)/u.exec(line ?? '')?.[1])
      expect(Number.isFinite(handle) && handle > 0, `a ${TITLE} window is listed`).toBe(true)

      // A known place and size, so a point outside it is easy to pick.
      expect.soft((await call('desktop_window', { action: 'move', handle, x: 80, y: 80, width: 700, height: 480 })).failed).toBe(false)
      expect((await call('desktop_window', { action: 'reserve', handle, seconds: 120 })).text).toContain('Reserved')

      const read = await call('desktop_window', { action: 'read', handle })
      expect.soft(read.text).toMatch(/\[\d+\] \w+/u)

      await call('desktop_window', { action: 'focus', handle })
      const typed = await call('desktop_type', { text: 'hackdev live check', window: handle, expect: { text: 'hackdev live check', in: TITLE, timeout_ms: 8000 } })
      expect.soft(typed.text).toContain('Verified')

      const found = await call('desktop_element', { action: 'find', role: 'Edit', window: handle })
      expect.soft(found.text).toMatch(/=\[\d+\] Edit/u)

      const settled = await call('desktop_window', { action: 'wait', stable: true, handle, quiet_ms: 600, timeout_ms: 10_000 })
      expect.soft(settled.text).toContain('stayed the same')

      // Select some of the typed text by dragging inside the window; the drop target must be the editor.
      const dragged = await call('desktop_drag', { from_x: 200, from_y: 250, to_x: 400, to_y: 250, onto: TITLE })
      expect.soft(dragged.text).toContain('onto')
      const refusedDrop = await call('desktop_drag', { from_x: 200, from_y: 250, to_x: 400, to_y: 250, onto: 'no such window' })
      expect.soft(refusedDrop.text).toContain('Nothing was dragged')

      // A point well outside the reserved window: the click must be refused before it is sent.
      const outside = await call('desktop_pointer', { x: 1000, y: 700 })
      expect.soft(outside.failed).toBe(true)
      expect.soft(outside.text).toContain('Nothing was sent')

      expect((await call('desktop_window', { action: 'release', handle })).text).toContain('Released')
    } finally {
      if (handle !== undefined && Number.isFinite(handle)) {
        await call('desktop_sequence', { steps: [
          { action: 'close', handle },
          { action: 'element', element_action: 'click', name: 'Don\'t Save', optional: true, timeout_ms: 3000 },
          { action: 'wait', title: TITLE, gone: true, timeout_ms: 5000, optional: true },
        ] }).catch(() => undefined)
      }
      backend.close()
      await ctx.fiber.dispose()
    }
  })
})
