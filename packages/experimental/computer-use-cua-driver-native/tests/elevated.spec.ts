import { connect, createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { ElevatedInput, helperScript, opCommand, opScript } from '../src/elevated.ts'
import type { InputOp } from '../src/elevated.ts'
import { DESK_CSHARP, WINDOWS_PRELUDE, helperBootstrap, helperStartCommand, uacLauncher, windowsBackend } from '../src/displays.ts'
import { parseKeys } from '../src/keys.ts'
import { PowerShellHost } from '../src/powershell.ts'

const SAMPLE = 'h\u00e9 1'

const OPS: InputOp[] = [
  { op: 'chord', vks: [0x11, 0x53] },
  { op: 'text', text: SAMPLE },
  { op: 'move', x: -1280.4, y: 20 },
  { op: 'click', mods: [], down: 2, up: 4, count: 2 },
  { op: 'click', mods: [0x11, 0x10], down: 8, up: 16, count: 1 },
  { op: 'drag', x1: 1, y1: 2, x2: 3, y2: 4, down: 2, up: 4 },
  { op: 'wheel', x: 5, y: 6, clicks: -3, horizontal: true },
  { op: 'act', handle: 4242, action: 'close' },
  { op: 'sleep', ms: 60 },
]

describe('input operations', () => {
  it('render as Desk calls for the normal session', () => {
    expect(OPS.map(opScript)).toEqual([
      '[HackDev.Desk]::Chord([uint16[]]@(17,83))',
      `[HackDev.Desk]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(SAMPLE, 'utf8').toString('base64')}')))`,
      '[HackDev.Desk]::Move(-1280, 20)',
      '[HackDev.Desk]::Click(2, 4, 2)',
      '[HackDev.Desk]::ClickWith([uint16[]]@(17,16), 8, 16, 1)',
      '[HackDev.Desk]::Drag(1, 2, 3, 4, 2, 4)',
      '[HackDev.Desk]::Wheel(5, 6, -3, $true)',
      "[HackDev.Desk]::Act([IntPtr]4242, 'close')",
      'Start-Sleep -Milliseconds 60',
    ])
  })

  it('render as space-separated commands with no free text for the administrator helper', () => {
    const commands = OPS.map(opCommand)
    expect(commands).toEqual([
      'chord 17,83',
      `text ${Buffer.from(SAMPLE, 'utf8').toString('base64')}`,
      'move -1280 20',
      'click - 2 4 2',
      'click 17,16 8 16 1',
      'drag 1 2 3 4 2 4',
      'wheel 5 6 -3 1',
      'act 4242 close',
      'sleep 60',
    ])
    for (const command of commands) expect(command).toMatch(/^[a-z]+( [A-Za-z0-9+/=,-]+)*$/u)
  })
})

describe('administrator helper script', () => {
  it('carries the desk source, pipe, secret and allowed client, and runs only its command table', () => {
    const script = helperScript(DESK_CSHARP, 'hackdev-desk-test', 'secret-value', 4321)
    const packed = /FromBase64String\('([A-Za-z0-9+/=]+)'\)\), \[IO\.Compression/u.exec(script)?.[1] ?? ''
    expect(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8')).toBe(DESK_CSHARP)
    expect(script).toContain("NamedPipeServerStream]::new('hackdev-desk-test', 'InOut', 1")
    expect(script).toContain('if ($client -eq 4321) { break }')
    expect(script).toContain('$pipe.Disconnect()')
    expect(script).toContain("if ($reader.ReadLine() -ne 'secret-value') { exit 1 }")
    expect(script).toContain('AddSeconds(60)')
    expect(script).not.toMatch(/Invoke-Expression|iex |\[scriptblock\]::Create\(\$line|\[scriptblock\]::Create\(\$part/iu)
  })
})

describe('administrator helper bootstrap', () => {
  it('locks down modules and the compile folder before running the hash-checked script', () => {
    const hardened = helperBootstrap("C:\\temp\\it's.ps1", 'AB12', true)
    expect(hardened.indexOf("$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')")).toBe(0)
    expect(hardened).toContain("'S-1-5-32-544', 'S-1-5-18'")
    expect(hardened).toContain('SetAccessRuleProtection($true, $false)')
    expect(hardened).toContain("[IO.File]::ReadAllBytes('C:\\temp\\it''s.ps1')")
    expect(hardened).toContain("-ne 'AB12') { exit 1 }")
    expect(hardened.indexOf('$env:TEMP = $t')).toBeLessThan(hardened.indexOf('ReadAllBytes'))
    expect(helperBootstrap('C:\\x.ps1', 'AB12', false)).not.toContain('PSModulePath')
  })

  it.runIf(process.platform === 'win32')('parses as PowerShell without errors', async () => {
    const session = new PowerShellHost('')
    const parseErrors = (script: string): Promise<string> => session.run('$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput('
      + `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(script, 'utf8').toString('base64')}')), [ref]$null, [ref]$e); $e.Count`)
    try {
      expect((await parseErrors(helperBootstrap('C:\\x.ps1', 'AB12', true))).trim()).toBe('0')
      expect((await parseErrors(helperBootstrap('C:\\x.ps1', 'AB12', false))).trim()).toBe('0')
      expect((await parseErrors(helperScript(DESK_CSHARP, 'p', 's', 1))).trim()).toBe('0')
    } finally {
      session.close()
    }
  }, 60_000)
})

/** A stand-in helper on a real named pipe: checks the secret, then answers every command. */
function fakeHelper(
  pipeName: string,
  secret: string,
  fail: (command: string) => string | undefined,
): { server: Server; commands: string[] } {
  const commands: string[] = []
  const server = createServer((socket: Socket) => {
    let buffer = ''
    let authenticated = false
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/u, '')
        buffer = buffer.slice(newline + 1)
        if (!authenticated) {
          authenticated = line === secret
          socket.write(authenticated ? 'READY\n' : 'NO\n')
        } else {
          const [id, ...rest] = line.split(' ')
          const command = rest.join(' ')
          commands.push(command)
          const error = fail(command)
          socket.write(error === undefined ? `${String(id)} OK\n` : `${String(id)} ERR ${Buffer.from(error, 'utf8').toString('base64')}\n`)
        }
        newline = buffer.indexOf('\n')
      }
    })
  })
  server.listen(`\\\\.\\pipe\\${pipeName}`)
  return { server, commands }
}

