/**
 * Tolerance for the argument mistakes weaker models make: JSON wrapped in code fences, trailing commas, JSON encoded
 * twice, a cut-off closing brace, numbers and booleans sent as strings, `null` for an omitted optional field. Each
 * repair is conservative: it only applies where the intended value is unambiguous, so a valid call is never changed.
 * @module @hackdevcode/dsh-tools/repair
 */

import type { JsonSchemaNode } from './json-schema.ts'
import { isPlainJsonArray, isPlainJsonRecord } from './json-schema.ts'

/** Outcome of parsing model-generated argument text. */
export type ParsedArguments =
  | { readonly ok: true; readonly value: unknown; readonly repaired: boolean }
  | { readonly ok: false; readonly error: string }

/**
 * Close brackets a model forgot at the very end, such as a missing final `}`. Text that ends inside a string is
 * left alone: it was cut off mid-value, and closing it would run the call with truncated content.
 */
function closeTruncated(text: string): string | undefined {
  const open: string[] = []
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') open.push('}')
    else if (char === '[') open.push(']')
    else if (char === '}' || char === ']') {
      if (open.pop() !== char) return undefined
    }
  }
  if (open.length === 0 || inString || open.length > 2) return undefined
  return text.replace(/,\s*$/u, '') + open.toReversed().join('')
}

/** Remove commas before a closing bracket outside strings. */
function dropTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ''
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    if (char === ',') {
      const rest = text.slice(index + 1).trimStart()
      if (rest.startsWith('}') || rest.startsWith(']')) continue
    }
    out += char
  }
  return out
}

/** Parse JSON, returning undefined instead of throwing. */
function tryParse(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return undefined
  }
}

/** A JSON object or array encoded as a JSON string once more. */
function unwrapEncoded(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const inner = value.trim()
  if (!(inner.startsWith('{') && inner.endsWith('}')) && !(inner.startsWith('[') && inner.endsWith(']'))) return value
  return tryParse(inner)?.value ?? value
}

/**
 * Parse tool-call argument text from a model, repairing common damage.
 * @param raw - argument text as the model produced it; empty means no arguments.
 * @returns the parsed value and whether it needed repair, or the parse error.
 */
export function parseToolArguments(raw: string): ParsedArguments {
  if (raw.trim().length === 0) return { ok: true, value: {}, repaired: false }
  const direct = tryParse(raw)
  if (direct !== undefined) {
    const value = unwrapEncoded(direct.value)
    return { ok: true, value, repaired: value !== direct.value }
  }
  let error: string
  try {
    JSON.parse(raw)
    error = 'invalid JSON'
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  let text = raw.trim()
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/u.exec(text)
  if (fenced?.[1] !== undefined) text = fenced[1].trim()
  // Prose around one object: keep the object.
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  const candidates = [text, dropTrailingCommas(text)]
  if (first > 0 && last > first) candidates.push(dropTrailingCommas(text.slice(first, last + 1)))
  for (const candidate of candidates) {
    const closed = closeTruncated(candidate)
    for (const attempt of closed === undefined ? [candidate] : [candidate, closed]) {
      const parsed = tryParse(attempt)
      if (parsed !== undefined && (isPlainJsonRecord(parsed.value) || isPlainJsonArray(parsed.value))) {
        return { ok: true, value: unwrapEncoded(parsed.value), repaired: true }
      }
    }
  }
  return { ok: false, error }
}

/** The single type a schema node accepts, when it names exactly one. */
function soleType(schema: JsonSchemaNode): string | undefined {
  return schema.oneOf === undefined && schema.enum === undefined && schema.const === undefined ? schema.type : undefined
}

/**
 * Convert values to the types a schema declares where the intent is unambiguous: `"5"` for a number or integer,
 * `"true"`/`"false"` for a boolean, a JSON string for an array or object, and one item for an array of that item's
 * type. `null` is left alone: for some tools an absent field means something (an empty replacement), so treating
 * `null` as absent could change what a call does. Everything else is left for validation to report.
 * @param schema - the parameter schema.
 * @param value - the arguments as parsed.
 * @returns the converted arguments; the input is never modified.
 */
export function coerceToSchema(schema: JsonSchemaNode, value: unknown): unknown {
  const type = soleType(schema)
  if (type === undefined) return value
  if (type === 'number' || type === 'integer') {
    if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/u.test(value)) {
      const number = Number(value)
      if (type === 'number' || Number.isInteger(number)) return number
    }
    return value
  }
  if (type === 'boolean') {
    if (value === 'true' || value === 'True') return true
    if (value === 'false' || value === 'False') return false
    return value
  }
  if (type === 'array') {
    let list = value
    if (typeof list === 'string') {
      const parsed = list.trim().startsWith('[') ? tryParse(list.trim()) : undefined
      if (parsed !== undefined && isPlainJsonArray(parsed.value)) list = parsed.value
      else if (schema.items !== undefined && soleType(schema.items) === 'string') list = [list]
    } else if (isPlainJsonRecord(list) && schema.items !== undefined && soleType(schema.items) === 'object') {
      list = [list]
    }
    if (!isPlainJsonArray(list)) return value
    const items = schema.items
    return items === undefined ? list : list.map(item => coerceToSchema(items, item))
  }
  if (type === 'object') {
    let record = value
    if (typeof record === 'string' && record.trim().startsWith('{')) record = tryParse(record.trim())?.value ?? record
    if (!isPlainJsonRecord(record)) return value
    const properties = schema.properties ?? {}
    const out: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(record)) {
      const declared = properties[key]
      if (declared === undefined) {
        out[key] = field
        continue
      }
      out[key] = coerceToSchema(declared, field)
    }
    return out
  }
  return value
}

