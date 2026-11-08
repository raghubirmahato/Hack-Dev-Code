/**
 * The `code_search` tool: find where something is defined from a description or a partial name, ranked, without
 * knowing the exact text to grep for. One ripgrep pass collects the definition lines of a workspace (functions,
 * classes, interfaces, types, methods, structs and their kin across common languages), cached per workspace and
 * refreshed when stale; a query is split into terms (camelCase and snake_case words, light stemming) and matched
 * against each definition's name, path and line, with a second ripgrep pass adding which files mention the terms
 * at all. Everything runs through the subprocess seam like `glob` and `grep`, so it works wherever they do.
 * @module @hackdevcode/dsh-tool-fs-search/code-search
 */

import type { Context } from '@hackdevcode/cordis'
import { defineTool } from '@hackdevcode/dsh-tools'
import type { ToolExecution } from '@hackdevcode/dsh-tools'
import { runRipgrep } from './search-core.ts'

/** Source files the index covers. */
export const CODE_GLOBS: readonly string[] = [
  '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue,svelte}', '*.py', '*.go', '*.rs', '*.{java,kt,kts,scala}', '*.cs',
  '*.{c,h,cc,cpp,cxx,hpp,hh}', '*.rb', '*.php', '*.swift', '*.dart', '*.lua',
]

/** Generated and vendored files that crowd out real definitions. */
const EXCLUDED_GLOBS: readonly string[] = ['!*.min.*', '!*.map', '!*.d.ts', '!**/node_modules/**', '!**/dist/**', '!**/vendor/**']

/** Ripgrep patterns for a line that starts a definition. */
export const DEFINITION_PATTERNS: readonly string[] = [
  String.raw`^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(function\*?|class|interface|type|enum|namespace|module)\s+[A-Za-z_$][\w$]*`,
  String.raw`^(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*(:[^=]+)?=`,
  String.raw`^\s*(async\s+)?def\s+\w+`,
  String.raw`^\s*(pub(\([^)]*\))?\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod)\b`,
  String.raw`^func\s+(\([^)]*\)\s*)?\w+`,
  String.raw`^type\s+\w+\s+(struct|interface)`,
  String.raw`^\s*((public|private|protected|internal|static|final|abstract|sealed|partial|override|virtual|readonly|async|open|data)\s+)*(class|interface|enum|record|struct|object|trait)\s+\w+`,
  String.raw`^\s+((public|private|protected|static|readonly|async|override|get|set)\s+)*[A-Za-z_$][\w$]*\s*(<[^>]*>)?\s*\([^)]*\)\s*(:\s*[^;={]+)?\s*\{\s*$`,
]

/** One definition found in the workspace. */
export interface CodeSymbol {
  /** Path relative to the search root. */
  path: string
  line: number
  /** Declaration keyword, such as function, class, interface, def, fn or method. */
  kind: string
  name: string
  /** The definition line, trimmed and bounded. */
  text: string
  /** Search terms of the name, path and line, split once on first use and kept with the cached index. */
  terms?: { name: string[]; path: string[]; text: string[] } | undefined
}

/** One ranked result. */
export interface CodeSearchResult extends CodeSymbol {
  score: number
}

/** Words that carry no meaning in a code question. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'be', 'it', 'its', 'this', 'that', 'with', 'by',
  'how', 'where', 'what', 'which', 'when', 'who', 'why', 'does', 'do', 'did', 'we', 'i', 'you', 'our', 'my', 'from', 'as', 'at',
  'code', 'function', 'functions', 'method', 'file', 'files', 'find', 'show', 'me', 'get', 'set', 'handle', 'handles', 'handled',
])

/** A declaration keyword followed by the declared name. */
const DECLARATION_KEYWORD = new RegExp(
  String.raw`\b(function\*?|class|interface|type|enum|namespace|module|def|fn|struct|trait|mod|record|object)\s+([A-Za-z_$][\w$]*)`, 'u',
)

/** Words that open control flow, not a method definition. */
const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'super', 'constructor'])

/** Reduce a word to a rough stem so "tokens", "tokenize" and "token" meet. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && (word.endsWith('ed') || word.endsWith('es'))) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/**
 * Split text into lower-case search terms: camelCase, PascalCase, snake_case, kebab-case and digits, stemmed.
 * @param text - an identifier, a path or a question.
 * @param dropStopwords - leave out words that carry no meaning in a question.
 * @returns the terms, each once.
 */
export function codeTerms(text: string, dropStopwords = false): string[] {
  const words = text
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(word => word.length > 1 && !(dropStopwords && STOPWORDS.has(word)))
  return [...new Set(words.map(stem))]
}

/**
 * The declaration a definition line holds.
 * @param line - one line ripgrep matched.
 * @returns its kind and name, or undefined when the line declares nothing recognizable.
 */
