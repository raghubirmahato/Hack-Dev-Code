/**
 * Live check of driving Google Chrome on a Linux desktop: a throwaway Chrome (its own data folder with two test
 * profiles, never the person's) shows its profile picker, a profile is chosen, three local test pages open in tabs,
 * each tab is used in turn (a form, a counter, a notes area), state survives switching back, the second profile is
 * opened from Chrome's profile menu, and everything is closed. No network is used.
 *
 * Run from the repository root in the graphical session (or with its DISPLAY):
 * `HACKDEV_LIVE_DESKTOP=1 npx vitest run --config vitest.e2e.config.ts` followed by this file's path.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import { linuxBackend, registerDisplayTools } from '../src/displays.ts'

const DATA = '/tmp/hackdev-chrome'
const PAGES = '/tmp/hackdev-pages'

/** Two test profiles, and the picker shown at start. */
const LOCAL_STATE = {
  profile: {
    info_cache: {
      Work: { name: 'Work test', is_using_default_name: false },
      Personal: { name: 'Personal test', is_using_default_name: false },
    },
    show_picker_on_startup: true,
    last_used: 'Work',
    profiles_order: ['Work', 'Personal'],
  },
  browser: { has_seen_welcome_page: true },
}

const PAGE_FILES: Record<string, string> = {
  'form.html': '<!doctype html><title>Signup form</title><label for="name">Your name</label> <input id="name">'
    + ' <button onclick="document.getElementById(\'out\').textContent = \'Thanks, \' + document.getElementById(\'name\').value">Send</button>'
    + '<p id="out"></p>',
  'counter.html': '<!doctype html><title>Counter page</title><button onclick="let o = document.getElementById(\'o\');'
    + ' o.textContent = \'Count: \' + (Number(o.textContent.split(\': \')[1]) + 1)">Add one</button><p id="o">Count: 0</p>',
  'notes.html': '<!doctype html><title>Notes page</title><textarea aria-label="Notes" rows="8" cols="60"></textarea>',
}