/** A compact type for one schema node, such as `string`, `number[]` or `"a"|"b"`. */
function typeLabel(schema: JsonSchemaNode, depth: number): string {
  if (schema.enum !== undefined) return schema.enum.map(item => JSON.stringify(item)).join('|')
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.oneOf !== undefined) return schema.oneOf.map(branch => typeLabel(branch, depth)).join('|')
  if (schema.type === 'array') return `${schema.items === undefined ? 'any' : typeLabel(schema.items, depth)}[]`
  if (schema.type === 'object') return depth > 1 || schema.properties === undefined ? 'object' : argumentSignature(schema, depth + 1)
  return schema.type ?? 'any'
}

/**
 * The expected arguments as a short signature for error messages, such as
 * `{path: string, start_line?: integer, mode?: "read"|"write"}`.
 * @param schema - the parameter schema.
 * @param depth - nesting level; nested objects beyond the second level show as `object`.
 * @returns the signature.
 */
export function argumentSignature(schema: JsonSchemaNode, depth = 0): string {
  const required = new Set(schema.required ?? [])
  const fields = Object.entries(schema.properties ?? {}).map(([key, field]) => `${key}${required.has(key) ? '' : '?'}: ${typeLabel(field, depth)}`)
  return `{${fields.join(', ')}}`
}

/** Normalize a tool name for lookalike comparison: lower case, no separators, no namespace prefix. */
function normalizeName(name: string): string {
  const bare = name.includes('__') ? name.slice(name.lastIndexOf('__') + 2) : name
  return bare.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

/** Levenshtein distance, bounded for short names. */
function distance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0] ?? 0
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j] ?? 0
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[b.length] ?? 0
}

/**
 * Visible tool names that look like an unknown one: the same name with other case, separators or namespace first,
 * then names within a small edit distance or containing it.
 * @param requested - the name the model called.
 * @param available - names callable now.
 * @param limit - most suggestions to return.
 * @returns the closest names, best first.
 */
export function similarToolNames(requested: string, available: readonly string[], limit = 3): string[] {
  const wanted = normalizeName(requested)
  if (wanted.length === 0) return []
  const scored = available.map((name) => {
    const candidate = normalizeName(name)
    if (candidate === wanted) return { name, score: 0 }
    if (candidate.includes(wanted) || wanted.includes(candidate)) {
      return { name, score: 1 + Math.abs(candidate.length - wanted.length) / 100 }
    }
    const edits = distance(candidate, wanted)
    return { name, score: edits <= Math.max(2, Math.floor(wanted.length / 4)) ? 2 + edits : Number.POSITIVE_INFINITY }
  })
  return scored.filter(entry => Number.isFinite(entry.score)).toSorted((a, b) => a.score - b.score).slice(0, limit).map(entry => entry.name)
}
