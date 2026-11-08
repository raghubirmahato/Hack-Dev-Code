import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import { provideWorkingDirectoryFixture } from '@hackdevcode/dsh-agent-loop-testkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@hackdevcode/cordis'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import ToolRuntime from '@hackdevcode/dsh-tools'
import LocalSubprocessRuntime from '@hackdevcode/dsh-subprocess-local'
import * as ToolFsSearch from '@hackdevcode/dsh-tool-fs-search'
import { codeTerms, parseDefinition, parseDefinitionLines, parseTermHits, rankSymbols, renderCodeSearch } from '@hackdevcode/dsh-tool-fs-search'

describe('code_search ranking', () => {
  it('splits identifiers and questions into stemmed terms', () => {
    expect(codeTerms('refreshAuthToken')).toEqual(['refresh', 'auth', 'token'])
    expect(codeTerms('parse_tool_arguments')).toEqual(['parse', 'tool', 'argument'])
    expect(codeTerms('HTTPServerError')).toEqual(['http', 'server', 'error'])
    expect(codeTerms('where do we validate the tokens?', true)).toEqual(['validate', 'token'])
  })

  it('recognizes definitions across languages and skips control flow', () => {
    expect(parseDefinition('export async function refreshToken(user: User) {')).toEqual({ kind: 'function', name: 'refreshToken' })
    expect(parseDefinition('export interface ToolArgs {')).toEqual({ kind: 'interface', name: 'ToolArgs' })
    expect(parseDefinition('    def parse_config(path):')).toEqual({ kind: 'def', name: 'parse_config' })
    expect(parseDefinition('pub fn open_session(&self) -> Result<()> {')).toEqual({ kind: 'fn', name: 'open_session' })
    expect(parseDefinition('impl Display for Session {')).toEqual({ kind: 'impl', name: 'Session' })
    expect(parseDefinition('func (s *Server) Start() error {')).toEqual({ kind: 'func', name: 'Start' })
    expect(parseDefinition('export const DEFAULT_PORT = 3080')).toEqual({ kind: 'const', name: 'DEFAULT_PORT' })
    expect(parseDefinition('  async loadIndex(root: string): Promise<void> {')).toEqual({ kind: 'method', name: 'loadIndex' })
    expect(parseDefinition('  if (ready) {')).toBeUndefined()
  })

  it('parses ripgrep output and counts the distinct terms each file mentions', () => {
    const symbols = parseDefinitionLines('./src/auth.ts\u000012:export function refreshToken() {\nsrc\\db.ts\u00003:export class Pool {\nbroken line\n')
    expect(symbols).toEqual([
      { path: 'src/auth.ts', line: 12, kind: 'function', name: 'refreshToken', text: 'export function refreshToken() {' },
      { path: 'src/db.ts', line: 3, kind: 'class', name: 'Pool', text: 'export class Pool {' },
    ])
    const hits = parseTermHits('src/auth.ts\u0000token\nsrc/auth.ts\u0000Refresh\nsrc/auth.ts\u0000token\nsrc/db.ts\u0000token\n', ['refresh', 'token'])
    expect(hits).toEqual(new Map([['src/auth.ts', 2], ['src/db.ts', 1]]))
  })

  it('ranks the definition that covers the most of a description first, and an exact name above all', () => {
    const symbols = [
      { path: 'src/auth/session.ts', line: 40, kind: 'function', name: 'refreshAccessToken', text: 'export async function refreshAccessToken(session) {' },
      { path: 'src/ui/token-badge.tsx', line: 5, kind: 'function', name: 'TokenBadge', text: 'export function TokenBadge() {' },
      { path: 'src/auth/session.ts', line: 10, kind: 'class', name: 'Session', text: 'export class Session {' },
      { path: 'tests/auth/session.spec.ts', line: 3, kind: 'function', name: 'refreshAccessToken', text: 'function refreshAccessToken() {' },
    ]
    const ranked = rankSymbols(symbols, 'how do we refresh the access token', new Map([['src/auth/session.ts', 3]]), 10)
    expect(ranked[0]).toMatchObject({ path: 'src/auth/session.ts', name: 'refreshAccessToken' })
    // The test copy of the same name ranks below the source.
    expect(ranked.findIndex(result => result.path.startsWith('tests/'))).toBeGreaterThan(0)
    expect(rankSymbols(symbols, 'Session', new Map(), 10)[0]).toMatchObject({ name: 'Session' })
    expect(rankSymbols(symbols, 'the', new Map(), 10)).toEqual([])
  })

  it('keeps at most three results per file and says what it searched', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ path: 'a.ts', line: index + 1, kind: 'function', name: `parseValue${String(index)}`, text: '' }))
    expect(rankSymbols(many, 'parse value', new Map(), 10)).toHaveLength(3)
    expect(renderCodeSearch([], 0, 0)).toContain('No definitions found')
    expect(renderCodeSearch([], 12, 3)).toContain('searched 12 definitions in 3 files')
  })
})

describe('code_search over the real subprocess service and the packaged rg', () => {
  let dir: string
  let ctx: Context
  const agent = () => ({ session: { header: { id: 'session-code-search', cwd: dir } } })
  const run = async (args: Record<string, unknown>) => {
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal, callId: ToolCallId('code-search'), name: 'code_search', arguments: args, agent: agent() as never,
    })
    return { isError: result.isError, text: result.content.map(block => block.type === 'text' ? block.text : '').join('') }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-code-search-'))
    await mkdir(join(dir, 'src', 'auth'), { recursive: true })
    await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(dir, 'src', 'auth', 'session.ts'), [
      'import { fetch } from "./net"',
      'export class Session {',
      '  async refreshAccessToken(): Promise<void> {',
      '    // ask the identity server for a new access token',
      '  }',
      '}',
      'export function signOut(session: Session) {}',
    ].join('\n'))
    await writeFile(join(dir, 'src', 'billing.py'), 'class Invoice:\n    def total_amount(self):\n        return 0\n')
    await writeFile(join(dir, 'node_modules', 'dep', 'index.js'), 'export function refreshAccessToken() {}\n')
    ctx = new Context()
    provideWorkingDirectoryFixture(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: true })
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('finds a method from a description, with its file and line, and ignores dependencies', async () => {
    const result = await run({ query: 'refresh the access token' })
    expect(result.isError).toBe(false)
    expect(result.text.split('\n')[0]).toBe('src/auth/session.ts:3  method refreshAccessToken  — async refreshAccessToken(): Promise<void> {')
    expect(result.text).not.toContain('node_modules')
    expect((await run({ query: 'invoice total' })).text).toContain('src/billing.py:2  def total_amount')
  })

  it('validates its arguments', async () => {
    expect((await run({ query: '   ' })).text).toContain('query is empty')
    expect((await run({ query: 'the of' })).text).toContain('no searchable words')
    expect((await run({ query: 'session', limit: 99 })).text).toContain('limit must be an integer from 1 to 50')
  })
})