const servers: Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

/** Start a stand-in helper for the pipe, secret and client a helper script names. */
function startFakeHelper(
  script: string,
  fail: (command: string) => string | undefined = () => undefined,
): { commands: string[]; clientPid: number } {
  const pipe = /NamedPipeServerStream\]::new\('([^']+)'/u.exec(script)?.[1] ?? ''
  const secret = /-ne '([0-9a-f]+)'\) \{ exit 1 \}/u.exec(script)?.[1] ?? ''
  const clientPid = Number(/\$client -eq (\d+)\)/u.exec(script)?.[1] ?? '0')
  const helper = fakeHelper(pipe, secret, fail)
  servers.push(helper.server)
  return { commands: helper.commands, clientPid }
}

describe.runIf(process.platform === 'win32')('administrator helper connection', () => {
  let session: PowerShellHost | undefined
  const runner = (script: string, timeoutMs?: number): Promise<string> => (session as PowerShellHost).run(script, timeoutMs)

  afterEach(() => { session?.close() })

  it('connects from the desktop session, sends each operation and reports helper errors', async () => {
    session = new PowerShellHost(WINDOWS_PRELUDE)
    let launches = 0
    let helper: ReturnType<typeof startFakeHelper> | undefined
    // This test process serves the stand-in pipe, so it is the "launched" helper the session must find.
    const input = new ElevatedInput(DESK_CSHARP, async (script) => {
      launches++
      helper = startFakeHelper(script, command => command.startsWith('act') ? 'no window with handle 9' : undefined)
      return process.pid
    }, runner, { connectTimeoutMs: 5000 })
    try {
      await input.run([{ op: 'chord', vks: [0x5B, 0x52] }, { op: 'text', text: 'x' }])
      await input.run([{ op: 'move', x: 1, y: 2 }])
      await expect(input.run([{ op: 'act', handle: 9, action: 'focus' }])).rejects.toThrow('no window with handle 9')
      expect(launches).toBe(1)
      // A session restart loses the connection; the next call starts a new helper instead of failing.
      await runner('$global:hackdevAdmin = $null')
      await input.run([{ op: 'sleep', ms: 10 }])
      expect(launches).toBe(2)
      expect(helper?.clientPid).toBe(Number(await runner('$PID')))
      expect(helper?.commands).toEqual(['sleep 10'])
    } finally {
      input.close()
    }
  }, 60_000)

  it('sends nothing to a pipe served by any process other than the launched helper', async () => {
    session = new PowerShellHost(WINDOWS_PRELUDE)
    let helper: ReturnType<typeof startFakeHelper> | undefined
    // The launched helper is process 4; this test process grabbed the pipe name first, like an impostor would.
    const launch = async (script: string): Promise<number> => { helper = startFakeHelper(script); return 4 }
    const input = new ElevatedInput(DESK_CSHARP, launch, runner, { connectTimeoutMs: 5000 })
    await expect(input.run([{ op: 'text', text: 'secret text' }])).rejects.toThrow('served by another process; nothing was sent')
    expect(helper?.commands).toEqual([])
    input.close()
  }, 60_000)

  it('reports a declined prompt and a helper that never starts', async () => {
    session = new PowerShellHost(WINDOWS_PRELUDE)
    const declined = new ElevatedInput(DESK_CSHARP, async () => { throw new Error('the person declined the administrator prompt') }, runner)
    await expect(declined.run([{ op: 'sleep', ms: 50 }])).rejects.toThrow('declined')
    const silent = new ElevatedInput(DESK_CSHARP, async () => 4, runner, { connectTimeoutMs: 500 })
    await expect(silent.run([{ op: 'sleep', ms: 50 }])).rejects.toThrow('did not start in time')
  }, 60_000)

  it('runs the real helper script end to end, unelevated', async () => {
    session = new PowerShellHost(WINDOWS_PRELUDE)
    const input = new ElevatedInput(DESK_CSHARP, uacLauncher('Open'), runner, { connectTimeoutMs: 30_000 })
    try {
      // Commands run and errors come back; the pointer is left alone so the test works whatever window is in front.
      await input.run([{ op: 'sleep', ms: 50 }, { op: 'sleep', ms: 50 }])
      await expect(input.run([{ op: 'act', handle: 1, action: 'focus' }])).rejects.toThrow('no window with handle 1')
    } finally {
      input.close()
    }
  }, 90_000)
})

