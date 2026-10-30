/** Explicitly enabled billed Flash smoke through the actual native official provider. */
import type { ModuleLoaderV2 } from '@hackdevcode/cordis-plugin-loader'
import { boot } from '@hackdevcode/dsh-app-boot'
import LlmRuntime from '@hackdevcode/dsh-llm'
import SessionStore, { SessionId } from '@hackdevcode/dsh-session'
import * as JsonlPersistence from '@hackdevcode/dsh-session-persistence-jsonl'
import * as Official from '@hackdevcode/dsh-llm-deepseek-api-key'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import Translator from '../src/index.ts'

const enabled = process.env.DSH_TRANSLATION_DEEPSEEK_LIVE === '1' && (process.env.DEEPSEEK_API_KEY?.length ?? 0) > 0

it.skipIf(!enabled)('translates a small independent billed query with exact Flash and thinking off', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paid-translation-live-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  let close: (() => Promise<void>) | undefined
  try {
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { id: 'llm', name: '@hackdevcode/dsh-llm' },
      { id: 'sessions', name: '@hackdevcode/dsh-session' },
      { id: 'storage', name: '@hackdevcode/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
      { id: 'official-live-owner', name: '@hackdevcode/dsh-llm-deepseek-api-key' },
      { id: 'translator', name: '@hackdevcode/dsh-experimental-translator', config: { deepseekMaxOutputTokens: 128 } },
    ]))
    const modules = new Map<string, unknown>([
      ['@hackdevcode/dsh-llm', LlmRuntime], ['@hackdevcode/dsh-session', SessionStore],
      ['@hackdevcode/dsh-session-persistence-jsonl', JsonlPersistence],
      ['@hackdevcode/dsh-llm-deepseek-api-key', Official], ['@hackdevcode/dsh-experimental-translator', Translator],
    ])
    const ctx = await boot('paid-translation-live', configPath, [], (host) => {
      const source: ModuleLoaderV2 = {
        version: 'v2', loadCache: new Map(),
        async import(specifier) {
          if (!modules.has(specifier)) throw new Error(`Unexpected live fixture import: ${specifier}`)
          return modules.get(specifier)
        },
        register(): never { throw new Error('Unexpected module hook registration') },
        getOrCreateModuleJob(): never { throw new Error('Unexpected module job creation') },
        resolveSync(): never { throw new Error('Unexpected synchronous module resolution') },
        load(): never { throw new Error('Unexpected module load') },
      }
      host.loader.internal = source
    })
    close = async () => { await ctx.fiber.dispose() }
    const session = ctx.sessions.create(SessionId('paid-live-translation'), { meta: { cwd: root } })
    await using _writer = await ctx.sessionPersistence.create(session.header)
    expect(await ctx.translator.availableProviders()).toContain('deepseek-official')
    const result = await ctx.translator.translate(ctx.translator.resolve({ provider: 'deepseek-official', text: 'Hello world.',
      targetLanguage: 'zh', sourceLanguage: 'en', sessionId: session.id }))
    expect(result).toContain('\u4e16\u754c')
    expect(session.deriveMessages()).toEqual([])
    await using reader = await ctx.sessionPersistence.open(session.id, 'read')
    const events = (await reader.read()).events
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'plugin:translator/request', ignorable: true,
      data: { provider: 'deepseek-official', metadata: { modelRequest: { config: {
        provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 128,
      } } } },
    })
    expect(events[1]).toMatchObject({ type: 'plugin:translator/result', ignorable: true, data: { requestSeq: 0, text: result } })
  } finally {
    await close?.()
    if (previousHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})
