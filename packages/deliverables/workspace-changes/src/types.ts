/** Per-turn workspace change summaries, the Session event announcing them, and the Host service serving them with their comparisons. */
import type { SessionId } from '@hackdevcode/dsh-session/types'

/** One file changed during a turn, with line counts from git or from the whole-file captures around its file-tool edits. */
export interface WorkspaceChangedFile {
  /** Path relative to the Session working directory, or an absolute Host path outside it. */
  path: string
  /**
   * Sort key and label: the relative path inside the working directory, a
   * `../` path for repository files above it, a `~` path under the home
   * directory, otherwise the absolute path. Always slash-separated.
   */
  display: string
  /** Lines added; zero for a binary or oversized file. */
  added: number
  /** Lines deleted; zero for a binary or oversized file. */
  deleted: number
  /** Present when git reported the file as binary, or when a captured side holds a NUL byte. */
  binary?: true
  /** Present when a captured side exceeded the plugin's `maxFileBytes`; the file is listed without counts or comparison. */
  oversized?: true
}

/** Files changed during one top-level turn, kept on the Host until its Session is disposed. */
export interface WorkspaceChangesSummary {
  /** The turn whose file changes this summary describes. */
  turn: number
  /** The Session working directory `path` values are relative to. */
  cwd: string
  /** Changed files in `display` order, capped at the plugin's `maxFiles`. */
  files: WorkspaceChangedFile[]
  /** Complete changed-file count, including files omitted by the cap. */
  total: number
  /** Lines added over every changed file, including files omitted by the cap. */
  added: number
  /** Lines deleted over every changed file, including files omitted by the cap. */
  deleted: number
  /** Git tree ids of the turn-start and turn-end snapshots; absent when no snapshot was taken. */
  snapshot?: { before: string; after: string }
}

/** One unified-diff hunk with three context lines; every line keeps its `+`, `-`, or space prefix. */
export interface WorkspaceDiffHunk {
  /** First line of the hunk in the turn-start content, 1-based; a side without lines starts at 1 with zero lines. */
  oldStart: number
  /** Lines of the hunk taken from the turn-start content. */
  oldLines: number
  /** First line of the hunk in the turn-end content, 1-based; a side without lines starts at 1 with zero lines. */
  newStart: number
  /** Lines of the hunk taken from the turn-end content. */
  newLines: number
  /** Hunk body in order, each line prefixed with `+`, `-`, or a space. */
  lines: string[]
}

/** The comparison of one listed file's turn-start and turn-end contents, computed when asked for. */
export type WorkspaceFileDiff =
  | {
    kind: 'text'
    /** The listed file's `path`. */
    path: string
    /** The listed file's `display`. */
    display: string
    /** Whether the file existed at turn start. */
    before: boolean
    /** Whether the file existed at turn end. */
    after: boolean
    /** Hunks in file order; empty when both sides hold the same lines. */
    hunks: WorkspaceDiffHunk[]
    /** True when the line comparison exceeded the plugin's `diffTimeoutMs` and every line is shown as replaced. */
    coarse: boolean
  }
  /** A side git reported as binary or that holds a NUL byte; no lines are served. */
  | { kind: 'binary'; path: string; display: string }
  /** A side larger than the plugin's `maxFileBytes`; no lines are served. */
  | { kind: 'oversized'; path: string; display: string }

/** Serves the summaries and file comparisons the recorder keeps for live Sessions. */
export interface WorkspaceChanges {
  /**
   * The summary announced by one `workspace/changes` event.
   * @param sessionId - the Session that appended the event.
   * @param seq - the event's sequence number.
   * @returns the summary, or undefined once its Session was disposed or when this Host never recorded it.
   */
  summary(sessionId: SessionId, seq: number): WorkspaceChangesSummary | undefined
  /**
   * Compare one listed file's contents at turn start and turn end.
   * @param sessionId - the Session that appended the event.
   * @param seq - the event's sequence number.
   * @param index - the file's index in the summary's `files`.
   * @param signal - cancels the reads.
   * @returns the comparison, or undefined once its Session was disposed, when this Host never recorded it, or when no file has that index.
   * @throws when a snapshot read fails for a live Session.
   */
  diff(sessionId: SessionId, seq: number, index: number, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
  /**
   * Put the workspace's files back to how they were right after a turn, undoing the changes of every later recorded
   * turn: files written since are restored, files created since are removed, ignored files are left alone. Works from
   * durable checkpoints, so it also serves a Session that has ended; it needs git and a git repository.
   * @param sessionId - the Session whose turns are undone.
   * @param cwd - its working directory.
   * @param afterTurn - the last turn to keep; 0 undoes every recorded turn.
   * @param signal - cancels the git commands.
   * @returns what changed, empty when no recorded turn changed files after that point.
   * @throws when git is unavailable, the directory is no longer a repository, or a git command fails.
   */
  restore(sessionId: SessionId, cwd: string, afterTurn: number, signal: AbortSignal): Promise<WorkspaceRestore>
  /**
   * Give a Session that continues another one's conversation, such as the one an undo creates, that Session's file
   * checkpoints up to a turn, so {@link WorkspaceChanges.restore} can later undo those turns from the new Session too.
   * @param fromSessionId - the Session whose turns are kept.
   * @param toSessionId - the new Session.
   * @param cwd - the shared working directory.
   * @param throughTurn - the last kept turn.
   */
  inherit(fromSessionId: SessionId, toSessionId: SessionId, cwd: string, throughTurn: number): Promise<void>
}

/** What putting files back changed in the workspace. */
export interface WorkspaceRestore {
  /** Paths written back, relative to the repository root. */
  restored: string[]
  /** Paths removed because they did not exist at that point. */
  removed: string[]
  /** Snapshot tree of the files just before the restore, when it changed anything. */
  backup?: string
}

declare module '@hackdevcode/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A completed top-level turn's changed files were summarized; the summary itself stays on the
     * Host and is served by `workspaceChanges.summary` for the event's sequence while the Session
     * lives. The latest event for one turn replaces earlier ones.
     */
    'workspace/changes': { turn: number }
  }
}

declare module '@hackdevcode/cordis' {
  interface Context {
    /** Per-turn changed-file summaries and comparisons of live Sessions. */
    workspaceChanges: WorkspaceChanges
  }
}
