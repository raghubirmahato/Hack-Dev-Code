/**
 * Computer use through the in-process Cua Driver native SDK and its own tools.
 * @module @hackdevcode/dsh-computer-use-cua-driver-native
 */

import type { Context } from '@hackdevcode/cordis'
import Schema from '@hackdevcode/schemastery'
import { ComputerUseProviderName } from '@hackdevcode/dsh-computer-use/brand'
import { createMcpToolDefinition } from '@hackdevcode/dsh-mcp-client'
import { z } from 'zod'
import type { CuaDriver as NativeDriver } from '@trycua/cua-driver'
import { DISPLAY_GUIDANCE, displayBackend, registerDisplayTools } from './displays.ts'
import { withSnapshotDefaults, withSnapshotIdentity } from './snapshot.ts'
import type {} from '@hackdevcode/dsh-computer-use'
import type {} from '@hackdevcode/dsh-system-prompt'
import type {} from '@hackdevcode/dsh-tools'

/** Cordis plugin identity for the native Cua Driver provider. */
export const name = 'computer-use-cua-driver-native'

/** Services required before the native runtime can publish tools. */
export const inject = ['computerUse', 'tools', 'systemPrompt']

/** Which part of the driver catalog the model sees. */
export interface Config {
  /**
   * `essential` (default) leaves out tools agents rarely need (trajectory recording and replay, the agent cursor
   * overlay, driver configuration and session bookkeeping, ffmpeg installation), which keeps every request smaller;
   * `all` exposes the whole catalog.
   */
  toolset?: 'essential' | 'all'
  /**
   * Keep the desktop tools out of every request until the agent loads them: the `desktop` group holds the
   * whole-desktop tools and the core window tools, `desktop-more` the rest of the driver catalog. Defaults to true.
   */
  onDemand?: boolean
  /**
   * Windows: how real input reaches windows of apps that run as administrator. `ask` (default) starts an
   * administrator helper the first time it is needed, which shows Windows' UAC prompt for the person to approve;
   * `off` refuses such input with an explanation.
   */
  elevation?: 'ask' | 'off'
}

/** The native provider uses the installed SDK's same-process defaults. */
export const Config: Schema<Config> = Schema.object({
  toolset: Schema.union(['essential', 'all'] as const).default('essential'),
  onDemand: Schema.boolean().default(true),
  elevation: Schema.union(['ask', 'off'] as const).default('ask'),
})

/** The on-demand group holding the desktop tools. */
export const DESKTOP_GROUP = {
  name: 'desktop',
  description: 'operate the whole desktop: list, launch, focus, arrange and close apps and windows; read windows and their controls; click, drag, scroll, type and press shortcuts with background or real input (Start menu, taskbar, shell and every app); open files, URLs and settings; use the clipboard; and see and act on every connected display.',
}

/** The second on-demand group: driver tools most desktop work does without, kept out of requests until needed. */
export const DESKTOP_MORE_GROUP = {
  name: 'desktop-more',
  description: 'rarely needed desktop tools; load only when the desktop group cannot do the job: background key presses, hotkeys, scrolling, drags and double or right clicks delivered to one window without moving the real pointer, application menus, exact window frames, bringing a window forward, killing a process, verifying window state, zooming into a window, full-screen capture at native size, browser page automation through DevTools, and permission checks.',
}

/**
 * Driver tools in the `desktop` group beside the whole-desktop tools; the rest load with `desktop-more`. Each
 * driver tool definition costs hundreds to thousands of tokens on every request, and these cover finding, reading
 * and operating app windows.
 */
export const CORE_DRIVER_TOOLS: ReadonlySet<string> = new Set([
  'list_apps', 'list_windows', 'get_window_state', 'launch_app', 'click', 'set_value', 'type_text', 'clipboard_read', 'clipboard_write',
])

/** Driver tools left out of the essential set. */
export const NON_ESSENTIAL_TOOLS: ReadonlySet<string> = new Set([
  'start_recording', 'stop_recording', 'get_recording_state', 'replay_trajectory', 'install_ffmpeg',
  'move_cursor', 'get_cursor_position', 'set_agent_cursor_enabled', 'set_agent_cursor_motion', 'get_agent_cursor_state', 'set_agent_cursor_theme',
  'get_config', 'set_config', 'debug_window_info', 'health_report',
  'start_session', 'escalate_session', 'get_session', 'list_sessions', 'get_session_state', 'end_session',
])

const ToolCatalog = z.object({
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.unknown().optional(),
  })),
})

