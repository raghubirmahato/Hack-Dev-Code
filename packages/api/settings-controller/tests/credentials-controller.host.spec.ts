import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { credentialRef } from '@hackdevcode/dsh-credentials'
import type { CredentialInfo } from '@hackdevcode/dsh-credentials/types'
import { remoteErrorOf, remoteMethods } from '@hackdevcode/dsh-typert-protocol'
import CredentialsController from '../src/credentials.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

/** A store whose `describe` carries more than the view declares, as a foreign provider might. */
class LeakyCredentials extends MemoryCredentials {
  override describe(): Promise<CredentialInfo> {
    return Promise.resolve(
      { configured: true, source: 'memory', writable: true, masked: '•'.repeat(9), value: 'sk-leaked', preview: 'sk…ed' } as CredentialInfo,
    )
  }
}

/** A store whose write rejects with a bare string, the way some client libraries do. */
class LiteralRejectingCredentials extends MemoryCredentials {
  override async set(): Promise<void> {
    throw 'the store refused'
  }
}

/** A store whose provider-owned policy rejects an otherwise valid write. */
class RejectingCredentials extends MemoryCredentials {
  override set(): Promise<void> {
    return Promise.reject(new Error('the stored document no longer parses'))
  }
}

/** A store that previews several keys under one reference, one mask each. */
class ManyKeyCredentials extends MemoryCredentials {
  override describe(): Promise<CredentialInfo> {
    return Promise.resolve({ configured: true, source: 'memory', writable: true, masked: 'a•, b•', maskedEntries: ['a•', 'b•'] })
  }
}

/** Boot the controller over a memory store and hand back both, so a case can read what an edit stored. */
async function bootWithStore(seed: Record<string, string>): Promise<{ controller: CredentialsController; credentials: MemoryCredentials }> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, seed)
  await ctx.plugin(CredentialsController)
  return { controller: ctx.credentialsController, credentials: ctx.credentials as MemoryCredentials }
}

async function boot(
  seed: Record<string, string> = {},
  provider: typeof MemoryCredentials = MemoryCredentials,
): Promise<CredentialsController> {
  const ctx = new Context()
  await ctx.plugin(provider, seed)
  await ctx.plugin(CredentialsController)
  return ctx.credentialsController
}

