import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import ToolRuntime, { argumentSignature, coerceToSchema, defineTool, parseToolArguments, similarToolNames } from '../src/index.ts'
import type { JsonSchemaNode } from '../src/index.ts'

describe('parseToolArguments', () => {
  it('passes valid JSON through unchanged and maps empty text to no arguments', () => {
    expect(parseToolArguments('{"path":"a.ts"}')).toEqual({ ok: true, value: { path: 'a.ts' }, repaired: false })
    expect(parseToolArguments('  ')).toEqual({ ok: true, value: {}, repaired: false })
  })

  it('repairs code fences, trailing commas, a forgotten final brace, prose around the object and double encoding', () => {
    expect(parseToolArguments('```json\n{"path": "a.ts"}\n```')).toEqual({ ok: true, value: { path: 'a.ts' }, repaired: true })
    expect(parseToolArguments('{"items": [1, 2,], "a": 1,}')).toEqual({ ok: true, value: { items: [1, 2], a: 1 }, repaired: true })
    expect(parseToolArguments('{"path": "a.ts", "opts": {"x": 1}')).toEqual({ ok: true, value: { path: 'a.ts', opts: { x: 1 } }, repaired: true })
    expect(parseToolArguments('Arguments: {"path": "a.ts"} done')).toEqual({ ok: true, value: { path: 'a.ts' }, repaired: true })
    expect(parseToolArguments(JSON.stringify(JSON.stringify({ path: 'a.ts' })))).toEqual({ ok: true, value: { path: 'a.ts' }, repaired: true })
  })

  it('keeps commas and braces inside strings', () => {
    expect(parseToolArguments('{"text": "a, }", "n": 1,}')).toEqual({ ok: true, value: { text: 'a, }', n: 1 }, repaired: true })
  })

  it('never completes a value that was cut off inside a string', () => {
    const cut = parseToolArguments('{"path": "a.ts", "content": "function main() {\\n  return')
    expect(cut.ok).toBe(false)
    expect(parseToolArguments('not json at all').ok).toBe(false)
  })
})

describe('coerceToSchema', () => {
  const schema: JsonSchemaNode = {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      limit: { type: 'integer' },
      ratio: { type: 'number' },
      force: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      mode: { type: 'string', enum: ['a', 'b'] },
      nested: { type: 'object', properties: { depth: { type: 'integer' } } },
    },
  }

  it('converts unambiguous strings to the declared types', () => {
    expect(coerceToSchema(schema, {
      path: 'a.ts', limit: '20', ratio: '0.5', force: 'true', tags: 'one', nested: '{"depth": "2"}',
    })).toEqual({ path: 'a.ts', limit: 20, ratio: 0.5, force: true, tags: ['one'], nested: { depth: 2 } })
    expect(coerceToSchema(schema, { path: 'a', tags: '["x", "y"]' })).toEqual({ path: 'a', tags: ['x', 'y'] })
  })

  it('leaves values it cannot convert, null, numbers for strings and undeclared fields for validation', () => {
    expect(coerceToSchema(schema, { path: 'a', limit: '2.5', force: 'yes', extra: null })).toEqual({ path: 'a', limit: '2.5', force: 'yes', extra: null })
    expect(coerceToSchema(schema, { path: null, mode: null })).toEqual({ path: null, mode: null })
    expect(coerceToSchema(schema, { path: 7 })).toEqual({ path: 7 })
    expect(coerceToSchema(schema, 'text')).toBe('text')
  })
})

describe('error help', () => {
  it('writes a compact signature of the expected arguments', () => {
    expect(argumentSignature({
      type: 'object', required: ['path'], properties: {
        path: { type: 'string' }, mode: { type: 'string', enum: ['read', 'write'] }, lines: { type: 'array', items: { type: 'integer' } },
      },
    })).toBe('{path: string, mode?: "read"|"write", lines?: integer[]}')
  })

  it('suggests lookalike tool names', () => {
    const names = ['read', 'write', 'bash', 'cua_driver_native__click', 'desktop_window']
    expect(similarToolNames('Bash', names)).toEqual(['bash'])
    expect(similarToolNames('read_file', names)).toEqual(['read'])
    expect(similarToolNames('click', names)).toEqual(['cua_driver_native__click'])
    expect(similarToolNames('desktop-windows', names)).toEqual(['desktop_window'])
    expect(similarToolNames('teleport', names)).toEqual([])
  })
})

describe('through the tool runtime', () => {
  async function setup(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    ctx.tools.register(defineTool({
      name: 'read_lines',
      description: 'Read lines.',
      parameters: { path: { type: 'string', required: true }, limit: { type: 'integer' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { return `${args.path}:${String(args.limit ?? 'all')}:${typeof args.limit}` },
    }))
    return ctx
  }

  it('runs a call whose argument types needed converting', async () => {
    const ctx = await setup()
    const result = await executeToolFixture(ctx, { name: 'read_lines', callId: ToolCallId('a'), arguments: { path: 'x.ts', limit: '5' }, signal: new AbortController().signal })
    expect(result.content).toEqual([{ type: 'text', text: 'x.ts:5:number' }])
    await ctx.fiber.dispose()
  })

  it('explains unparseable arguments and names the expected fields', async () => {
    const ctx = await setup()
    const result = await executeToolFixture(ctx, { name: 'read_lines', callId: ToolCallId('b'), arguments: '{"path": "x.ts", "limit": 5', signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    const text = JSON.stringify(result.content)
    expect(text).toContain('the arguments were not valid JSON')
    expect(text).toContain('Expected arguments: {path: string, limit?: integer}')
    await ctx.fiber.dispose()
  })

  it('suggests the right name for a lookalike tool call', async () => {
    const ctx = await setup()
    const result = await executeToolFixture(ctx, { name: 'Read-Lines', callId: ToolCallId('c'), arguments: {}, signal: new AbortController().signal })
    expect(JSON.stringify(result.content)).toContain('did you mean \\"read_lines\\"? Call it with that exact name')
    await ctx.fiber.dispose()
  })
})