/** DeepSeek's function-name alphabet and maximum length are protocol constants. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u

const GUIDANCE = `Cua Driver native computer-use tools operate the host desktop. Discover the exact app and window, then get a fresh window snapshot before acting. Use element_token from that snapshot, or coordinates from its screenshot. A new snapshot of that window invalidates its earlier element tokens: never take a snapshot and act with older tokens in the same step, and after "element_token is stale" use only tokens from the newest snapshot. Pass element_index only together with that snapshot's snapshot_id. Select either target or the legacy pid/window_id fields; do not combine them.

Work with several applications by keeping each window's pid and window_id; actions on one window do not need it in front. Keep snapshots small: pass query to find specific controls, and include_screenshot=false when you only need fresh element tokens. Modern Notepad and other WinUI apps ignore posted shortcuts and typing; use desktop_keys and desktop_type (real keyboard input to the foreground window) for them. launch_app can return a window that was already open (Notepad, Calculator and browsers reuse one window): before typing, check the window title and contents, and never type into the person's own document; open a new tab or window for new work.

Prefer background delivery. A refusal does not authorize a foreground retry. Verify the requested outcome from fresh state after an action; a delivered click alone does not prove the outcome. After cancellation, inspect current state before retrying because completed input is not rolled back. Other sessions and applications may change the same desktop.

On macOS, cursor-overlay operations may return facility_unavailable even when screenshots and input work.`

/**
 * Own one native runtime and expose its catalog through the MCP result adapter.
 * Startup failures roll back every registration. Unload removes tools, aborts
 * calls and image admission, awaits settlement and SDK shutdown, then releases computer use.
 * @param ctx - context providing the exclusive registration and tool services.
 * @returns after native import, runtime creation, and tool discovery complete.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const essentialOnly = (config.toolset ?? 'essential') === 'essential'
  const onDemand = config.onDemand !== false
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let driver: NativeDriver | undefined
  // Cordis announces disposal before it awaits asynchronous plugin startup.
  ctx.on('internal/plugin', (fiber) => {
    if (fiber === ctx.fiber && fiber.uid === null) lifetime.abort()
  }, { global: true })
  let ready: Promise<void> = Promise.resolve()
  const dispose = ctx.effect(function* () {
    yield ctx.computerUse.register(ComputerUseProviderName('cua-driver-native'))
    yield async () => {
      lifetime.abort()
      // apply() reports startup failure; teardown still owns its native handle.
      await ready.catch(() => {})
      await Promise.allSettled(pending)
      if (driver !== undefined) {
        await driver.shutdown()
        driver.uniffiDestroy()
      }
    }
    const child = ctx.plugin({
      name: 'computer-use-cua-driver-native-runtime',
      inject: ['tools', 'systemPrompt'],
      apply: mountRuntime,
    })
    yield child.dispose
    ready = Promise.resolve(child).then(() => {})
  }, 'computer-use-cua-driver-native.runtime')
  try {
    await ready
  } catch (error) {
    await dispose()
    throw error
  }

  /** The child owns tool registrations; the outer effect owns native teardown. */
  async function mountRuntime(inner: Context): Promise<void> {
    const { CuaDriver } = await import('@trycua/cua-driver')
    lifetime.signal.throwIfAborted()
    // The generated constructor returns its class with an owned binding handle,
    // but declares only CuaDriverLike, which omits uniffiDestroy().
    const activeDriver = driver = CuaDriver.create(undefined) as NativeDriver
    const catalog = ToolCatalog.parse(JSON.parse(await activeDriver.listToolsJson({ signal: lifetime.signal })))
    lifetime.signal.throwIfAborted()
    const names = new Set<string>()
    for (const tool of catalog.tools) {
      if (essentialOnly && NON_ESSENTIAL_TOOLS.has(tool.name)) continue
      const publicName = `cua_driver_native__${tool.name}`
      if (!TOOL_NAME.test(publicName)) {
        throw new Error(`Cua Driver tool "${tool.name}" exceeds the supported function-name format`)
      }
      if (names.has(publicName)) throw new Error(`Cua Driver listed tool "${tool.name}" more than once`)
      names.add(publicName)
      const definition = createMcpToolDefinition(inner, {
        name: publicName,
        rawName: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        async call(args, execution) {
          const combined = AbortSignal.any([execution.signal, lifetime.signal])
          combined.throwIfAborted()
          const result = await activeDriver.callTool(tool.name, JSON.stringify(withSnapshotDefaults(tool.name, args)), { signal: combined })
          combined.throwIfAborted()
          return withSnapshotIdentity(tool.name, JSON.parse(result.rawJson) as unknown)
        },
      })
      inner.tools.register(definition, onDemand ? { group: CORE_DRIVER_TOOLS.has(tool.name) ? DESKTOP_GROUP : DESKTOP_MORE_GROUP } : {})
    }
    inner.on('tools/execute', async (exec, next) => {
      if (!names.has(exec.name)) return next()
      const upstream = exec.signal
      exec.signal = AbortSignal.any([upstream, lifetime.signal])
      const operation = Promise.resolve().then(next)
      pending.add(operation)
      try {
        return await operation
      } finally {
        pending.delete(operation)
        exec.signal = upstream
      }
    })
    inner.systemPrompt.section({
      name: 'computer-use:cua-driver-native',
      order: inner.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'),
      text: GUIDANCE,
    })
    // Whole-screen capture and pointer input on every connected display, not only the primary one.
    const displays = displayBackend(process.platform, { elevation: config.elevation ?? 'ask' })
    if (displays !== undefined) {
      inner.effect(() => () => { displays.close() }, 'computer-use-cua-driver-native.desktop-helper')
      registerDisplayTools(inner, displays, onDemand ? DESKTOP_GROUP : undefined)
      inner.systemPrompt.section({
        name: 'computer-use:displays',
        order: inner.systemPrompt.getSectionOrder('TOOL_COMPUTER_USE'),
        text: DISPLAY_GUIDANCE,
      })
    }
  }
}
