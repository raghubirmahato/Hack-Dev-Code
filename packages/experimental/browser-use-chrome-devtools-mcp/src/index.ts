/** Chromium inspection and automation through the pinned Chrome DevTools MCP server. @module */

import { fileURLToPath } from 'node:url'
import type { Context } from '@hackdevcode/cordis'
import Schema from '@hackdevcode/schemastery'
import { mountSessionMcp, validateBrowserMcpConfig } from '@hackdevcode/dsh-experimental-browser-use-runtime/mcp'
import type { BrowserMcpAttachConfig, BrowserMcpLaunchConfig } from '@hackdevcode/dsh-experimental-browser-use-runtime/mcp'
import type {} from '@hackdevcode/dsh-working-directory'

/** Cordis identity for the Chrome DevTools MCP browser provider. */
export const name = 'experimental-browser-use-chrome-devtools-mcp'

/** Services required for scoped MCP startup and prompt readiness checks. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory']

/** Chrome release channel whose installation and profile are used. */
export type ChromeChannel = 'stable' | 'beta' | 'dev' | 'canary'

/** Capabilities shared by every Chrome connection mode. */
export interface ChromeCapabilities {
  /** Add coordinate tools such as click_at(x, y) for screenshot-driven control; defaults to false. */
  vision?: boolean
  /** Downscale screenshots wider than this many pixels, which keeps image tokens bounded. */
  screenshotMaxWidth?: number
}

/** Launch Chrome for each live Session. */
export interface ChromeLaunchConfig extends BrowserMcpLaunchConfig, ChromeCapabilities {
  /**
   * Use a throwaway profile that is deleted when the browser closes; defaults to true. With false the
   * browser keeps one persistent profile, so sign-ins and cookies survive between sessions.
   */
  isolated?: boolean
  /** Persistent profile directory used when `isolated` is false; omission uses the upstream default. */
  userDataDir?: string
  /** Chrome channel to launch; omission uses stable. */
  channel?: ChromeChannel
  /** Initial window size such as `1280x800`. */
  viewport?: string
}

/** Attach to a browser through its debugging endpoint. */
export interface ChromeAttachConfig extends BrowserMcpAttachConfig, ChromeCapabilities {}

/**
 * Connect to the person's own running Chrome (version 144 or newer) with its tabs and sign-ins. Chrome must
 * have remote debugging switched on once from chrome://inspect/#remote-debugging.
 */
export interface ChromeConnectConfig extends ChromeCapabilities {
  /** Connect to the running Chrome profile of this channel. */
  mode: 'connect'
  /** Chrome channel whose running browser is used; omission uses stable. */
  channel?: ChromeChannel
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
}

/** Fixed Chromium launch, debugging-endpoint attachment, or connection to the running Chrome. */
export type Config = ChromeLaunchConfig | ChromeAttachConfig | ChromeConnectConfig

const channel = Schema.union(['stable', 'beta', 'dev', 'canary'] as const)

/** Accepted input: a launch may leave `headless` out, which means true. */
export type ConfigInput = (Omit<ChromeLaunchConfig, 'headless'> & { headless?: boolean }) | ChromeAttachConfig | ChromeConnectConfig

/** Validate the launch, attachment or connection configuration before activation. */
export const Config: Schema<ConfigInput, Config> = Schema.union([
  Schema.object({
    mode: Schema.const('launch').required(),
    headless: Schema.boolean().default(true),
    executablePath: Schema.string().pattern(/\S/u),
    toolCallTimeoutMs: Schema.number().min(1),
    isolated: Schema.boolean(),
    userDataDir: Schema.string().pattern(/\S/u),
    channel,
    viewport: Schema.string().pattern(/^\d+x\d+$/u),
    vision: Schema.boolean(),
    screenshotMaxWidth: Schema.natural().min(320),
  }),
  Schema.object({
    mode: Schema.const('attach').required(),
    endpoint: Schema.string().pattern(/^https?:\/\/[^\s/]+|^wss?:\/\/[^\s/]+/u).required(),
    toolCallTimeoutMs: Schema.number().min(1),
    vision: Schema.boolean(),
    screenshotMaxWidth: Schema.natural().min(320),
  }),
  Schema.object({
    mode: Schema.const('connect').required(),
    channel,
    toolCallTimeoutMs: Schema.number().min(1),
    vision: Schema.boolean(),
    screenshotMaxWidth: Schema.natural().min(320),
  }),
])

/**
 * Upstream server arguments for one configuration.
 * @param config - validated browser choice.
 * @returns arguments after the server entry point.
 */
export function chromeArgs(config: Config): string[] {
  const args = ['--no-usage-statistics']
  if (config.mode === 'attach') {
    args.push(/^wss?:/u.test(config.endpoint) ? '--ws-endpoint' : '--browser-url', config.endpoint)
  } else if (config.mode === 'connect') {
    args.push('--auto-connect')
    if (config.channel !== undefined) args.push('--channel', config.channel)
  } else {
    if (config.isolated !== false) args.push('--isolated')
    args.push(`--headless=${String(config.headless)}`)
    if (config.executablePath !== undefined) args.push('--executable-path', config.executablePath)
    if (config.isolated === false && config.userDataDir !== undefined) args.push('--user-data-dir', config.userDataDir)
    if (config.channel !== undefined) args.push('--channel', config.channel)
    if (config.viewport !== undefined) args.push('--viewport', config.viewport)
  }
  if (config.vision === true) args.push('--experimental-vision')
  if (config.screenshotMaxWidth !== undefined) args.push('--screenshot-max-width', String(config.screenshotMaxWidth))
  return args
}

/**
 * Expose Chrome DevTools' upstream catalog through one MCP process per live Session.
 * Attached and connected browsers remain externally owned; the server disables usage statistics.
 * @param ctx - provider context supplying browser use, Agents, and tools.
 * @param config - validated browser choice and optional tool timeout.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.mode === 'attach') validateBrowserMcpConfig(config)
  const cli = fileURLToPath(import.meta.resolve('chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'))
  mountSessionMcp(ctx, {
    name: 'chrome-devtools-mcp',
    // One Session at a time may drive a browser the person already owns.
    exclusive: config.mode !== 'launch',
    command: process.execPath,
    args: [cli, ...chromeArgs(config)],
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
  })
}
