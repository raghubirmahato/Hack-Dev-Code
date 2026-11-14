/**
 * Live check of the whole-desktop tools on this Windows machine: start Calculator by name, read its numbered
 * controls, press buttons by name, wait for the result text, read it with OCR, move the window, and close it.
 * Run by hand with HACKDEV_LIVE_DESKTOP=1:
 * `npx vitest run --config vitest.e2e.config.ts packages/computer-use/computer-use-cua-driver-native/tests/desktop-live.e2e.ts`.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { registerDisplayTools, windowsBackend } from '../src/displays.ts'

interface Registered { name: string; execute?: (args: unknown, execution: { signal: AbortSignal }) => Promise<{ done?: string }> }

describe.runIf(process.platform === 'win32' && process.env['HACKDEV_LIVE_DESKTOP'] === '1')('live desktop', () => {
  it('drives Calculator like a person', async () => {
    const tools = new Map<string, Registered>()
    const ctx = { tools: { register: (tool: Registered) => { tools.set(tool.name, tool) } }, effect: () => {} } as unknown as Context
    const backend = windowsBackend()
    registerDisplayTools(ctx, backend)
    const signal = new AbortController().signal
    const call = async (name: string, args: unknown): Promise<string> => {
      const result = await tools.get(name)?.execute?.(args, { signal })
      const text = result?.done ?? ''
      console.log(`--- ${name} ${JSON.stringify(args)}\n${text.slice(0, 1500)}`)
      return text
    }
    try {
      expect(await call('desktop_open', { app: 'Calculator' })).toContain('New window')
      await call('desktop_window', { action: 'wait', title: 'Calculator' })
      const read = await call('desktop_window', { action: 'read', title: 'Calculator' })
      expect(read).toMatch(/\[\d+\] Button "Seven" @\(\d+,\d+\)/u)
      await call('desktop_element', { action: 'invoke', name: 'Clear', role: 'Button', title: 'Calculator' })
      await call('desktop_element', { action: 'click', name: 'Seven', title: 'Calculator' })
      await call('desktop_element', { action: 'invoke', name: 'Plus', title: 'Calculator' })
      await call('desktop_element', { action: 'invoke', name: 'Five', title: 'Calculator' })
      await call('desktop_element', { action: 'invoke', name: 'Equals', title: 'Calculator' })
      expect(await call('desktop_window', { action: 'wait', title: 'Calculator', text: 'Display is 12', timeout_ms: 5000 })).toContain('Found the text')
      expect(await call('desktop_ocr', { title: 'Calculator' })).toMatch(/"12"/u)
      expect(await call('desktop_window', { action: 'move', title: 'Calculator', x: 120, y: 80, width: 520, height: 760 })).toMatch(/5\d\dx7\d\d at \(120, 80\)/u)
      const found = await call('desktop_element', { action: 'find', name: 'equals', title: 'Calculator' })
      expect(found).toContain('Equals')
    } finally {
      await call('desktop_window', { action: 'close', title: 'Calculator' }).catch(() => '')
      backend.close()
    }
  }, 120_000)
})
