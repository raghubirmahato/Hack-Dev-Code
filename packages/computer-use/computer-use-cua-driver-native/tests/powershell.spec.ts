import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { PowerShellHost, wrapScript } from '../src/powershell.ts'

/** A stand-in PowerShell that answers every wrapped script line by decoding and echoing it. */
function fakePowerShell(answer: (script: string) => { ok: boolean; text: string } | 'hang'): { spawn: () => ChildProcessWithoutNullStreams; scripts: string[]; spawned: () => number; killed: () => number } {
  const scripts: string[] = []
  let spawned = 0
  let killed = 0
  const spawn = (): ChildProcessWithoutNullStreams => {
    spawned++
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => { killed++; return true } })
    let pending = ''
    stdin.setEncoding('utf8')
    stdin.on('data', (chunk: string) => {
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        const encoded = /FromBase64String\('([^']*)'\)/u.exec(line)?.[1] ?? ''
        const id = /<<OK:(\d+)>>/u.exec(line)?.[1] ?? '0'
        const script = Buffer.from(encoded, 'base64').toString('utf8')
        scripts.push(script)
        const reply = answer(script)
        if (reply !== 'hang') {
          stdout.write(`noise from the host\r\n${Buffer.from(reply.text, 'utf8').toString('base64')} <<${reply.ok ? 'OK' : 'ERR'}:${id}>>\r\n`)
        }
        newline = pending.indexOf('\n')
      }
    })
    return child as unknown as ChildProcessWithoutNullStreams
  }
  return { spawn, scripts, spawned: () => spawned, killed: () => killed }
}

describe('persistent PowerShell session', () => {
  it('wraps a script on one line with base64 payloads and an end marker', () => {
    const line = wrapScript("Write-Output 'a'\nWrite-Output 'b'", 7)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(line).toContain(Buffer.from("Write-Output 'a'\nWrite-Output 'b'", 'utf8').toString('base64'))
    expect(line).toContain("' <<OK:7>>'")
    expect(line).toContain("' <<ERR:7>>'")
  })

  it('runs the prelude once, then scripts in order, ignoring other output', async () => {
    const fake = fakePowerShell(script => ({ ok: true, text: `ran ${script}\n` }))
    const host = new PowerShellHost('PRELUDE', fake.spawn)
    const results = await Promise.all([host.run('one'), host.run('two'), host.run('three')])
    expect(results).toEqual(['ran one', 'ran two', 'ran three'])
    expect(fake.scripts).toEqual(['PRELUDE', 'one', 'two', 'three'])
    expect(fake.spawned()).toBe(1)
    host.close()
    await expect(host.run('four')).rejects.toThrow('closed')
  })

  it('finishes a step that prints nothing', async () => {
    const fake = fakePowerShell(() => ({ ok: true, text: '' }))
    const host = new PowerShellHost('PRELUDE', fake.spawn, 2000)
    await expect(host.run('Start-Sleep 0')).resolves.toBe('')
    host.close()
  })

  it('reports script errors without restarting the session', async () => {
    const fake = fakePowerShell(script => script === 'bad' ? { ok: false, text: 'Windows blocked the input' } : { ok: true, text: 'fine' })
    const host = new PowerShellHost('PRELUDE', fake.spawn)
    await expect(host.run('bad')).rejects.toThrow('Windows blocked the input')
    await expect(host.run('good')).resolves.toBe('fine')
    expect(fake.spawned()).toBe(1)
    host.close()
  })

  it('restarts the process after a step times out', async () => {
    let hang = true
    const fake = fakePowerShell(script => script === 'slow' && hang ? 'hang' : { ok: true, text: script })
    const host = new PowerShellHost('PRELUDE', fake.spawn, 200)
    await expect(host.run('slow')).rejects.toThrow('took longer than 0.2 s')
    hang = false
    await expect(host.run('slow')).resolves.toBe('slow')
    expect(fake.spawned()).toBe(2)
    expect(fake.killed()).toBe(1)
    expect(fake.scripts).toEqual(['PRELUDE', 'slow', 'PRELUDE', 'slow'])
    host.close()
  })
})

describe('cancelling a session step', () => {
  it('never starts a cancelled step, and lets a running step finish while its caller stops waiting', async () => {
    const fake = fakePowerShell(script => script === 'slow' ? 'hang' : { ok: true, text: script })
    const host = new PowerShellHost('PRELUDE', fake.spawn, 400)
    await expect(host.run('first', undefined, AbortSignal.abort())).rejects.toThrow()
    const controller = new AbortController()
    const running = host.run('slow', undefined, controller.signal)
    const queued = host.run('queued', undefined, controller.signal)
    const started = Date.now()
    setTimeout(() => { controller.abort() }, 50)
    await expect(running).rejects.toThrow()
    await expect(queued).rejects.toThrow()
    // Both callers return at once; the running step is not killed, since that could leave a key held down.
    expect(Date.now() - started).toBeLessThan(300)
    expect(fake.killed()).toBe(0)
    // The step ends on its own (here by the session's time limit), and the queued one never runs.
    await expect(host.run('after')).resolves.toBe('after')
    expect(fake.scripts).not.toContain('first')
    expect(fake.scripts).not.toContain('queued')
    host.close()
  })
})
