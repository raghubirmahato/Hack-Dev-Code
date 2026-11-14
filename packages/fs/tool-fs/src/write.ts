/**
 * Model-facing full-file write. It obtains an optional intent from the single policy slot, calls
 * `ctx.fs.writeText` without a stat, then records the resulting version; no policy means an
 * unconditional atomic create-or-overwrite.
 * @module @hackdevcode/dsh-tool-fs/src/write
 */

import type { Context } from '@hackdevcode/cordis'
import { defineTool } from '@hackdevcode/dsh-tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@hackdevcode/dsh-tools'
import type { FsWriteOutcome } from '@hackdevcode/dsh-fs'
import type {} from '@hackdevcode/dsh-fs'
import { computeHunkDiffs, diffsFromMeta, pathFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import { mutationResult } from './mutation-result.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'

/** One line as the `read` tool shows it: its line number, a colon and a space, then the text. */
const NUMBERED_LINE = /^(\d+): ?/u

/**
 * Remove the line numbers a model copied from `read` output into a whole file. Weaker models do this, and the file
 * then fails to parse. Only content whose every line carries a number, counting 1, 2, 3 … without a gap, is changed;
 * a file that really looks like that is unlikely enough that writing it unchanged is the worse outcome.
 * @param content - the full file text the model sent.
 * @returns the text without the numbers, or the text unchanged when it is not numbered that way.
 */
export function stripReadLineNumbers(content: string): string {
  const lines = content.split('\n')
  const body = lines.at(-1) === '' ? lines.slice(0, -1) : lines
  if (body.length < 2) return content
  const stripped: string[] = []
  for (const [index, line] of body.entries()) {
    const match = NUMBERED_LINE.exec(line)
    if (match === null || Number(match[1]) !== index + 1) return content
    stripped.push(line.slice(match[0].length))
  }
  return body.length === lines.length ? stripped.join('\n') : `${stripped.join('\n')}\n`
}

/**
 * Validate value constraints the schema DSL can't express: only a non-blank
 * `file_path` — an empty `content` is legitimate (it writes an empty file).
 * @param args - the schema-validated raw tool arguments.
 * @returns the camelCased input; `content` loses only line numbers copied from `read` output.
 */
export function parseWriteArgs(args: { file_path: string; content: string }): { filePath: string; content: string } {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  return { filePath: args.file_path, content: stripReadLineNumbers(args.content) }
}

/**
 * Format a write outcome as one model-facing text block body.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param outcome - the write outcome; its `operation` selects the Created/Updated wording.
 * @returns the model-facing confirmation envelope (no file content is echoed back).
 */
export function formatWriteOutput(displayPath: string, outcome: Pick<FsWriteOutcome, 'operation'>): string {
  const verb = outcome.operation === 'create' ? 'Created' : 'Updated'
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${verb} file
</content>`
}

/**
 * The `write` tool's validated arguments: the base parameters plus the
 * two escalation fields, advertised only under a confining `ctx.fs` (absent
 * from the schema otherwise, so the validator rejects them before `execute`).
 */
interface WriteToolArgs {
  file_path: string
  content: string
  sandbox_permissions?: string
  justification?: string
}

/**
 * Register the `write` tool and its scope-aware system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 */
export function applyWriteTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:write',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WRITE'),
    text: ({ scope }) => ctx.tools.get('write', scope) === undefined
      ? ''
      : 'Read an existing file before overwriting it with write (the default fs-observation-policy requires it)'
        + (ctx.tools.get('edit', scope) === undefined ? '' : ' and prefer edit for targeted changes')
        + '.',
  })

  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Create or fully replace a UTF-8 text file.',
    parameters: {
      file_path: {
        type: 'string', required: true,
        description: 'Path to write, resolved by the filesystem backend. '
          + 'Provide `file_path` before `content` in the arguments.',
      },
      content: { type: 'string', required: true, description: 'Full UTF-8 text content to write.' },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true, description: 'Canonical absolute path in the filesystem execution world.' },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          before: {
            required: true,
            oneOf: [
              { type: 'string' },
              { type: 'null' },
            ],
          },
          after: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatWriteOutput(value.path, value) }],
      presentationMeta: (_args, value) => ({
        operation: value.operation,
        path: value.path,
        diffs: value.before === null
          ? []
          : computeHunkDiffs(value.path, value.before, value.after)
            .map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: WriteToolArgs, exec) {
      const input = parseWriteArgs(args)
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes;
      // an escalating call throws its distinct text on any non-grant.
      const sandboxPolicy = await sandbox.resolvePolicy('write', args, exec)
      const target = await ctx.fs.resolve(input.filePath, await sessionResolveOptions(ctx, exec))
      // Single-slot decision: the policy plugin produces createIfAbsent/
      // replaceIfVersion; the bare default is undefined (unconditional). No stat.
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      let outcome: FsWriteOutcome
      try {
        outcome = await ctx.fs.writeText(target, input.content, intent, exec.signal, sandboxPolicy)
      } catch (error: unknown) {
        // A sandbox denial becomes the shared [sandbox: …] marker (the model
        // recognizes it from bash); guarded mutation failures receive their
        // stable model-facing diagnostic; anything else passes through.
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath)
      }
      return mutationResult(ctx, target, outcome, exec)
    },
    // Pure display: a diff card. A call-time presenter has no access to prior
    // file content, so `oldText: null` also represents an overwrite here.
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Write ${args.file_path}`,
        diffs: [{ path: args.file_path, oldText: null, newText: stripReadLineNumbers(args.content) }],
        locations: [{ path: args.file_path }],
      }
    },
    // Result-time display repeats the diff because completed views replace the
    // pending view. Overwrites use applied metadata; creates and identical
    // overwrites use the replay-safe args fallback.
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
        ?? [{ path: pathFromMeta(result.meta) ?? args.file_path, oldText: null, newText: stripReadLineNumbers(args.content) }]
      return { card: 'diff', title: `Write ${args.file_path}`, diffs }
    },
  }))
}