describe('routing input for administrator windows', () => {
  it('sends the same operations through the helper when the session reports an administrator window', async () => {
    const scripts: string[] = []
    const backend = windowsBackend(async (script) => {
      scripts.push(script)
      if (script === '$PID') return '4242'
      return script.includes('Chord([uint16[]]@(65))') ? 'HACKDEV_NEEDS_ELEVATION' : ''
    }, { launchHelper: async () => 999 })
    await backend.keys(parseKeys('b'))
    expect(scripts.some(script => script.includes('hackdevAdmin'))).toBe(false)
    await backend.keys(parseKeys('a'))
    expect(scripts.some(script => script.includes("NamedPipeClientStream]::new('.', 'hackdev-desk-"))).toBe(true)
    expect(scripts.at(-1)).toContain("foreach ($line in @('chord 65'))")
    const off = windowsBackend(async () => 'HACKDEV_NEEDS_ELEVATION', { elevation: 'off' })
    await expect(off.keys(parseKeys('a'))).rejects.toThrow('administrator helper is turned off')
  })
})

describe.runIf(process.platform === 'win32')('administrator helper robustness', () => {
  it('drops a connection from another process and still serves the desktop session', async () => {
    const session = new PowerShellHost(WINDOWS_PRELUDE)
    const runner = (script: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> => session.run(script, timeoutMs, signal)
    const launch = uacLauncher('Open')
    let intruderDropped = false
    const input = new ElevatedInput(DESK_CSHARP, async (script, signal) => {
      const pid = await launch(script, signal)
      const pipe = /NamedPipeServerStream\]::new\('([^']+)'/u.exec(script)?.[1] ?? ''
      // This test process connects first, as another program could; the helper must drop it and keep waiting.
      for (let attempt = 0; attempt < 100 && !intruderDropped; attempt++) {
        intruderDropped = await new Promise<boolean>((resolve) => {
          const intruder = connect(`\\\\.\\pipe\\${pipe}`)
          // ENOENT: the pipe is not there yet. Any other ending (EPIPE, reset, close) means the helper dropped us.
          intruder.once('error', (error: NodeJS.ErrnoException) => { resolve(error.code !== 'ENOENT') })
          intruder.once('connect', () => { intruder.once('close', () => { resolve(true) }); intruder.resume() })
        })
        if (!intruderDropped) await new Promise(resolve => setTimeout(resolve, 100))
      }
      return pid
    }, runner, { connectTimeoutMs: 30_000 })
    try {
      await input.run([{ op: 'sleep', ms: 10 }])
      expect(intruderDropped).toBe(true)
    } finally {
      input.close()
      session.close()
    }
  }, 90_000)

  it('stops waiting for the helper when the turn is cancelled', async () => {
    const session = new PowerShellHost(WINDOWS_PRELUDE)
    const runner = (script: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> => session.run(script, timeoutMs, signal)
    const controller = new AbortController()
    // The start-up is shared and goes on, but this caller stops waiting as soon as its turn is cancelled.
    const input = new ElevatedInput(DESK_CSHARP, async () => {
      controller.abort()
      await new Promise(resolve => setTimeout(resolve, 2000))
      return 4
    }, runner, { connectTimeoutMs: 500 })
    try {
      const started = Date.now()
      await expect(input.run([{ op: 'text', text: 'never' }], controller.signal)).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(1500)
    } finally {
      input.close()
      session.close()
    }
  }, 60_000)
})

