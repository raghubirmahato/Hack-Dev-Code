/**
 * Live check of the whole-desktop tools on a Linux desktop (X11, or Wayland with XWayland): report the setup, open a Mousepad window of its
 * own, reserve it, read its controls through AT-SPI, type into it with a verified outcome, find a control by type,
 * wait for it to settle, check a drag's drop target, show that a click outside the reserved window is refused
 * before it is sent, and close the window without saving. It acts only in the window it opens.
 *
 * Run it from the repository root in a terminal of the graphical session (not over SSH), with no Mousepad window
 * open: `HACKDEV_LIVE_DESKTOP=1 npx vitest run --config vitest.e2e.config.ts` followed by this file's path.
 * `HACKDEV_LIVE_APP` and `HACKDEV_LIVE_TITLE` pick another editor (default `mousepad --disable-server`, a process of its own
 * rather than a new window of a Mousepad already running, and `Mousepad`).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import { linuxBackend, registerDisplayTools } from '../src/displays.ts'

const APP = process.env['HACKDEV_LIVE_APP'] ?? 'mousepad --disable-server'
const TITLE = process.env['HACKDEV_LIVE_TITLE'] ?? 'Mousepad'

describe.runIf(process.platform === 'linux' && process.env['HACKDEV_LIVE_DESKTOP'] === '1')('live Linux desktop', () => {
  // No retries: each attempt opens a window, and a failed attempt may leave one the next cannot see.
  it('drives its own editor window like a person', { timeout: 240_000, retry: 0 }, async () => {
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
      expect(setup.text).toContain('ready: Real mouse and keyboard input')
      const displays = await call('desktop_list_displays', {})
      expect(displays.failed).toBe(false)
      const [, width, height] = /(\d+)x(\d+) at \(/u.exec(displays.text)?.map(Number) ?? [0, 1280, 720]

      // Work in the window this launch opened, never in one of the same app that was already open.
      const before = new Set([...(await call('desktop_window', { action: 'list' })).text.matchAll(/handle (\d+)/gu)].map(match => Number(match[1])))
      const opened = await call('desktop_open', { app: APP })
      expect(opened.failed).toBe(false)
      handle = Number(/New window: handle (\d+)/u.exec(opened.text)?.[1])
      if (!Number.isFinite(handle)) {
        expect((await call('desktop_window', { action: 'wait', title: TITLE, timeout_ms: 20_000 })).failed).toBe(false)
        const listed = await call('desktop_window', { action: 'list' })
        const line = listed.text.split('\n').find(row => row.toLowerCase().includes(TITLE.toLowerCase()) && !before.has(Number(/handle (\d+)/u.exec(row)?.[1])))
        handle = Number(/handle (\d+)/u.exec(line ?? '')?.[1])
      }
      expect(Number.isFinite(handle) && handle > 0 && !before.has(handle), `a new ${TITLE} window opened`).toBe(true)

      // A known place and size, so a point outside it is easy to pick.
      expect.soft((await call('desktop_window', { action: 'move', handle, x: 80, y: 80, width: 700, height: 480 })).failed).toBe(false)
      expect((await call('desktop_window', { action: 'reserve', handle, seconds: 120 })).text).toContain('Reserved')

      const read = await call('desktop_window', { action: 'read', handle })
      expect.soft(read.text).toMatch(/\[\d+\] \w+/u)

      await call('desktop_window', { action: 'focus', handle })
      const typed = await call('desktop_type', { text: 'hackdev live check', window: handle, expect: { text: 'hackdev live check', in: TITLE, timeout_ms: 8000 } })
      expect.soft(typed.text).toContain('Verified')

      const found = await call('desktop_element', { action: 'find', role: 'Edit', window: handle })
      expect.soft(found.text).toMatch(/\[\d+\] Edit = "hackdev live check"/u)

      const settled = await call('desktop_window', { action: 'wait', stable: true, handle, quiet_ms: 600, timeout_ms: 10_000 })
      expect.soft(settled.text).toContain('stayed the same')

      // Select some of the typed text by dragging inside the window's left part, away from the middle of the screen where
      // a native Wayland window (a terminal) may float above it; the drop target must be the editor.
      const dragged = await call('desktop_drag', { from_x: 120, from_y: 250, to_x: 300, to_y: 250, onto: TITLE })
      // GNOME may keep a native window (such as the person's own) above the editor; the drag must then be refused
      // before anything is pressed, never reported as done.
      expect.soft(dragged.text).toMatch(/onto "[^"]*Mousepad"|a window these tools cannot see is on top/u)
      if (dragged.failed) expect.soft(dragged.text).toContain('nothing was pressed')
      const refusedDrop = await call('desktop_drag', { from_x: 120, from_y: 250, to_x: 300, to_y: 250, onto: 'no such window' })
      expect.soft(refusedDrop.text).toContain('Nothing was dragged')

      // A point well outside the reserved window (80, 80, 700x480): the click must be refused before it is sent.
      const outside = await call('desktop_pointer', { x: Math.max(800, (width ?? 1280) - 60), y: Math.max(600, (height ?? 720) - 60) })
      expect.soft(outside.failed).toBe(true)
      expect.soft(outside.text).toContain('Nothing was sent')

      expect((await call('desktop_window', { action: 'release', handle })).text).toContain('Released')
    } finally {
      if (handle !== undefined && Number.isFinite(handle)) {
        await call('desktop_sequence', { steps: [
          { action: 'close', handle },
          { action: 'element', element_action: 'invoke', name: 'Don\'t Save', title: 'Save Changes', optional: true, timeout_ms: 3000 },
          { action: 'wait', title: TITLE, gone: true, timeout_ms: 5000, optional: true },
        ] }).catch(() => undefined)
      }
      backend.close()
      await ctx.fiber.dispose()
    }
  })
})
