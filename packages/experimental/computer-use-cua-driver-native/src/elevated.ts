/**
 * Real input for windows of apps that run as administrator. Windows drops input that a normal process sends to an
 * elevated window, so input for such a window goes through a helper started with "Run as administrator": the person
 * approves its UAC prompt once per session. The helper accepts only a fixed set of input commands, never scripts,
 * over a named pipe that only this user may open, after checking the connecting process and a one-time secret. It
 * exits when the connection closes. UAC prompts and the lock screen stay out of reach: Windows keeps them on the
 * secure desktop, which no process can drive.
 * @module @hackdevcode/dsh-experimental-computer-use-cua-driver-native/elevated
 */

import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'

/** One input operation, the same for the normal session and the administrator helper. */
export type InputOp =
  | { op: 'chord'; vks: readonly number[] }
  | { op: 'text'; text: string }
  | { op: 'move'; x: number; y: number }
  | { op: 'click'; mods: readonly number[]; down: number; up: number; count: number }
  | { op: 'drag'; x1: number; y1: number; x2: number; y2: number; down: number; up: number }
  | { op: 'wheel'; x: number; y: number; clicks: number; horizontal: boolean }
  | { op: 'act'; handle: number; action: 'focus' | 'minimize' | 'maximize' | 'restore' | 'close' }
  | { op: 'place'; handle: number; x: number; y: number; width: number; height: number }
  | { op: 'sleep'; ms: number }

const int = (value: number): string => String(Math.trunc(Math.round(value)))
const vkList = (vks: readonly number[]): string => vks.map(vk => int(vk)).join(',')

/**
 * The PowerShell statement that performs one operation in a session that has `HackDev.Desk` loaded.
 * @param op - the operation.
 * @returns one statement.
 */
export function opScript(op: InputOp): string {
  switch (op.op) {
    case 'chord': return `[HackDev.Desk]::Chord([uint16[]]@(${vkList(op.vks)}))`
    case 'text': return `[HackDev.Desk]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(op.text, 'utf8').toString('base64')}')))`
    case 'move': return `[HackDev.Desk]::Move(${int(op.x)}, ${int(op.y)})`
    case 'click': return op.mods.length === 0
      ? `[HackDev.Desk]::Click(${int(op.down)}, ${int(op.up)}, ${int(op.count)})`
      : `[HackDev.Desk]::ClickWith([uint16[]]@(${vkList(op.mods)}), ${int(op.down)}, ${int(op.up)}, ${int(op.count)})`
    case 'drag': return `[HackDev.Desk]::Drag(${int(op.x1)}, ${int(op.y1)}, ${int(op.x2)}, ${int(op.y2)}, ${int(op.down)}, ${int(op.up)})`
    case 'wheel': return `[HackDev.Desk]::Wheel(${int(op.x)}, ${int(op.y)}, ${int(op.clicks)}, $${String(op.horizontal)})`
    case 'act': return `[HackDev.Desk]::Act([IntPtr]${int(op.handle)}, '${op.action}')`
    case 'place': return `[HackDev.Desk]::Place([IntPtr]${int(op.handle)}, ${int(op.x)}, ${int(op.y)}, ${int(op.width)}, ${int(op.height)})`
    case 'sleep': return `Start-Sleep -Milliseconds ${int(op.ms)}`
  }
}

/**
 * The line the administrator helper parses for one operation: a verb and numbers, or base64 text.
 * @param op - the operation.
 * @returns one command line without the request id.
 */
export function opCommand(op: InputOp): string {
  switch (op.op) {
    case 'chord': return `chord ${vkList(op.vks) || '0'}`
    case 'text': return `text ${Buffer.from(op.text, 'utf8').toString('base64')}`
    case 'move': return `move ${int(op.x)} ${int(op.y)}`
    case 'click': return `click ${vkList(op.mods) || '-'} ${int(op.down)} ${int(op.up)} ${int(op.count)}`
    case 'drag': return `drag ${int(op.x1)} ${int(op.y1)} ${int(op.x2)} ${int(op.y2)} ${int(op.down)} ${int(op.up)}`
    case 'wheel': return `wheel ${int(op.x)} ${int(op.y)} ${int(op.clicks)} ${op.horizontal ? '1' : '0'}`
    case 'act': return `act ${int(op.handle)} ${op.action}`
    case 'place': return `place ${int(op.handle)} ${int(op.x)} ${int(op.y)} ${int(op.width)} ${int(op.height)}`
    case 'sleep': return `sleep ${int(op.ms)}`
  }
}

