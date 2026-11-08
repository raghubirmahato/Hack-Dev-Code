/**
 * Start with administrator rights on Windows. A packaged app that is not elevated asks once at startup, through
 * Windows' own UAC prompt, to restart itself as administrator, so the agent and everything it starts (shells,
 * installers, administrator apps it drives) have full control of the machine. Declining keeps the app running
 * without elevation. `HACKDEV_RUN_AS_ADMIN=0` or the `--no-admin` argument turns the request off.
 */

import { execFileSync } from 'node:child_process'

/** Argument the elevated copy receives, so a failed or silent elevation never asks again in a loop. */
export const ELEVATION_ATTEMPT_ARG = '--hackdev-elevation-attempted'

/** Runs a program synchronously; replaceable in tests. */
export type SyncRunner = (file: string, args: readonly string[], timeoutMs: number) => string

const runSync: SyncRunner = (file, args, timeoutMs) => execFileSync(file, [...args], {
  encoding: 'utf8', windowsHide: true, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
})

/** What the startup check decided. */
export type ElevationOutcome = 'elevated' | 'not-needed' | 'relaunched' | 'declined' | 'failed'

/** Facts the decision needs, gathered by the caller. */
export interface ElevationRequest {
  platform: NodeJS.Platform
  packaged: boolean
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  execPath: string
  cwd: string
}

/**
 * Whether this process runs as administrator: `net session` succeeds only for an elevated administrator.
 * @param run - program runner.
 * @returns true when elevated.
 */
export function isElevated(run: SyncRunner = runSync): boolean {
  try {
    run('net', ['session'], 10_000)
    return true
  } catch {
    return false
  }
}

/**
 * Quote one argument for a PowerShell single-quoted string; the curly single quotes PowerShell also ends such a
 * string at are doubled too.
 */
function psQuote(value: string): string {
  return `'${value.replace(/['‘’‚‛]/gu, mark => mark + mark)}'`
}

/**
 * The PowerShell command that starts an elevated copy and prints `STARTED`, or `DECLINED` when the person declines
 * the UAC prompt (Win32 error 1223, whatever the display language).
 * @param execPath - the app executable.
 * @param args - its arguments, including the attempt marker.
 * @param cwd - working folder.
 * @returns the script.
 */
export function relaunchScript(execPath: string, args: readonly string[], cwd: string): string {
  const list = args.length === 0 ? '' : ` -ArgumentList @(${args.map(arg => psQuote(arg.includes(' ') ? `"${arg}"` : arg)).join(', ')})`
  return `$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules'); try { Start-Process -FilePath ${psQuote(execPath)}${list} `
    + `-WorkingDirectory ${psQuote(cwd)} -Verb RunAs -ErrorAction Stop; 'STARTED' } catch { `
    + '$e = $_.Exception; while ($null -ne $e -and -not ($e -is [System.ComponentModel.Win32Exception])) { $e = $e.InnerException }; '
    + "if ($null -ne $e -and $e.NativeErrorCode -eq 1223) { 'DECLINED' } else { throw } }"
}

/**
 * Ask once at startup to run as administrator. Only a packaged Windows app does this, and never twice: the
 * elevated copy carries {@link ELEVATION_ATTEMPT_ARG}.
 * @param request - process facts.
 * @param run - program runner.
 * @returns what happened; `relaunched` means this process should exit at once.
 */
export function requestStartupElevation(request: ElevationRequest, run: SyncRunner = runSync): ElevationOutcome {
  if (request.platform !== 'win32' || !request.packaged) return 'not-needed'
  if (request.env['HACKDEV_RUN_AS_ADMIN'] === '0' || request.argv.includes('--no-admin')) return 'not-needed'
  if (request.argv.includes(ELEVATION_ATTEMPT_ARG)) return isElevated(run) ? 'elevated' : 'not-needed'
  if (isElevated(run)) return 'elevated'
  const script = relaunchScript(request.execPath, [...request.argv.slice(1), ELEVATION_ATTEMPT_ARG], request.cwd)
  try {
    // The person has up to two minutes to answer the prompt.
    const out = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], 120_000)
    return out.trim().endsWith('DECLINED') ? 'declined' : 'relaunched'
  } catch {
    return 'failed'
  }
}
