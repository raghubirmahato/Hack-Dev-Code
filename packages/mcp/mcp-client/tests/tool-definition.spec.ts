import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import { Context } from '@hackdevcode/cordis'
import { brandString } from '@hackdevcode/dsh-brand'
import type { ToolCallId } from '@hackdevcode/dsh-llm/types'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import ToolRuntime from '@hackdevcode/dsh-tools'
import type { ToolExecution } from '@hackdevcode/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createMcpToolDefinition } from '../src/index.ts'

describe('MCP result callback adaptation', () => {
  it('preserves the exact execution, arguments and canonical structured results', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(NativeToolExecutor)
      let execution: ToolExecution | undefined
      ctx.on('tools/execute', (exec, next) => {
        execution = exec
        return next()
      })
      const call = vi.fn(async () => ({
        content: [{ type: 'text', text: 'Observed window.' }],
        structuredContent: { window: 7 },
      }))
      ctx.tools.register(createMcpToolDefinition(ctx, {
        name: 'native_window', rawName: 'window', description: 'Read the selected window.',
        inputSchema: { type: 'object', properties: { window: { type: 'integer' } } },
        outputSchema: { type: 'object', properties: { window: { type: 'integer' } }, required: ['window'] },
        call,
      }))
      const signal = new AbortController().signal
      const result = await executeToolFixture(ctx, {
        name: 'native_window', callId: brandString<ToolCallId>('window-call'), arguments: { window: 7 }, signal,
      })
      expect(call).toHaveBeenCalledWith({ window: 7 }, execution)
      expect(execution?.signal).toBe(signal)
      expect(result.isError).toBe(false)
      expect(result.value).toEqual({
        content: [{ type: 'text', text: 'Observed window.' }], structuredContent: { window: 7 },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([null, { content: [42] }, { content: [{ type: 'image' }] }])(
    'rejects invalid external results before exposing content (%j)', async (invalid) => {
      const ctx = new Context()
      try {
        await ctx.plugin(SystemPrompt)
        await ctx.plugin(ToolRuntime)
        await ctx.plugin(NativeToolExecutor)
        ctx.tools.register(createMcpToolDefinition(ctx, {
          name: 'invalid_result', rawName: 'invalid', description: 'External result fixture.',
          inputSchema: { type: 'object' }, call: async () => invalid,
        }))
        const result = await executeToolFixture(ctx, {
          name: 'invalid_result', callId: brandString<ToolCallId>('invalid-call'), arguments: {},
          signal: new AbortController().signal,
        })
        expect(result.isError).toBe(true)
        expect(result.value).toBeUndefined()
        expect(result.error?.info).toEqual({ name: 'McpToolError', code: 'MCP_INVALID_RESULT' })
      } finally {
        await ctx.fiber.dispose()
      }
    },
  )

  it.each([
    ['an isError result', { isError: true, content: [{ type: 'text', text: 'window is gone' }] }, false,
      'window is gone', 'MCP_TOOL_ERROR'],
    ['a task-required tool', undefined, true,
      'Tool "window" requires task-based execution, which this bridge does not support', 'MCP_UNSUPPORTED_TASK_EXECUTION'],
  ] as const)('classifies %s as an McpToolError', async (_label, raw, taskRequired, message, code) => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(NativeToolExecutor)
      const call = vi.fn(async () => raw)
      ctx.tools.register(createMcpToolDefinition(ctx, {
        name: 'native_window', rawName: 'window', description: 'Read the selected window.',
        inputSchema: { type: 'object' }, taskRequired, call,
      }))
      const result = await executeToolFixture(ctx, {
        name: 'native_window', callId: brandString<ToolCallId>('window-call'), arguments: {},
        signal: new AbortController().signal,
      })
      expect(result.error).toEqual({ message, info: { name: 'McpToolError', code } })
      expect(call).toHaveBeenCalledTimes(taskRequired ? 0 : 1)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