/**
 * The administrator helper's PowerShell script. Its command table maps each verb to one `HackDev.Desk` call with
 * integer arguments, so a connected client can send input and nothing else. It serves one connection from one
 * process, dropping connections from any other process, waits at most a minute for it, and exits when it closes.
 * @param deskSource - the `HackDev.Desk` C# source.
 * @param pipeName - pipe name without the `\\.\pipe\` prefix.
 * @param secret - one-time secret the client sends first.
 * @param clientPid - the only process allowed to connect.
 * @returns the script.
 */
export function helperScript(deskSource: string, pipeName: string, secret: string, clientPid: number): string {
  const packed = gzipSync(Buffer.from(deskSource, 'utf8')).toString('base64')
  return String.raw`
$ErrorActionPreference = 'Stop'
$zip = [IO.Compression.GZipStream]::new([IO.MemoryStream]::new([Convert]::FromBase64String('${packed}')), [IO.Compression.CompressionMode]::Decompress)
Add-Type -TypeDefinition ([IO.StreamReader]::new($zip).ReadToEnd())
[HackDev.Desk]::Init()
$security = [System.IO.Pipes.PipeSecurity]::new()
$security.AddAccessRule([System.IO.Pipes.PipeAccessRule]::new([System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'ReadWrite', 'Allow'))
# One instance only: if another process already owns this name, creating the pipe fails and the helper exits.
$pipe = [System.IO.Pipes.NamedPipeServerStream]::new('${pipeName}', 'InOut', 1, 'Byte', 'Asynchronous', 65536, 65536, $security)
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  # Another process connecting first is dropped and the wait goes on, so it cannot knock the helper out.
  while ($true) {
    $left = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    if ($left -eq 0 -or -not $pipe.WaitForConnectionAsync().Wait($left)) { exit 2 }
    $client = [uint32]0
    [void][HackDev.Desk]::GetNamedPipeClientProcessId($pipe.SafePipeHandle.DangerousGetHandle(), [ref]$client)
    if ($client -eq ${String(clientPid)}) { break }
    $pipe.Disconnect()
  }
  $reader = [IO.StreamReader]::new($pipe, $utf8)
  $writer = [IO.StreamWriter]::new($pipe, $utf8)
  $writer.AutoFlush = $true
  if ($reader.ReadLine() -ne '${secret}') { exit 1 }
  $writer.WriteLine('READY')
  $ints = { param($text) @($text.Split(',') | ForEach-Object { [int]$_ }) }
  while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    $part = $line.Split(' ')
    $id = $part[0]
    try {
      switch -CaseSensitive ($part[1]) {
        'chord' { [HackDev.Desk]::Chord([uint16[]](& $ints $part[2])) }
        'text' { [HackDev.Desk]::Text($utf8.GetString([Convert]::FromBase64String($part[2]))) }
        'move' { [HackDev.Desk]::Move([int]$part[2], [int]$part[3]) }
        'click' {
          if ($part[2] -eq '-') { [HackDev.Desk]::Click([uint32]$part[3], [uint32]$part[4], [int]$part[5]) }
          else { [HackDev.Desk]::ClickWith([uint16[]](& $ints $part[2]), [uint32]$part[3], [uint32]$part[4], [int]$part[5]) }
        }
        'drag' { [HackDev.Desk]::Drag([int]$part[2], [int]$part[3], [int]$part[4], [int]$part[5], [uint32]$part[6], [uint32]$part[7]) }
        'wheel' { [HackDev.Desk]::Wheel([int]$part[2], [int]$part[3], [int]$part[4], $part[5] -eq '1') }
        'act' {
          if (@('focus', 'minimize', 'maximize', 'restore', 'close') -cnotcontains $part[3]) { throw "unknown window action $($part[3])" }
          [HackDev.Desk]::Act([IntPtr][long]$part[2], $part[3])
        }
        'place' { [HackDev.Desk]::Place([IntPtr][long]$part[2], [int]$part[3], [int]$part[4], [int]$part[5], [int]$part[6]) }
        'sleep' { Start-Sleep -Milliseconds ([Math]::Min(10000, [int]$part[2])) }
        default { throw "unknown command $($part[1])" }
      }
      $writer.WriteLine("$id OK")
    } catch {
      $writer.WriteLine("$id ERR " + [Convert]::ToBase64String($utf8.GetBytes($_.Exception.Message)))
    }
  }
} finally {
  $pipe.Dispose()
}
`
}