describe('paste safety', () => {
  it('types instead of pasting when a clipboard format cannot be saved', async () => {
    const scripts: string[] = []
    const backend = windowsBackend(async (script) => {
      scripts.push(script)
      return script.includes('hackdevClipboardSaved = $false') && script.includes('GetDataObject') ? 'PARTIAL' : ''
    })
    await backend.type('hello', true)
    expect(scripts.some(script => script.includes('[HackDev.Desk]::Text('))).toBe(true)
    expect(scripts.some(script => script.includes('Chord([uint16[]]@(17,86))'))).toBe(false)
    expect(scripts.some(script => script.includes('SetDataObject'))).toBe(false)
  })

  it('reports a paste whose clipboard could not be put back', async () => {
    const backend = windowsBackend(async script => script.includes('GetDataObject') ? 'SAVED' : script.includes('SetDataObject') ? 'LOST' : '')
    await expect(backend.type('hello', true)).rejects.toThrow('could not be put back')
  })

  it('never starts input for a cancelled turn', async () => {
    const scripts: string[] = []
    const backend = windowsBackend(async (script) => { scripts.push(script); return '' })
    await expect(backend.keys(parseKeys('a'), AbortSignal.abort())).rejects.toThrow()
    expect(scripts).toEqual([])
  })
})

describe('paste ordering', () => {
  it('starts the administrator helper before touching the clipboard', async () => {
    const scripts: string[] = []
    const backend = windowsBackend(async (script) => {
      scripts.push(script)
      if (script === '$PID') return '4242'
      if (script.startsWith('if ([HackDev.Desk]::ForegroundNeedsElevation()) {') && !script.includes('else')) return 'HACKDEV_NEEDS_ELEVATION'
      if (script.includes('GetDataObject')) return 'SAVED'
      if (script.includes('SetDataObject')) return 'RESTORED'
      return ''
    }, { launchHelper: async () => 999 })
    await backend.type('hello', true)
    const connect = scripts.findIndex(script => script.includes('NamedPipeClientStream'))
    const replace = scripts.findIndex(script => script.includes('Clipboard]::SetText'))
    expect(connect).toBeGreaterThan(-1)
    expect(replace).toBeGreaterThan(connect)
  })

  it('leaves the clipboard alone when the turn is cancelled before the paste', async () => {
    const scripts: string[] = []
    const backend = windowsBackend(async (script) => { scripts.push(script); return '' })
    await expect(backend.type('hello', true, AbortSignal.abort())).rejects.toThrow()
    expect(scripts.some(script => script.includes('GetDataObject') || script.includes('SetText'))).toBe(false)
  })
})

describe('paste failure reporting', () => {
  it('restores the clipboard and reports both problems when the paste itself fails', async () => {
    let restores = 0
    const backend = windowsBackend(async (script) => {
      if (script.includes('GetDataObject')) return 'SAVED'
      if (script.includes('SetDataObject')) { restores++; return 'LOST' }
      if (script.includes('Chord([uint16[]]@(17,86))')) throw new Error('Windows blocked the input')
      return ''
    })
    await expect(backend.type('hello', true)).rejects.toThrow('the paste failed (Windows blocked the input), and the clipboard')
    expect(restores).toBe(1)
  })
})

describe('launcher and session hardening', () => {
  it('starts the helper with system-only modules and recognizes a declined prompt by its error code', () => {
    const command = helperStartCommand('QUJD', 'RunAs')
    expect(command.indexOf("$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')")).toBe(0)
    expect(command).toContain('-Verb RunAs')
    expect(command).toContain('NativeErrorCode -eq 1223')
    expect(command).not.toMatch(/canceled by the user/iu)
    expect(helperStartCommand('QUJD', 'Open')).not.toContain('-Verb RunAs')
    expect(WINDOWS_PRELUDE.trimStart().startsWith("$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')")).toBe(true)
  })

  it.runIf(process.platform === 'win32')('parses the start command and the session prelude without errors', async () => {
    const session = new PowerShellHost('')
    const parseErrors = (script: string): Promise<string> => session.run('$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput('
      + `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(script, 'utf8').toString('base64')}')), [ref]$null, [ref]$e); $e.Count`)
    try {
      expect((await parseErrors(helperStartCommand('QUJD', 'RunAs'))).trim()).toBe('0')
      expect((await parseErrors(WINDOWS_PRELUDE)).trim()).toBe('0')
    } finally {
      session.close()
    }
  }, 60_000)
})
