import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { credentialRef, editCredentialEntries, isCredentialKeySegment, splitCredentialEntries } from '../src/index.ts'
import type { CredentialRef } from '../src/index.ts'
import { MemoryCredentials } from './memory.ts'

const REF = credentialRef('DEEPSEEK_API_KEY')

async function boot(seed: Record<string, string> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, seed)
  return ctx
}

describe('credentialRef', () => {
  it('brands POSIX shell identifiers', () => {
    expect(credentialRef('DEEPSEEK_API_KEY')).toBe('DEEPSEEK_API_KEY')
    expect(credentialRef('_private')).toBe('_private')
    expect(credentialRef('lower_case9')).toBe('lower_case9')
  })

  it('rejects every other shape', () => {
    for (const invalid of ['', '9LEADING', 'WITH-DASH', 'WITH SPACE', 'ns:key']) {
      expect(() => credentialRef(invalid)).toThrow(TypeError)
    }
  })
})

describe('stored entries', () => {
  it('splits on commas and semicolons, trimming blanks and repeats', () => {
    expect(splitCredentialEntries(' sk-a, sk-b;;sk-a ,, ; sk-c ')).toEqual(['sk-a', 'sk-b', 'sk-c'])
    expect(splitCredentialEntries('sk-only')).toEqual(['sk-only'])
    expect(splitCredentialEntries(' , ; ')).toEqual([])
  })

  it('drops entries by position and appends new ones without repeating a kept entry', () => {
    expect(editCredentialEntries('sk-a,sk-b,sk-c', [1], 'sk-d; sk-a', 3)).toBe('sk-a,sk-c,sk-d')
    expect(editCredentialEntries('sk-a', [], 'sk-b', 1)).toBe('sk-a,sk-b')
    expect(editCredentialEntries(undefined, [], 'sk-a,sk-b', 0)).toBe('sk-a,sk-b')
    expect(editCredentialEntries('sk-a,sk-b', [0, 1], '', 2)).toBe('')
  })

  it('refuses an edit made against a different list', () => {
    expect(editCredentialEntries('sk-a,sk-b', [0], '', 3)).toBeUndefined()
    expect(editCredentialEntries(undefined, [], 'sk-a', 1)).toBeUndefined()
    expect(editCredentialEntries('sk-a,sk-b', [2], '', 2)).toBeUndefined()
    expect(editCredentialEntries('sk-a,sk-b', [-1], '', 2)).toBeUndefined()
    expect(editCredentialEntries('sk-a,sk-b', [0.5], '', 2)).toBeUndefined()
  })
})

describe('isCredentialKeySegment', () => {
  it('answers whether credentialKey would accept the segment', () => {
    for (const valid of ['llm-pi-ai', 'openai-codex', 'a', 'z9']) {
      expect(isCredentialKeySegment(valid)).toBe(true)
    }
    // The shapes an arbitrary settings dict key can take that a record id
    // cannot: a consumer asks here instead of learning it from a throw.
    for (const invalid of ['', 'My_Proxy', 'z.ai', 'UPPER', '9leading', 'a/b']) {
      expect(isCredentialKeySegment(invalid)).toBe(false)
    }
  })
})

describe('the credentials seam through the memory provider', () => {
  it('mounts as ctx.credentials and resolves a seeded reference with its source', async () => {
    const ctx = await boot({ DEEPSEEK_API_KEY: 'sk-seeded' })
    expect(await ctx.credentials.resolve(REF)).toEqual({ value: 'sk-seeded', source: 'memory' })
    expect(await ctx.credentials.describe(REF)).toEqual({ configured: true, source: 'memory', writable: true })
  })

  it('treats an empty stored value as absent everywhere', async () => {
    const ctx = await boot({ DEEPSEEK_API_KEY: '' })
    expect(await ctx.credentials.resolve(REF)).toBeUndefined()
    expect(await ctx.credentials.describe(REF)).toEqual({ configured: false, writable: true })
  })

  it('stores through set, removes through unset, and emits the committed change', async () => {
    const ctx = await boot()
    const events: CredentialRef[] = []
    ctx.on('credentials/reference-updated', ref => void events.push(ref))

    await ctx.credentials.set(REF, 'sk-live')
    expect(await ctx.credentials.resolve(REF)).toEqual({ value: 'sk-live', source: 'memory' })
    await ctx.credentials.unset(REF)
    expect(await ctx.credentials.resolve(REF)).toBeUndefined()
    expect(events).toEqual([REF, REF])
  })

  it('rejects an empty set and keeps an absent unset silent', async () => {
    const ctx = await boot()
    const events: CredentialRef[] = []
    ctx.on('credentials/reference-updated', ref => void events.push(ref))

    await expect(ctx.credentials.set(REF, '')).rejects.toThrow(/empty value/)
    await ctx.credentials.unset(REF)
    expect(events).toEqual([])
  })

  it('removes the service with its fiber', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryCredentials)
    expect(ctx.get('credentials')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('credentials')).toBeUndefined()
  })
})
