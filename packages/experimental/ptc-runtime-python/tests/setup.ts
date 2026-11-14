import { Context } from '@hackdevcode/cordis'
import Sandbox from '@hackdevcode/dsh-sandbox-local'
import SandboxPolicy from '@hackdevcode/dsh-sandbox-policy'
import SessionProjections from '@hackdevcode/dsh-session-projection'
import { onTestFinished } from 'vitest'
import type { SandboxMode } from '@hackdevcode/dsh-sandbox'

/** Mount the Python runtime's policy and confinement providers with owned teardown. */
export async function createRuntimeContext(policy: { mode?: SandboxMode; workspaceRoot?: string } = {}): Promise<Context> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Sandbox, {})
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  return ctx
}
