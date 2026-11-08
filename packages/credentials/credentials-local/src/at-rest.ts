/**
 * Encryption at rest for the credentials document on Windows, through the Data Protection API (DPAPI) with the
 * current-user scope: only the signed-in Windows account on this machine can open the file, and copying it to
 * another account or machine yields nothing readable. The document keeps its YAML layout inside the sealed blob,
 * so every parse and render rule stays as it is. Secrets travel to PowerShell on standard input, never on a
 * command line another process could read.
 * @module @hackdevcode/dsh-credentials-local/at-rest
 */

import { spawn } from 'node:child_process'

/** Prefix of a sealed document; anything else on disk is read as plain YAML. */
export const SEALED_PREFIX = 'hackdev-dpapi-v1:'

/** Seals and opens document text. */
export interface AtRestCodec {
  /** Encrypt document text into the on-disk form. */
  seal(text: string): Promise<string>
  /** Decrypt an on-disk form that starts with {@link SEALED_PREFIX}. */
  open(sealed: string): Promise<string>
}

/** Runs one PowerShell script with `input` on standard input and resolves with its standard output. */
export type PowerShellRunner = (script: string, input: string) => Promise<string>

/** Extra entropy binding sealed blobs to this use; a blob sealed by another DPAPI user of the account will not open. */
const ENTROPY = 'hackdevcode-credentials-v1'

/**
 * Default runner: Windows PowerShell with no profile and no window, bounded to 30 seconds.
 * @param script - the script, which holds no secret.
 * @param input - the data, written to standard input.
 * @returns the script's standard output, trimmed.
 */
export const runPowerShell: PowerShellRunner = (script, input) => new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  const timer = setTimeout(() => { child.kill() }, 30_000)
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { out += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { err += chunk })
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('close', (code) => {
    clearTimeout(timer)
    // The error text never includes the input: it is base64 on stdin, and the script prints no data on failure.
    if (code === 0) resolve(out.trim())
    else reject(new Error(`the Windows data protection step failed (exit ${String(code)}): ${err.trim().split(/\r?\n/u)[0] ?? ''}`))
  })
  child.stdin.end(input)
})

/**
 * The PowerShell statement that protects or unprotects base64 on standard input and prints base64.
 * @param direction - `Protect` to seal, `Unprotect` to open.
 * @returns the script.
 */
export function dpapiScript(direction: 'Protect' | 'Unprotect'): string {
  return "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; "
    + '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); '
    + `$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}'); `
    + `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${direction}($data, $entropy, 'CurrentUser'))`
}

/**
 * The DPAPI codec.
 * @param run - PowerShell runner; replaceable in tests.
 * @returns the codec.
 */
export function dpapiCodec(run: PowerShellRunner = runPowerShell): AtRestCodec {
  return {
    async seal(text) {
      const sealed = await run(dpapiScript('Protect'), Buffer.from(text, 'utf8').toString('base64'))
      if (!/^[A-Za-z0-9+/=]+$/u.test(sealed)) throw new Error('the Windows data protection step returned no sealed data')
      return `${SEALED_PREFIX}${sealed}\n`
    },
    async open(sealed) {
      const body = sealed.slice(SEALED_PREFIX.length).trim()
      try {
        return Buffer.from(await run(dpapiScript('Unprotect'), body), 'base64').toString('utf8')
      } catch (error) {
        throw new Error('credentials-local: the credentials document is sealed for another Windows account or machine, '
          + 'or is damaged; restore a backup made on this account, or delete it and enter the keys again', { cause: error })
      }
    },
  }
}
