/**
 * Durable checkpoints for undoing a prompt's file changes: the snapshot object store and a per-Session index of each
 * recorded turn's turn-start and turn-end tree ids, kept under one directory per working directory so they outlive
 * the Session's process.
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One recorded turn: the `workspace/changes` event's sequence, its turn, and its snapshot tree ids. */
export interface Checkpoint {
  seq: number
  turn: number
  before: string
  after: string
}

/**
 * The directory holding one working directory's snapshot objects and checkpoint index, created on first use.
 * @param root - the checkpoint root, such as `checkpoints` in the Hack Dev Code home.
 * @param cwd - the Session's working directory.
 * @returns the absolute directory.
 */
export async function checkpointDir(root: string, cwd: string): Promise<string> {
  const key = createHash('sha256').update(cwd).digest('hex').slice(0, 24)
  const directory = join(root, key)
  await mkdir(join(directory, 'sessions'), { recursive: true })
  return directory
}

/** Session ids are file names here; anything else is refused rather than escaped. */
function indexFile(directory: string, sessionId: string): string {
  if (!/^[\w.-]+$/u.test(sessionId)) throw new Error(`unsupported session id for checkpoints: ${sessionId}`)
  return join(directory, 'sessions', `${sessionId}.jsonl`)
}

/**
 * Add one recorded turn to a Session's checkpoint index.
 * @param directory - from {@link checkpointDir}.
 * @param sessionId - the Session.
 * @param checkpoint - the turn's record.
 */
export async function appendCheckpoint(directory: string, sessionId: string, checkpoint: Checkpoint): Promise<void> {
  await appendFile(indexFile(directory, sessionId), `${JSON.stringify(checkpoint)}\n`, 'utf8')
}

/**
 * A Session's recorded turns in order. A damaged line is skipped: the index is a convenience, and the remaining
 * lines still describe their turns.
 * @param directory - from {@link checkpointDir}.
 * @param sessionId - the Session.
 * @returns the checkpoints, empty when none were recorded.
 */
export async function readCheckpoints(directory: string, sessionId: string): Promise<Checkpoint[]> {
  let text: string
  try {
    text = await readFile(indexFile(directory, sessionId), 'utf8')
  } catch {
    return []
  }
  const out: Checkpoint[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line) as Partial<Checkpoint>
      if (typeof value.seq === 'number' && typeof value.turn === 'number' && typeof value.before === 'string' && typeof value.after === 'string') {
        out.push({ seq: value.seq, turn: value.turn, before: value.before, after: value.after })
      }
    } catch {
      // Skip a damaged line.
    }
  }
  return out
}

/**
 * Give a Session the checkpoints of another one's turns up to a point, for a Session that continues that one's
 * conversation; the new index replaces any the Session had.
 * @param directory - from {@link checkpointDir}.
 * @param from - the Session whose turns are copied.
 * @param to - the Session that receives them.
 * @param throughTurn - the last turn copied.
 */
export async function copyCheckpoints(directory: string, from: string, to: string, throughTurn: number): Promise<void> {
  const kept = (await readCheckpoints(directory, from)).filter(checkpoint => checkpoint.turn <= throughTurn)
  await writeFile(indexFile(directory, to), kept.map(checkpoint => `${JSON.stringify(checkpoint)}\n`).join(''), 'utf8')
}

/**
 * The snapshot that shows the workspace as it was right after a turn: the turn-start tree of the first later turn
 * that was recorded. Turns are compared by number, since a turn's record can be appended just after its end.
 * Without a later record, no recorded turn changed files after that point.
 * @param checkpoints - the Session's recorded turns.
 * @param afterTurn - the last turn to keep; 0 undoes every recorded turn.
 * @returns the tree id, or undefined when there is nothing to undo.
 */
export function rewindTarget(checkpoints: readonly Checkpoint[], afterTurn: number): string | undefined {
  return checkpoints.filter(checkpoint => checkpoint.turn > afterTurn).sort((a, b) => a.seq - b.seq)[0]?.before
}
