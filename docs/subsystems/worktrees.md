# Worktrees

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworktrees--worktreeservice"></a>

### `ctx.worktrees` — `WorktreeService`

Creates retained Git worktrees under the mounted filesystem and sandbox providers.

```ts cordis-catalog
/**
 * Create a fresh branch and checkout at a pinned local revision, then enter it.
 * Existing branches or checkout paths fail. Uncommitted files stay in the source checkout.
 * Checkout disables configured clean, smudge, and process filters without changing Git config.
 * Repository-local replacement refs still apply; baseCommit reports the resolved object name.
 * The new checkout becomes current only after Git setup succeeds. Failures may retain newly
 * allocated Git/filesystem artifacts; no branch or checkout is removed automatically.
 * @param agent - caller whose current directory selects the source repository and file policy.
 * @param request - optional new name and local revision; defaults are generated name and HEAD.
 * @param signal - cancellation of lookup, creation, and working-directory publication.
 * @param onPhase - receives each stage before it begins; it must not throw.
 * @returns canonical checkout path, branch name, pinned commit, and source repository root.
 */
async create( agent: Agent, request: CreateWorktreeRequest = {}, signal?: AbortSignal, onPhase?: (phase: CreateWorktreePhase) => void, ): Promise<CreatedWorktree>

/**
 * Check out a removed worktree again at its recorded directory: its branch
 * when the branch still exists, otherwise a new branch of the same name at
 * `baseCommit`. Only the missing target's unlocked registration is removed, and an
 * existing directory fails. Changes that were never committed are not
 * recovered. Checkout disables configured clean, smudge, and process filters,
 * as creation does. The calling Session's working directory does not change.
 * Failures may retain newly allocated Git/filesystem artifacts.
 * @param agent - caller whose sandbox policy confines the commands.
 * @param request - recorded directory, branch, base commit, and source repository root.
 * @param signal - cancellation of the restoration.
 * @param onPhase - receives each stage before it begins; it must not throw.
 * @returns the directory and whether the branch was created again.
 */
async restore( agent: Agent, request: RestoreWorktreeRequest, signal?: AbortSignal, onPhase?: (phase: CreateWorktreePhase) => void, ): Promise<RestoredWorktree>
```

Types: [Agent](core.md)

Source: [`packages/experimental/worktree/src/index.ts`](../../packages/experimental/worktree/src/index.ts)
<!-- END GENERATED cordis-surface -->
