/** Operator-only signed packaging; default checks do not launch children, sign, install, or publish. */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { InstalledUpdateSigningHoldError, packageInstalledUpdate } from './installed-update-packaging.ts'

async function main(): Promise<void> {
  const [manifest, version, mode, ...extra] = process.argv.slice(2)
  if (!manifest || !version || extra.length !== 0 || (mode !== undefined && mode !== '--check' && mode !== '--execute')) {
    throw new Error('invalid invocation')
  }
  const result = await packageInstalledUpdate(manifest, version, { execute: mode === '--execute',
    confirm: async (id, selectedVersion) => {
      if (!stdin.isTTY || !stdout.isTTY) return false
      const terminal = createInterface({ input: stdin, output: stdout })
      try {
        console.log('Continue only after an administrator has reviewed and restored signature protection. Confirm the token is revoked, the remaining count is 5/5, the PIN is correct, and no other signing task is running.')
        console.log('This packaging performs several signatures; do not retry failed operations, because the driver cannot guarantee the internal authentication count. Cancel any password prompt instead of entering it again.')
        console.log('The PIN is read only from .env.windows; the signing interface requires it to appear briefly in the SignTool arguments. Nothing is installed or uploaded.')
        const expected = `PACKAGE ${selectedVersion} ${id}`
        return (await terminal.question(`Enter ${expected} to authorize this version only: `)) === expected
      } finally { terminal.close() }
    } })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof InstalledUpdateSigningHoldError ? error.message
    : 'installed update packaging stopped. Check prepared files and the retained record; do not retry or remove protection automatically.')
  process.exitCode = 1
})