describe.runIf(process.platform === 'linux' && process.env['HACKDEV_LIVE_DESKTOP'] === '1')('live Chrome on Linux', () => {
  it('chooses a profile, opens tabs and uses each one', { timeout: 300_000, retry: 0 }, async () => {
    rmSync(DATA, { recursive: true, force: true })
    mkdirSync(`${DATA}/Work`, { recursive: true })
    mkdirSync(`${DATA}/Personal`, { recursive: true })
    writeFileSync(`${DATA}/Local State`, JSON.stringify(LOCAL_STATE))
    mkdirSync(PAGES, { recursive: true })
    for (const [name, html] of Object.entries(PAGE_FILES)) writeFileSync(`${PAGES}/${name}`, html)

    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const backend = linuxBackend()
    await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
    const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; failed: boolean }> => {
      const result = await executeToolFixture(ctx, { name, callId: ToolCallId('chrome'), arguments: args, signal: new AbortController().signal })
      const text = result.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('\n')
      console.log(`--- ${name} ${JSON.stringify(args).slice(0, 300)}${result.isError ? ' (FAILED)' : ''}\n${text.slice(0, 1800)}`)
      return { text, failed: result.isError }
    }
    const browserWindows = async (): Promise<number[]> => [...(await call('desktop_window', { action: 'list' })).text.matchAll(/handle (\d+) pid \d+ chrome "[^"]*Google Chrome[^"]*"/gu)]
      .map(match => Number(match[1]))
    try {
      // 1. A throwaway Chrome opens on its profile picker.
      const opened = await call('desktop_open', { app: `google-chrome --user-data-dir=${DATA} --no-first-run --no-default-browser-check --password-store=basic` })
      expect(opened.failed).toBe(false)
      const picker = Number(/New window: handle (\d+)/u.exec(opened.text)?.[1])
      expect(Number.isFinite(picker), 'the picker window opened').toBe(true)
      const pickerText = await call('desktop_window', { action: 'wait', handle: picker, text: 'Open Work test profile', timeout_ms: 20_000 })
      expect.soft(pickerText.failed).toBe(false)

      // 2. Choose the Work test profile; its browser window opens on a new tab.
      const chosen = await call('desktop_element', { action: 'invoke', name: 'Open Work test profile', window: picker, expect: { window_title: 'New Tab', timeout_ms: 20_000 } })
      expect.soft(chosen.text).toContain('Verified')
      const work = Number(/handle (\d+) pid \d+ chrome "New Tab - Google Chrome/u.exec(chosen.text)?.[1]
        ?? /handle (\d+)[^\n]*New Tab/u.exec((await call('desktop_window', { action: 'list' })).text)?.[1])
      expect(Number.isFinite(work), 'the Work test window opened').toBe(true)
      await call('desktop_window', { action: 'move', handle: work, x: 40, y: 40, width: 1100, height: 760 })

      // 3. Three tabs: the first page in the new tab, the others in tabs of their own.
      const load = async (page: string, title: string, newTab: boolean): Promise<void> => {
        const steps = [
          { action: 'keys', keys: newTab ? 'ctrl+t' : 'ctrl+l', handle: work },
          { action: 'type', text: `file://${PAGES}/${page}\n`, handle: work, expect: { window_title: title, timeout_ms: 15_000 } },
        ]
        expect.soft((await call('desktop_sequence', { steps })).text).toContain(`Appeared: handle ${String(work)}`)
      }
      await load('form.html', 'Signup form', false)
      await load('counter.html', 'Counter page', true)
      await load('notes.html', 'Notes page', true)

      // 4. Use each tab in turn.
      const tab = async (number: number, title: string): Promise<void> => {
        expect.soft((await call('desktop_keys', { keys: `ctrl+${String(number)}`, window: work, expect: { window_title: title, timeout_ms: 8000 } })).text).toContain('Verified')
      }
      await tab(1, 'Signup form')
      expect.soft((await call('desktop_element', { action: 'set_value', name: 'Your name', role: 'Edit', window: work, value: 'Ada Lovelace' })).failed).toBe(false)
      expect.soft((await call('desktop_element', { action: 'invoke', name: 'Send', role: 'Button', window: work, expect: { text: 'Thanks, Ada Lovelace', timeout_ms: 8000 } })).text)
        .toContain('Verified')

      await tab(2, 'Counter page')
      for (let press = 1; press <= 3; press++) {
        const pressed = await call('desktop_element', { action: 'invoke', name: 'Add one', role: 'Button', window: work, expect: { text: `Count: ${String(press)}`, timeout_ms: 8000 } })
        expect.soft(pressed.text).toContain('Verified')
      }

      await tab(3, 'Notes page')
      await call('desktop_element', { action: 'focus', name: 'Notes', window: work })
      const noted = await call('desktop_type', { text: 'First note from the agent.\nSecond line.', window: work, expect: { text: 'Second line.', timeout_ms: 8000 } })
      expect.soft(noted.text).toContain('Verified')

      // 5. The first tab kept its state.
      await tab(1, 'Signup form')
      expect.soft((await call('desktop_window', { action: 'read', handle: work })).text).toContain('Thanks, Ada Lovelace')

      // 6. Open the second profile from Chrome's own profile menu.
      const before = await browserWindows()
      // Chrome names its profile button by state: the profile name, or a sign-in prompt for a profile not signed in.
      let menu = await call('desktop_element', { action: 'find', role: 'Button', name: 'Work test', window: work, timeout_ms: 0 })
      if (menu.failed) menu = await call('desktop_element', { action: 'find', role: 'Button', name: 'Sign in to Chrome', window: work })
      console.log(`profile button candidates:\n${menu.text}`)
      const profileButton = /\[(\d+)\] Button "[^"]*(?:Work test|Sign in to Chrome)[^"]*"/u.exec(menu.text)?.[1]
      if (profileButton !== undefined) {
        await call('desktop_element', { action: 'invoke', index: Number(profileButton), window: work })
        const personal = await call('desktop_element', { action: 'invoke', name: 'Personal test', window: work, timeout_ms: 5000 })
        expect.soft(personal.failed).toBe(false)
        await call('desktop_window', { action: 'wait', title: 'Google Chrome', timeout_ms: 2000 })
        await new Promise(resolve => setTimeout(resolve, 3000))
        const after = await browserWindows()
        expect.soft(after.length, 'a second browser window opened for the Personal test profile').toBeGreaterThan(before.length)
      } else {
        expect.soft(profileButton, 'Chrome\'s profile button is exposed').toBeDefined()
      }
      expect.soft((await call('desktop_screenshot', { window: work, max_dimension: 900 })).failed).toBe(false)
    } finally {
      for (const handle of await browserWindows().catch(() => [])) await call('desktop_window', { action: 'close', handle }).catch(() => undefined)
      const pickerLeft = /handle (\d+) pid \d+ chrome "Google Chrome"/u.exec((await call('desktop_window', { action: 'list' }).catch(() => ({ text: '' }))).text)?.[1]
      if (pickerLeft !== undefined) await call('desktop_window', { action: 'close', handle: Number(pickerLeft) }).catch(() => undefined)
      backend.close()
      await ctx.fiber.dispose()
      // The throwaway Chrome and its folder go away; the person's own Chrome is never touched.
      try {
        execFileSync('pkill', ['-f', `^/opt/google/chrome/chrome .*--user-data-dir=${DATA}`])
      } catch {
        // pkill exits 1 when no test Chrome is left: everything already closed.
      }
      rmSync(DATA, { recursive: true, force: true })
      rmSync(PAGES, { recursive: true, force: true })
    }
  })
})
