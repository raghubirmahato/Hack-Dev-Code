/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@hackdevcode/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('dsh-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@hackdevcode/dsh-sdk-app'],
      ['sdk-jsonrpc-server', '@hackdevcode/dsh-sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@hackdevcode/dsh-deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@hackdevcode/dsh-session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@hackdevcode/dsh-plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@hackdevcode/dsh-llm-deepseek-api-key'],
      ['sandbox', '@hackdevcode/dsh-sandbox-local'],
      ['filesystem', '@hackdevcode/dsh-fs-local'],
      ['attachment-local', '@hackdevcode/dsh-attachment-local'],
      ['tool-fs', '@hackdevcode/dsh-tool-fs'],
      ['working-directory', '@hackdevcode/dsh-working-directory'],
      ['tool-working-directory', '@hackdevcode/dsh-tool-working-directory'],
      ['session-projection', '@hackdevcode/dsh-session-projection'],
      ['token-meter', '@hackdevcode/dsh-token-meter'],
      ['compaction-basic', '@hackdevcode/dsh-compaction-basic'],
      ['image-offload', '@hackdevcode/dsh-compaction-image-offload'],
      ['sandbox-policy', '@hackdevcode/dsh-sandbox-policy'],
      ['subprocess', '@hackdevcode/dsh-subprocess-local'],
      ['pty', '@hackdevcode/dsh-terminal'],
      ['terminal-bash', '@hackdevcode/dsh-terminal-bash'],
      ['terminal-pwsh', '@hackdevcode/dsh-terminal-bash'],
      ['timer', '@hackdevcode/cordis-plugin-timer'],
      ['llm', '@hackdevcode/dsh-llm'],
      ['session', '@hackdevcode/dsh-session'],
      ['session-title', '@hackdevcode/dsh-session-title'],
      ['system-prompt', '@hackdevcode/dsh-system-prompt'],
      ['tools', '@hackdevcode/dsh-tools'],
      ['tool-executor-native', '@hackdevcode/dsh-tool-executor-native'],
      ['mcp-resources', '@hackdevcode/dsh-mcp-resources'],
      ['agent', '@hackdevcode/dsh-agent'],
      ['llm-retry', '@hackdevcode/dsh-llm-retry'],
      ['jobs', '@hackdevcode/dsh-jobs-local'],
      ['agent-loop', '@hackdevcode/dsh-agent-loop'],
      ['persistent-bash', '@hackdevcode/dsh-tool-bash-persistent'],
      ['persistent-pwsh', '@hackdevcode/dsh-tool-pwsh-persistent'],
      ['sessions', '@hackdevcode/dsh-session-persistence-jsonl'],
      ['session-checkpoint-policy', '@hackdevcode/dsh-session-checkpoint-policy'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.DSH_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      personaPrefix: { __jsExpr: "process.env.DSH_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'tool-fs')?.config).toEqual({ read: false, readImage: true, write: false, edit: false })
    expect(rows.find(row => row.id === 'compaction-basic')?.config).toBeUndefined()
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
