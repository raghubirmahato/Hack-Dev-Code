import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@hackdevcode/dsh-credentials'
import { dpapiCodec, dpapiScript, SEALED_PREFIX } from '../src/at-rest.ts'
import type { PowerShellRunner } from '../src/at-rest.ts'
import { LocalCredentialProvider, resolveSpec } from '../src/index.ts'

const KEY = credentialRef('DSH_AT_REST_TEST')
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-at-rest-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return join(dir, '.credentials.yaml')
}

async function boot(path: string): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false, encryptAtRest: true })
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('the DPAPI codec', () => {
  it('passes the data on standard input, never in the script, and adds the sealed prefix', async () => {
    const calls: { script: string; input: string }[] = []
    const run: PowerShellRunner = async (script, input) => {
      calls.push({ script, input })
      return script.includes('::Protect(') ? 'U0VBTEVE' : Buffer.from('version: 1\n').toString('base64')
    }
    const codec = dpapiCodec(run)
    expect(await codec.seal('version: 1\nrefs:\n  K: secret-value\n')).toBe(`${SEALED_PREFIX}U0VBTEVE\n`)
    expect(calls[0]?.script).not.toContain('secret-value')
    expect(Buffer.from(calls[0]?.input ?? '', 'base64').toString()).toContain('secret-value')
    expect(await codec.open(`${SEALED_PREFIX}U0VBTEVE\n`)).toBe('version: 1\n')
    expect(calls[1]?.input).toBe('U0VBTEVE')
    expect(dpapiScript('Unprotect')).toContain("'CurrentUser'")
  })

  it('explains a blob it cannot open without quoting it', async () => {
    const codec = dpapiCodec(async () => { throw new Error('Key not valid for use in specified state.') })
    await expect(codec.open(`${SEALED_PREFIX}AAAA`)).rejects.toThrow('sealed for another Windows account or machine')
  })

  it('stays off unless asked, and off outside Windows', () => {
    expect(resolveSpec({ path: 'x' }).encryptAtRest).toBe(false)
    expect(resolveSpec({ path: 'x', encryptAtRest: true }).encryptAtRest).toBe(process.platform === 'win32')
  })
})

describe.runIf(process.platform === 'win32')('sealed documents on this Windows account', () => {
  it('stores a key sealed, reads it back in a new process view, and never writes it in clear', async () => {
    const path = await tempFile()
    const first = await boot(path)
    await first.credentials.set(KEY, 'sk-sealed-test-value')
    const disk = await readFile(path, 'utf8')
    expect(disk.startsWith(SEALED_PREFIX)).toBe(true)
    expect(disk).not.toContain('sk-sealed-test-value')
    expect(disk).not.toContain('DSH_AT_REST_TEST')
    const second = await boot(path)
    expect(await second.credentials.resolve(KEY)).toEqual({ value: 'sk-sealed-test-value', source: 'file' })
  }, 60_000)

  it('seals a plain document found at boot, keeping its keys', async () => {
    const path = await tempFile()
    await writeFile(path, 'version: 1\nrefs:\n  DSH_AT_REST_TEST: plain-value\n', { mode: 0o600 })
    const ctx = await boot(path)
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'plain-value', source: 'file' })
    const disk = await readFile(path, 'utf8')
    expect(disk.startsWith(SEALED_PREFIX)).toBe(true)
    expect(disk).not.toContain('plain-value')
  }, 60_000)
})
