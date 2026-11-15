/** Opt-in desktop screenshots through the actual CUA tool and attachment store. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@hackdevcode/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@hackdevcode/dsh-agent-loop-testkit'
import ComputerUseRegistry from '@hackdevcode/dsh-computer-use'
import LocalAttachmentStore from '@hackdevcode/dsh-attachment-local'
import SubprocessLocal from '@hackdevcode/dsh-subprocess-local'
import UserQuestions from '@hackdevcode/dsh-user-questions'
import { LlmAdapter, type ToolCallId, type LlmResolvedModelInfo, type StreamChunk } from '@hackdevcode/dsh-llm'
import type { SessionId } from '@hackdevcode/dsh-session'
import { expect, it, onTestFinished } from 'vitest'
import { createCuaApi } from '@hackdevcode/dsh-cua/api'
import sharp from 'sharp'
import * as Provider from '../src/index.ts'
import { brandString } from '@hackdevcode/dsh-brand'

class ImageAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }
  stream(): AsyncIterable<StreamChunk> { throw new Error('Desktop tests do not request model generation') }
}
const helperPath = process.env.DSH_CUA_DESKTOP_TEST_HELPER
const selector = process.env.DSH_CUA_DESKTOP_TEST_APP
it.skipIf(!helperPath || !selector)('admits real application screenshots through the CUA tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cua-desktop-tool-'))
  const ctx = new Context()
  onTestFinished(async () => { try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) } })
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(ComputerUseRegistry)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  await ctx.plugin(UserQuestions)
  ctx.on('user-questions/request', async () => ({ answers: [{ id: 'cua-app-access', selected: ['Allow for this session'] }] }))
  await ctx.plugin(Provider, { helperPath: helperPath!, agentPreset: false })
  ctx.llm.registerAdapter(['desktop-test'], new ImageAdapter())
  const owner = await ctx.agents.create({ sessionId: brandString<SessionId>('desktop-screenshot'), agentOptions: { provider: 'desktop-test', model: 'vision' } })
  let sequence = 0
  const dispatch: Parameters<typeof createCuaApi>[0] = async (operation) => {
    const batch = await ctx.tools.execute({ agent: owner.agent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: brandString<ToolCallId>(`desktop-${++sequence}`), name: 'cua', arguments: JSON.stringify(operation) }] })
    expect(batch.results).toHaveLength(1)
    const result = batch.results[0]!.result
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    const image = result.content.find(block => block.type === 'image')
    if (image) {
      const path = ctx.attachments.imageHostPath(image.attachment)
      if (!path) throw new Error('Screenshot attachment has no readable path')
      return { attachmentId: image.attachment.attachmentId, path, width: image.attachment.width, height: image.attachment.height }
    }
    return result.value!
  }
  const api = createCuaApi(dispatch)
  const discovered = (await api.listApps()).find(app =>
    app.id === selector || app.displayName === selector)
  const app = await api.getApp(discovered?.id ?? selector!)
  const target = (await app.getWindows()).find(window =>
    window.isOnScreen && window.bounds.width > 0 && window.bounds.height > 0)
  expect(target).toBeDefined()
  const window = await app.getWindow(target!.windowId)
  expect(typeof await window.getAccessibilityTree()).toBe('string')
  for (let i = 0; i < 5; ++i) {
    const screenshot = await window.getScreenshot()
    const decoded = await sharp(screenshot.path).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info.width).toBe(screenshot.width)
    expect(decoded.info.height).toBe(screenshot.height)
  }
}, 60_000)
