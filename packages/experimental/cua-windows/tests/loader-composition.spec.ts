/** Windows provider registration through the Loader without an interactive desktop. */
import { Context } from '@hackdevcode/cordis'
import Include from '@hackdevcode/cordis-plugin-include'
import Loader from '@hackdevcode/cordis-plugin-loader'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@hackdevcode/dsh-agent-loop-testkit'
import ComputerUseRegistry from '@hackdevcode/dsh-computer-use'
import type { ToolCallId } from '@hackdevcode/dsh-llm'
import type { SessionId } from '@hackdevcode/dsh-session'
import SubprocessLocal from '@hackdevcode/dsh-subprocess-local'
import { expect, it, onTestFinished } from 'vitest'
import * as WindowsProvider from '../src/index.ts'
import { brandString } from '@hackdevcode/dsh-brand'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

it.skipIf(process.platform !== 'win32')('loads the Windows provider and rejects a numeric window ID before native dispatch', async () => {
  const ctx = new Context()
  // The Loader writes entry state back to its include file (disposing marks it disabled), so load a copy.
  const root = await mkdtemp(join(tmpdir(), 'dsh-cua-windows-loader-'))
  onTestFinished(async () => { try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) } })
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(ComputerUseRegistry)
  await ctx.plugin(SubprocessLocal)
  const config = join(root, 'provider.yml')
  await copyFile(new URL('./fixtures/provider.yml', import.meta.url), config)
  ctx.baseUrl = import.meta.url
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { include: Include, 'windows-provider': WindowsProvider })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'windows-provider')
  if (!entry?.fiber) throw new Error('Loader did not activate the Windows provider')
  await entry.fiber.await()
  const { agent } = await ctx.agents.create({ sessionId: brandString<SessionId>('cua-windows-loader') })
  expect(ctx.tools.get('cua', agent)).toBeDefined()
  const prompt = await ctx.systemPrompt.assemble({ scope: agent })
  expect(prompt.sections.find(section => section.name === 'computer-use:dsh-cua')?.text).toContain('Windows:')
  expect(prompt.sections.find(section => section.name === 'computer-use:dsh-cua')?.text).not.toContain('useSystemPointer')
  expect(JSON.stringify(ctx.tools.get('cua', agent)!.parameters)).not.toContain('useSystemPointer')
  const batch = await ctx.tools.execute({ agent, signal: new AbortController().signal, calls: [{
    type: 'tool-call', id: brandString<ToolCallId>('invalid-window'), name: 'cua',
    arguments: JSON.stringify({ method: 'screenshot', params: { appHandle: 'app', windowId: 7 } }),
  }, {
    type: 'tool-call', id: brandString<ToolCallId>('unsupported-pointer'), name: 'cua',
    arguments: JSON.stringify({ method: 'drag', params: { appHandle: 'app', windowId: '7', fromX: 1, fromY: 1,
      toX: 2, toY: 2, useSystemPointer: true } }),
  }] })
  expect(batch.results[1]?.result.isError).toBe(true)
  expect(JSON.stringify(batch.results[1]?.result.content)).toContain('useSystemPointer')
  expect(batch.results[0]?.result.isError).toBe(true)
  expect(JSON.stringify(batch.results[0]?.result.content)).toContain('string')
  await entry.fiber.dispose()
  expect(ctx.tools.get('cua', agent)).toBeUndefined()
})
