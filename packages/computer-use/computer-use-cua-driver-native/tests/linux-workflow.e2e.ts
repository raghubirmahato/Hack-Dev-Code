/**
 * Live multi-app, multi-task check of the whole-desktop tools on a Linux desktop: two tasks start Mousepad and GNOME
 * Calculator at once, tile them, reserve one window each, and work in parallel (one pastes a long text, the other
 * computes 123 x 45); the result is copied from the calculator into the editor, the document is saved through the
 * Save As dialog and checked on disk, then edited with one desktop_sequence, read back with text recognition and
 * screenshots, and both apps are closed. It acts only in the windows it opens and writes only /tmp/hackdev-workflow.txt.
 *
 * Run from the repository root in the graphical session (or with its DISPLAY), with no Mousepad or Calculator open:
 * `HACKDEV_LIVE_DESKTOP=1 npx vitest run --config vitest.e2e.config.ts` followed by this file's path.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { brandString } from '@hackdevcode/dsh-brand'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@hackdevcode/dsh-agent-loop-testkit'
import type { Agent } from '@hackdevcode/dsh-agent'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import type { SessionId } from '@hackdevcode/dsh-session'
import { linuxBackend, registerDisplayTools } from '../src/displays.ts'

const FILE = '/tmp/hackdev-workflow.txt'

describe.runIf(process.platform === 'linux' && process.env['HACKDEV_LIVE_DESKTOP'] === '1')('live Linux multi-app workflow', () => {
  it('runs two tasks across an editor and a calculator', { timeout: 300_000, retry: 0 }, async () => {
    rmSync(FILE, { force: true })
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    const writer = (await ctx.agents.create({ sessionId: brandString<SessionId>('workflow-writer') })).agent
    const counter = (await ctx.agents.create({ sessionId: brandString<SessionId>('workflow-calculator') })).agent
    const backend = linuxBackend()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    const call = async (agent: Agent, name: string, args: Record<string, unknown>): Promise<{ text: string; failed: boolean }> => {
      const result = await executeToolFixture(ctx, { name, callId: ToolCallId('workflow'), arguments: args, agent, signal: new AbortController().signal })
      const text = result.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('\n')
      const who = agent === writer ? 'writer' : 'calculator'
      console.log(`--- ${who}: ${name} ${JSON.stringify(args).slice(0, 300)}${result.isError ? ' (FAILED)' : ''}\n${text.slice(0, 1500)}`)
      return { text, failed: result.isError }
    }
    const handleOf = (text: string): number => Number(/New window: handle (\d+)/u.exec(text)?.[1])
    let editor: number | undefined
    let calculator: number | undefined
    try {
      // Both apps start at once; each launch must report its own window.
      const [openedEditor, openedCalculator] = await Promise.all([
        call(writer, 'desktop_open', { app: 'mousepad --disable-server' }),
        call(counter, 'desktop_open', { app: 'gnome-calculator' }),
      ])
      editor = handleOf(openedEditor.text)
      calculator = handleOf(openedCalculator.text)
      expect(openedEditor.text).toMatch(/New window: handle \d+ pid \d+ mousepad "[^"]*Mousepad"/u)
      expect(openedCalculator.text).toMatch(/New window: handle \d+ pid \d+ gnome-calculator "Calculator"/u)

      // Tile them side by side, at the same time, and reserve one each.
      const tiled = await Promise.all([
        call(counter, 'desktop_window', { action: 'move', handle: calculator, x: 40, y: 60, width: 460, height: 640 }),
        call(writer, 'desktop_window', { action: 'move', handle: editor, x: 560, y: 60, width: 900, height: 700 }),
      ])
      expect(tiled.map(result => result.failed)).toEqual([false, false])
      expect((await call(writer, 'desktop_window', { action: 'reserve', handle: editor })).text).toContain('Reserved')
      expect((await call(counter, 'desktop_window', { action: 'reserve', handle: calculator })).text).toContain('Reserved')

      // In parallel: a long multi-line paste in the editor, and a calculation in the calculator.
      const lines = Array.from({ length: 12 }, (_, index) => `Line ${String(index + 1)} of the hackdev workflow check, written while another task computes.`)
      const [pasted, computed] = await Promise.all([
        call(writer, 'desktop_type', { text: `${lines.join('\n')}\n`, window: editor, expect: { text: 'Line 12 of the hackdev workflow check', in: 'Mousepad', timeout_ms: 10_000 } }),
        call(counter, 'desktop_type', { text: '123*45\n', window: calculator, expect: { changed: true, in: 'Calculator', timeout_ms: 10_000 } }),
      ])
      expect.soft(pasted.text).toContain('Pasted')
      expect.soft(pasted.text).toContain('Verified')
      expect.soft(computed.text).toContain('Verified')
      const shown = await call(counter, 'desktop_window', { action: 'read', handle: calculator })
      expect.soft(shown.text).toMatch(/5[,.\u202f\u00a0]?535/u)

      // Each task's reservation keeps the other out.
      const intrusion = await call(counter, 'desktop_keys', { keys: 'ctrl+a', window: editor })
      expect.soft(intrusion.failed).toBe(true)
      expect.soft(intrusion.text).toContain('Nothing was sent')

      // Hand the result over: copy it in the calculator, paste it at the end of the document.
      expect((await call(counter, 'desktop_keys', { keys: 'ctrl+c', window: calculator })).failed).toBe(false)
      await call(counter, 'desktop_window', { action: 'release', handle: calculator })
      const handed = await call(writer, 'desktop_sequence', { steps: [
        { action: 'keys', keys: 'ctrl+End', handle: editor },
        { action: 'type', text: 'Result: ', handle: editor },
        { action: 'keys', keys: 'ctrl+v', handle: editor, expect: { text: 'Result: 5', in: 'Mousepad', timeout_ms: 8000 } },
      ] })
      expect.soft(handed.failed).toBe(false)

      // Save through the Save As dialog and check the file on disk.
      const saved = await call(writer, 'desktop_sequence', { steps: [
        { action: 'keys', keys: 'ctrl+s', handle: editor, expect: { window_title: 'Save As', timeout_ms: 8000 } },
        { action: 'type', text: FILE, title: 'Save As' },
        // Enter can be taken by the path completion list; the Save button is pressed through accessibility.
        { action: 'element', element_action: 'invoke', name: 'Save', role: 'Button', title: 'Save As', expect: { window_title: 'Save As', gone: true, timeout_ms: 8000 } },
        { action: 'wait', title: 'hackdev-workflow.txt', timeout_ms: 8000 },
      ] })
      expect.soft(saved.failed).toBe(false)
      expect(existsSync(FILE), 'the document was saved').toBe(true)
      const written = readFileSync(FILE, 'utf8')
      expect.soft(written).toContain('Line 1 of the hackdev workflow check')
      expect.soft(written).toContain('Line 12 of the hackdev workflow check')
      expect.soft(written).toMatch(/Result: 5[,.\u202f\u00a0]?535/u)

      // Replace the first line and save again in one sequence; the title loses its unsaved mark.
      const edited = await call(writer, 'desktop_sequence', { steps: [
        { action: 'keys', keys: 'ctrl+Home shift+End', handle: editor },
        { action: 'type', text: 'EDITED FIRST LINE', handle: editor, expect: { text: 'EDITED FIRST LINE', in: 'Mousepad', timeout_ms: 8000 } },
        { action: 'keys', keys: 'ctrl+s', handle: editor },
        { action: 'wait', stable: true, handle: editor, quiet_ms: 600, timeout_ms: 8000 },
      ] })
      expect.soft(edited.failed).toBe(false)
      expect.soft(readFileSync(FILE, 'utf8').split('\n')[0]).toBe('EDITED FIRST LINE')

      // Read both windows back.
      const recognized = await call(counter, 'desktop_ocr', { window: calculator })
      expect.soft(recognized.text).toMatch(/5[,.\s]?535/u)
      expect.soft((await call(writer, 'desktop_screenshot', { window: editor, max_dimension: 800 })).failed).toBe(false)
      expect.soft((await call(counter, 'desktop_screenshot', { window: calculator, max_dimension: 800 })).failed).toBe(false)
      const listed = await call(writer, 'desktop_window', { action: 'list' })
      expect.soft(listed.text).toMatch(/pid \d+ mousepad "\/tmp\/hackdev-workflow\.txt - Mousepad"/u)
      expect.soft(listed.text).toMatch(/pid \d+ gnome-calculator "Calculator"/u)
      await call(writer, 'desktop_window', { action: 'release', handle: editor })
    } finally {
      // Close what was opened: the calculator has nothing to save; an editor with changes is closed without saving.
      if (calculator !== undefined && Number.isFinite(calculator)) {
        await call(counter, 'desktop_window', { action: 'close', handle: calculator }).catch(() => undefined)
      }
      if (editor !== undefined && Number.isFinite(editor)) {
        await call(writer, 'desktop_sequence', { steps: [
          { action: 'close', handle: editor },
          { action: 'element', element_action: 'invoke', name: 'Don\'t Save', title: 'Save Changes', optional: true, timeout_ms: 2000 },
          { action: 'wait', title: 'Mousepad', gone: true, timeout_ms: 5000, optional: true },
        ] }).catch(() => undefined)
      }
      backend.close()
      await ctx.fiber.dispose()
    }
  })
})
