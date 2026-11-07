/**
 * One long-lived Windows PowerShell process for desktop helpers. Starting PowerShell and compiling the native
 * helper takes a second or more, so the process and its prelude are kept and reused; scripts run one at a time.
 * @module @hackdevcode/dsh-experimental-computer-use-cua-driver-native/powershell
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

/** Runs one PowerShell script and resolves with its output text. */
export type ScriptRunner = (script: string) => Promise<string>

/** Starts the PowerShell process; replaceable in tests. */
export type PowerShellSpawner = () => ChildProcessWithoutNullStreams

const defaultSpawner: PowerShellSpawner = () => spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', '-'], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
})

/** Encode text as base64 UTF-8, the only form the protocol puts on a line. */
function encode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

/**
 * The single-line wrapper sent for each script. Output and error text travel base64-encoded before an end marker,
 * so script output can never be mistaken for the marker.
 * @param script - script text.
 * @param id - request number.
 * @returns the line to write.
 */
export function wrapScript(script: string, id: number): string {
  const decode = (variable: string): string => `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${variable}))`
  return `try { $__o = (& ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(script)}')))) | Out-String); `
    + `[Console]::Out.WriteLine(${decode('$__o')} + ' <<OK:${String(id)}>>') } `
    + `catch { [Console]::Out.WriteLine(${decode('$_.Exception.Message')} + ' <<ERR:${String(id)}>>') }; [Console]::Out.Flush()\n`
}

/** A pending request waiting for its marker. */
interface Waiter {
  readonly id: number
  readonly resolve: (output: string) => void
  readonly reject: (error: Error) => void
}

/** A reusable PowerShell session that runs `prelude` once after each start. */
export class PowerShellHost {
  private child: ChildProcessWithoutNullStreams | undefined
  private buffer = ''
  private waiter: Waiter | undefined
  private nextId = 1
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  /**
   * @param prelude - script run once in every new process, such as type definitions.
   * @param spawner - process factory.
   * @param timeoutMs - limit for one script; on timeout the process is restarted.
   */
  constructor(
    private readonly prelude: string,
    private readonly spawner: PowerShellSpawner = defaultSpawner,
    private readonly timeoutMs = 30_000,
  ) {}

  /**
   * Run one script after any earlier one finishes.
   * @param script - PowerShell script text; it may span lines.
   * @param timeoutMs - limit for this script instead of the session default, such as while a person answers a prompt.
   * @param signal - cancels the caller's wait at once. A script still queued never starts. A script already running
   *   finishes, because stopping it midway could leave a key or mouse button held down; only its result is dropped.
   * @returns its output with trailing whitespace removed.
   */
  run(script: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> {
    const next = this.queue.then(() => this.execute(script, timeoutMs, signal))
    this.queue = next.catch(() => {})
    if (signal === undefined) return next
    return new Promise<string>((resolve, reject) => {
      const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('the desktop step was cancelled')) }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      next.then(
        (output) => { signal.removeEventListener('abort', abort); resolve(output) },
        (error: unknown) => { signal.removeEventListener('abort', abort); reject(error instanceof Error ? error : new Error(String(error))) },
      )
    })
  }

  /** Stop the process; later calls fail. */
  close(): void {
    this.closed = true
    this.stop(new Error('the desktop helper was closed'))
  }

  private async execute(script: string, timeoutMs = this.timeoutMs, signal?: AbortSignal): Promise<string> {
    if (this.closed) throw new Error('the desktop helper was closed')
    signal?.throwIfAborted()
    if (this.child === undefined) {
      this.start()
      await this.send(this.prelude, this.timeoutMs)
    }
    // Checked once more right before sending: after this point the script runs to its end.
    signal?.throwIfAborted()
    return this.send(script, timeoutMs)
  }

  private start(): void {
    const child = this.spawner()
    this.child = child
    this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { this.receive(chunk) })
    child.stderr.resume()
    // A write to a session that is exiting fails with EPIPE; the exit handler settles the pending step.
    child.stdin.on('error', () => {})
    child.on('error', (error) => { if (this.child === child) this.stop(error) })
    child.on('exit', (code) => { if (this.child === child) this.stop(new Error(`the desktop helper exited with ${String(code)}`)) })
  }

  private send(script: string, timeoutMs: number): Promise<string> {
    const child = this.child
    if (child === undefined) return Promise.reject(new Error('the desktop helper is not running'))
    const id = this.nextId++
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop(new Error(`a desktop helper step took longer than ${String(timeoutMs / 1000)} s`))
      }, timeoutMs)
      this.waiter = {
        id,
        resolve: (output) => { clearTimeout(timer); resolve(output) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      }
      child.stdin.write(wrapScript(script, id))
    })
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      // Empty output leaves only the marker once the line is trimmed.
      const match = /^([A-Za-z0-9+/=]*) ?<<(OK|ERR):(\d+)>>$/u.exec(line)
      const waiter = this.waiter
      if (match !== null && waiter !== undefined && Number(match[3]) === waiter.id) {
        this.waiter = undefined
        const text = Buffer.from(match[1] ?? '', 'base64').toString('utf8').trimEnd()
        if (match[2] === 'OK') waiter.resolve(text)
        else waiter.reject(new Error(text.length > 0 ? text : 'the desktop helper step failed'))
      }
      newline = this.buffer.indexOf('\n')
    }
  }

  private stop(error: Error): void {
    const child = this.child
    this.child = undefined
    const waiter = this.waiter
    this.waiter = undefined
    if (child !== undefined) {
      child.stdin.end()
      child.kill()
    }
    waiter?.reject(error)
  }
}