/**
 * Starts the helper process with its script and resolves with that process's id once it is started; rejects when
 * the person declines. Only a pipe served by exactly this process receives input.
 */
export type HelperLauncher = (script: string, signal?: AbortSignal) => Promise<number>

/** Runs one script in the normal PowerShell session that has `HackDev.Desk` loaded. */
export type SessionRunner = (script: string, timeoutMs?: number, signal?: AbortSignal) => Promise<string>

/** Quote a value for a single-quoted PowerShell string. */
function quote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/**
 * Wait for a shared operation, but let one caller stop waiting when its own signal aborts.
 * @param operation - the shared operation; it continues for other callers.
 * @param signal - this caller's signal.
 * @returns the operation's outcome, unless the signal aborts first.
 */
function untilAborted(operation: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return operation
  return new Promise<void>((resolve, reject) => {
    const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('the wait was cancelled')) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    operation.then(
      () => { signal.removeEventListener('abort', abort); resolve() },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/** Error text that means the helper is gone and must be started again. */
const HELPER_GONE = 'the administrator helper exited'

/** Error text from a session that lost the connection (it restarted) before anything was sent. */
const NOT_CONNECTED = 'the desktop session has no administrator helper connection'

/**
 * Client for one administrator helper. The connection lives in the normal PowerShell session, which checks that
 * the pipe is served by exactly the process started through the UAC prompt before sending anything, so a same-user
 * process that grabbed the pipe name first cannot receive input meant for administrator windows. The helper starts
 * on first use and is reused until `close`.
 */
export class ElevatedInput {
  private connected = false
  private closed = false
  private starting: Promise<void> | undefined

  /**
   * @param deskSource - the `HackDev.Desk` C# source for the helper.
   * @param launch - starts the helper process, normally with "Run as administrator".
   * @param session - the normal PowerShell session, which owns the connection.
   * @param options - `connectTimeoutMs` for the helper's pipe after launch.
   */
  constructor(
    private readonly deskSource: string,
    private readonly launch: HelperLauncher,
    private readonly session: SessionRunner,
    private readonly options: { connectTimeoutMs?: number } = {},
  ) {}

  /**
   * Perform operations in order through the helper.
   * @param ops - operations.
   * @param signal - cancels waiting for the helper and stops sending; input already delivered stays delivered.
   * @returns once every operation finished.
   */
  async run(ops: readonly InputOp[], signal?: AbortSignal): Promise<void> {
    try {
      await this.send(ops, signal)
    } catch (error) {
      // The session restarted and lost the connection before sending anything: start a helper and try once more.
      if (!(error instanceof Error) || !error.message.includes(NOT_CONNECTED)) throw error
      this.connected = false
      await this.send(ops, signal)
    }
  }

  private async send(ops: readonly InputOp[], signal?: AbortSignal): Promise<void> {
    await this.ensure(signal)
    const lines = ops.map(opCommand)
    const textLength = ops.reduce((sum, op) => sum + (op.op === 'text' ? op.text.length : 0), 0)
    const sleeping = ops.reduce((sum, op) => sum + (op.op === 'sleep' ? op.ms : 0), 0)
    try {
      await this.session(`$a = $global:hackdevAdmin; if ($null -eq $a) { throw '${NOT_CONNECTED}' }
foreach ($line in @(${lines.map(quote).join(', ')})) {
  $id = [guid]::NewGuid().ToString('N')
  try { $a.writer.WriteLine("$id $line") } catch { $global:hackdevAdmin = $null; throw '${HELPER_GONE}' }
  $reply = $a.reader.ReadLine()
  if ($null -eq $reply) { $global:hackdevAdmin = $null; throw '${HELPER_GONE}' }
  $part = $reply.Split(' ')
  if ($part[1] -ne 'OK') { throw [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part[2])) }
}`, 30_000 + textLength * 2 + sleeping, signal)
    } catch (error) {
      if (error instanceof Error && error.message.includes(HELPER_GONE)) this.connected = false
      throw error
    }
  }

  /** Disconnect; the helper exits. Closing the session that owns the connection has the same effect. */
  close(): void {
    this.closed = true
    if (!this.connected) return
    this.connected = false
    void this.session('if ($null -ne $global:hackdevAdmin) { $global:hackdevAdmin.pipe.Dispose(); $global:hackdevAdmin = $null }').catch(() => {})
  }

  private isClosed(): boolean {
    return this.closed
  }

  /**
   * Make sure the helper is running and connected, starting it (with its UAC prompt) when needed.
   * @param signal - stops this caller's wait; a start-up shared with other callers goes on for them.
   * @returns once connected.
   */
  prepare(signal?: AbortSignal): Promise<void> {
    return this.ensure(signal)
  }

  private ensure(signal?: AbortSignal): Promise<void> {
    if (this.closed) return Promise.reject(new Error('the administrator helper was closed'))
    if (this.connected) return Promise.resolve()
    this.starting ??= this.start().finally(() => { this.starting = undefined })
    return untilAborted(this.starting, signal)
  }

  private async start(): Promise<void> {
    const pipeName = `hackdev-desk-${randomBytes(12).toString('hex')}`
    const secret = randomBytes(24).toString('hex')
    const clientPid = Number((await this.session('$PID')).trim())
    if (!Number.isInteger(clientPid) || clientPid <= 0) throw new Error('could not identify the desktop session process')
    const helperPid = await this.launch(helperScript(this.deskSource, pipeName, secret, clientPid))
    if (!Number.isInteger(helperPid) || helperPid <= 0) throw new Error('could not identify the administrator helper process')
    if (this.isClosed()) throw new Error('the administrator helper was closed')
    const timeout = this.options.connectTimeoutMs ?? 20_000
    await this.session(`$global:hackdevAdmin = $null
$c = [System.IO.Pipes.NamedPipeClientStream]::new('.', '${pipeName}', [System.IO.Pipes.PipeDirection]::InOut)
try { $c.Connect(${String(timeout)}) } catch { $c.Dispose(); throw 'the administrator helper did not start in time' }
try {
  $server = [uint32]0
  if (-not [HackDev.Desk]::GetNamedPipeServerProcessId($c.SafePipeHandle.DangerousGetHandle(), [ref]$server)) { throw 'could not identify the administrator helper process' }
  if ($server -ne ${String(helperPid)}) { throw 'the administrator helper pipe is served by another process; nothing was sent to it' }
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $r = [IO.StreamReader]::new($c, $utf8)
  $w = [IO.StreamWriter]::new($c, $utf8)
  $w.AutoFlush = $true
  $w.WriteLine('${secret}')
  if ($r.ReadLine() -ne 'READY') { throw 'the administrator helper refused the connection' }
  $global:hackdevAdmin = @{ pipe = $c; reader = $r; writer = $w }
} catch { $c.Dispose(); throw }`, timeout + 15_000)
    // close() may run while the connection is being set up.
    if (this.isClosed()) {
      void this.session('if ($null -ne $global:hackdevAdmin) { $global:hackdevAdmin.pipe.Dispose(); $global:hackdevAdmin = $null }').catch(() => {})
      throw new Error('the administrator helper was closed')
    }
    this.connected = true
  }
}