describe('the credentials Remote namespace a configuration surface calls', () => {
  it('publishes the credentials namespace from its own service key', async () => {
    const controller = await boot()
    const binding = controller.typertRemote
    expect(binding.serviceKey).toBe('credentialsController')
    expect(binding.namespace).toBe('credentials')
    expect(remoteMethods(controller)).toEqual([
      { method: 'describe', invocation: { kind: 'direct' } },
      { method: 'set', invocation: { kind: 'direct' } },
      { method: 'editKeys', invocation: { kind: 'direct' } },
      { method: 'unset', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the actionable configuration error while no credential provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(CredentialsController)
    for (const call of [
      () => ctx.credentialsController.describe(['DEEPSEEK_API_KEY']),
      () => ctx.credentialsController.set('DEEPSEEK_API_KEY', 'sk-live'),
      () => ctx.credentialsController.unset('DEEPSEEK_API_KEY'),
      () => ctx.credentialsController.editKeys('DEEPSEEK_API_KEY', [], 'sk-live', 0),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({
        code: 'gateway/internal',
        message: 'credentials service is absent: this deployment does not mount a credential provider (e.g. @hackdevcode/dsh-credentials-local) in its composition',
        details: {},
      })
    }
  })

  it('describes a batch of references as one map, values excluded', async () => {
    const controller = await boot({ DEEPSEEK_API_KEY: 'sk-seeded' })
    const described = await controller.describe(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'])
    expect(described).toEqual({
      DEEPSEEK_API_KEY: { configured: true, source: 'memory', writable: true },
      OPENAI_API_KEY: { configured: false, writable: true },
    })
    expect(JSON.stringify(described)).not.toContain('sk-seeded')
  })

  it('reports an invalid reference as bad-request', async () => {
    const controller = await boot()
    for (const call of [
      () => controller.describe(['DEEPSEEK_API_KEY', 'not a var']),
      () => controller.set('not a var', 'sk-live'),
      () => controller.unset('not a var'),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('answers the largest batch it accepts and reports one reference more as bad-request', async () => {
    const controller = await boot()
    const accepted = Array.from({ length: 64 }, (_unused, index) => `REF_${String(index)}`)
    expect(Object.keys(await controller.describe(accepted))).toHaveLength(64)
    const failure = await controller.describe([...accepted, 'REF_64']).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('answers only the fields the view declares, whatever a provider returns', async () => {
    const controller = await boot({}, LeakyCredentials)
    const described = await controller.describe(['DEEPSEEK_API_KEY'])
    expect(described.DEEPSEEK_API_KEY).toEqual({ configured: true, source: 'memory', writable: true, masked: '•'.repeat(9) })
    expect(JSON.stringify(described)).not.toContain('sk-leaked')
    expect(JSON.stringify(described)).not.toContain('sk…ed')
  })

  it('stores and removes through the same references the batch describes', async () => {
    const controller = await boot()
    await controller.set('DEEPSEEK_API_KEY', 'sk-live')
    expect(await controller.describe(['DEEPSEEK_API_KEY']))
      .toEqual({ DEEPSEEK_API_KEY: { configured: true, source: 'memory', writable: true } })
    await controller.unset('DEEPSEEK_API_KEY')
    expect(await controller.describe(['DEEPSEEK_API_KEY']))
      .toEqual({ DEEPSEEK_API_KEY: { configured: false, writable: true } })
  })

  it('reports a refused write as credential/rejected naming only the reference', async () => {
    const controller = await boot({}, RejectingCredentials)
    const failure = await controller.set('DEEPSEEK_API_KEY', 'sk-live').catch((error: unknown) => error)
    const { code, message, details } = remoteErrorOf(failure) ?? {}
    expect(code).toBe('credential/rejected')
    expect(message).toContain('no longer parses')
    expect(details).toEqual({ ref: 'DEEPSEEK_API_KEY' })
  })

  it('reports an empty value as bad-request', async () => {
    const controller = await boot()
    const failure = await controller.set('DEEPSEEK_API_KEY', '').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('adds and retires keys by position without the page holding them', async () => {
    const { controller, credentials } = await bootWithStore({ DEEPSEEK_API_KEY: 'sk-one,sk-two' })
    await controller.editKeys('DEEPSEEK_API_KEY', [], 'sk-three, sk-one', 2)
    expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toMatchObject({ value: 'sk-one,sk-two,sk-three' })
    await controller.editKeys('DEEPSEEK_API_KEY', [0, 2], '', 3)
    expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toMatchObject({ value: 'sk-two' })
    // Retiring the last key removes the reference.
    await controller.editKeys('DEEPSEEK_API_KEY', [0], '', 1)
    expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toBeUndefined()
  })

  it('refuses a key edit made against keys that changed since the page listed them', async () => {
    const { controller, credentials } = await bootWithStore({ DEEPSEEK_API_KEY: 'sk-one,sk-two' })
    const failure = await controller.editKeys('DEEPSEEK_API_KEY', [0], '', 3).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'credential/rejected',
      message: 'the keys saved for DEEPSEEK_API_KEY changed since this page listed them; reopen the provider and edit them again',
      details: { ref: 'DEEPSEEK_API_KEY' },
    })
    expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toMatchObject({ value: 'sk-one,sk-two' })
  })

  it('reports an empty or malformed key edit as bad-request', async () => {
    const controller = await boot({ DEEPSEEK_API_KEY: 'sk-one' })
    for (const call of [
      () => controller.editKeys('DEEPSEEK_API_KEY', [], '  ', 1),
      () => controller.editKeys('DEEPSEEK_API_KEY', [-1], '', 1),
      () => controller.editKeys('DEEPSEEK_API_KEY', [0.5], '', 1),
      () => controller.editKeys('not a var', [], 'sk-two', 1),
    ]) {
      const failure = await call().catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/bad-request' })
    }
  })

  it('copies the per-key previews a provider describes', async () => {
    const controller = await boot({}, ManyKeyCredentials)
    expect((await controller.describe(['DEEPSEEK_API_KEY'])).DEEPSEEK_API_KEY)
      .toEqual({ configured: true, source: 'memory', writable: true, masked: 'a•, b•', maskedEntries: ['a•', 'b•'] })
  })

  it('stringifies a refusal that is not an Error', async () => {
    const controller = await boot({}, LiteralRejectingCredentials)
    const failure = await controller.set('DEEPSEEK_API_KEY', 'sk-live').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)?.message).toBe('the store refused')
  })
})