export function parseDefinition(line: string): { kind: string; name: string } | undefined {
  const keyword = DECLARATION_KEYWORD.exec(line)
  if (keyword?.[1] !== undefined && keyword[2] !== undefined) return { kind: keyword[1].replace('*', ''), name: keyword[2] }
  const impl = /\bimpl(?:<[^>]*>)?\s+(?:[\w:]+(?:<[^>]*>)?\s+for\s+)?([\w:]+)/u.exec(line)
  if (impl?.[1] !== undefined) return { kind: 'impl', name: impl[1] }
  const goFunc = /^func\s+(?:\([^)]*\)\s*)?(\w+)/u.exec(line)
  if (goFunc?.[1] !== undefined) return { kind: 'func', name: goFunc[1] }
  const constant = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u.exec(line)
  if (constant?.[1] !== undefined) return { kind: 'const', name: constant[1] }
  const method = /([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/u.exec(line)
  if (method?.[1] !== undefined && !NOT_METHODS.has(method[1])) return { kind: 'method', name: method[1] }
  return undefined
}

/**
 * Parse ripgrep `--null --line-number` output (`path NUL line:text`) into definitions.
 * @param stdout - ripgrep output.
 * @returns the definitions in output order.
 */
export function parseDefinitionLines(stdout: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = []
  for (const row of stdout.split('\n')) {
    const nul = row.indexOf('\0')
    if (nul < 0) continue
    const path = row.slice(0, nul).replace(/^\.[\\/]/u, '').replaceAll('\\', '/')
    const rest = /^(\d+):(.*)$/u.exec(row.slice(nul + 1).replace(/\r$/u, ''))
    if (rest?.[1] === undefined || rest[2] === undefined) continue
    const definition = parseDefinition(rest[2])
    if (definition === undefined) continue
    const text = rest[2].trim()
    symbols.push({ path, line: Number(rest[1]), ...definition, text: text.length > 160 ? `${text.slice(0, 160)}...` : text })
  }
  return symbols
}

/**
 * Count, per file, how many distinct query terms its text mentions, from ripgrep `--null --only-matching` output.
 * @param stdout - ripgrep output (`path NUL match` per line).
 * @param terms - the query terms.
 * @returns distinct terms mentioned, by path.
 */
export function parseTermHits(stdout: string, terms: readonly string[]): Map<string, number> {
  const seen = new Map<string, Set<string>>()
  for (const row of stdout.split('\n')) {
    const nul = row.indexOf('\0')
    if (nul < 0) continue
    const path = row.slice(0, nul).replace(/^\.[\\/]/u, '').replaceAll('\\', '/')
    const match = row.slice(nul + 1).trim().toLowerCase()
    const term = terms.find(candidate => match.includes(candidate))
    if (term === undefined) continue
    let set = seen.get(path)
    if (set === undefined) seen.set(path, set = new Set())
    set.add(term)
  }
  return new Map([...seen].map(([path, set]) => [path, set.size]))
}

/** How much one query term matches a list of target terms. */
function termMatch(term: string, targets: readonly string[], exact: number, prefix: number, partial: number): number {
  let best = 0
  for (const target of targets) {
    if (target === term) return exact
    if (term.length >= 3 && target.length >= 3 && (target.startsWith(term) || term.startsWith(target))) best = Math.max(best, prefix)
    else if (term.length >= 4 && target.includes(term)) best = Math.max(best, partial)
  }
  return best
}

/**
 * Rank definitions for a query.
 * @param symbols - the workspace's definitions.
 * @param query - a description, a partial name or an exact identifier.
 * @param fileHits - distinct query terms each file mentions.
 * @param limit - most results.
 * @returns the best definitions, at most three per file, best first.
 */
export function rankSymbols(
  symbols: CodeSymbol[], query: string, fileHits: ReadonlyMap<string, number>, limit: number,
): CodeSearchResult[] {
  const terms = codeTerms(query, true)
  const whole = query.trim().toLowerCase()
  if (terms.length === 0) return []
  const scored: CodeSearchResult[] = []
  for (const symbol of symbols) {
    symbol.terms ??= { name: codeTerms(symbol.name), path: codeTerms(symbol.path), text: codeTerms(symbol.text) }
    const { name: nameTerms, path: pathTerms, text: textTerms } = symbol.terms
    let score = 0
    let matched = 0
    for (const term of terms) {
      const best = Math.max(
        termMatch(term, nameTerms, 5, 3, 1.5),
        termMatch(term, pathTerms, 2, 1, 0.5),
        termMatch(term, textTerms, 1, 0.5, 0.25),
      )
      if (best > 0) matched++
      score += best
    }
    if (matched === 0) continue
    const coverage = matched / terms.length
    score += coverage * coverage * 6
    if (symbol.name.toLowerCase() === whole) score += 12
    if (['class', 'interface', 'type', 'struct', 'trait', 'enum'].includes(symbol.kind)) score += 0.5
    score += (fileHits.get(symbol.path) ?? 0) / terms.length * 2
    // Tests and fixtures answer "where is it defined" less often than the source.
    if (/(^|\/)(tests?|__tests__|spec|fixtures?)\//u.test(symbol.path) || /\.(spec|test)\.\w+$/u.test(symbol.path)) score -= 1.5
    const { terms: _terms, ...found } = symbol
    scored.push({ ...found, score: Math.round(score * 100) / 100 })
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line)
  const perFile = new Map<string, number>()
  const results: CodeSearchResult[] = []
  for (const result of scored) {
    const count = perFile.get(result.path) ?? 0
    if (count >= 3) continue
    perFile.set(result.path, count + 1)
    results.push(result)
    if (results.length >= limit) break
  }
  return results
}

/** Caps and timing for `code_search`. */
export interface CodeSearchCaps {
  rawOutputMaxBytes: number
  graceMs: number
  stderrMaxBytes: number
  timeoutMs: number
  /** How long a workspace's definition index is reused before it is collected again. */
  indexTtlMs: number
}

/** The cached definitions of one search root. */
interface IndexEntry {
  at: number
  symbols: CodeSymbol[]
  files: number
}

/** Glob arguments that restrict ripgrep to source files. */
function globArgs(): string[] {
  return [...CODE_GLOBS, ...EXCLUDED_GLOBS].map(glob => `--glob=${glob}`)
}

/**
 * Render results for the model.
 * @param results - ranked definitions.
 * @param indexed - definitions in the index.
 * @param files - files they come from.
 * @returns the text.
 */
export function renderCodeSearch(results: readonly CodeSearchResult[], indexed: number, files: number): string {
  if (indexed === 0) return 'No definitions found in this workspace\'s source files; use grep for text search.'
  if (results.length === 0) return `No definition matches; searched ${String(indexed)} definitions in ${String(files)} files. Try other words, or grep for exact text.`
  return `${results.map(result => `${result.path}:${String(result.line)}  ${result.kind} ${result.name}  — ${result.text}`).join('\n')}\n`
    + `(${String(results.length)} of ${String(indexed)} definitions in ${String(files)} files; read a file at its line for the details)`
}

/**
 * Register `code_search`.
 * @param ctx - plugin context with tools, system prompt, subprocess and working directory.
 * @param caps - resolved caps.
 */
export function applyCodeSearchTool(ctx: Context, caps: CodeSearchCaps): void {
  // Owned by this registration: one index per search root, dropped with the plugin.
  const indexes = new Map<string, IndexEntry>()
  // Every run names its root: ripgrep with no path searches standard input when that is a pipe.
  const collect = async (exec: ToolExecution, path: string | undefined): Promise<IndexEntry & { workdir: string }> => {
    const argv = ['--null', '--line-number', '--no-heading', '--color=never', '--no-messages', '--max-count=400', '--max-columns=400',
      ...globArgs(), ...DEFINITION_PATTERNS.flatMap(pattern => ['-e', pattern]), '--', path ?? '.']
    const run = await runRipgrep(ctx, exec, 'code_search', argv, caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
    const symbols = run.noMatches ? [] : parseDefinitionLines(run.stdout)
    return { at: Date.now(), symbols, files: new Set(symbols.map(symbol => symbol.path)).size, workdir: run.workdir }
  }

  ctx.systemPrompt.section({
    name: 'tool:code_search',
    order: ctx.systemPrompt.getSectionOrder('TOOL_GREP'),
    text: ({ scope }) => ctx.tools.get('code_search', scope) === undefined
      ? ''
      : 'To find where something is defined or implemented when you do not know its exact name, use code_search with a short description '
        + '("refresh auth token", "parse tool arguments"); use grep for exact text.',
  })

  ctx.tools.register(defineTool({
    name: 'code_search',
    description: 'Find the definitions (functions, classes, interfaces, types, methods, structs) that best match a description or a partial name, '
      + 'ranked across the whole workspace, each with its file and line. Use it to locate code before reading it; use grep for exact text.',
    parameters: {
      query: { type: 'string', required: true, description: 'What you are looking for: a short description ("where tool arguments are validated") or a partial or exact name.' },
      path: { type: 'string', description: 'Directory to search in. Defaults to the session workspace.' },
      limit: { type: 'integer', description: 'Most results, 1 to 50 (default 15).' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const query = args.query.trim()
      if (query.length === 0) throw new Error('query is empty')
      const limit = args.limit ?? 15
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be an integer from 1 to 50')
      const terms = codeTerms(query, true)
      if (terms.length === 0) throw new Error('the query has no searchable words; name what you are looking for')
      const key = `${exec.agent === undefined ? process.cwd() : await ctx.workingDirectory.ensure(exec.agent, exec.signal)}\0${args.path ?? ''}`
      let index = indexes.get(key)
      if (index === undefined || Date.now() - index.at > caps.indexTtlMs) {
        index = await collect(exec, args.path)
        indexes.set(key, index)
      }
      const hitArgv = ['--null', '--no-heading', '--no-line-number', '--color=never', '--no-messages', '--ignore-case', '--fixed-strings',
        '--only-matching', '--max-count=40', ...globArgs(), ...terms.flatMap(term => ['-e', term]), '--', args.path ?? '.']
      const hits = await runRipgrep(ctx, exec, 'code_search', hitArgv, caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      const fileHits = hits.noMatches ? new Map<string, number>() : parseTermHits(hits.stdout, terms)
      const results = rankSymbols(index.symbols, query, fileHits, limit)
      return { text: renderCodeSearch(results, index.symbols.length, index.files), count: results.length }
    },
  }))
}
