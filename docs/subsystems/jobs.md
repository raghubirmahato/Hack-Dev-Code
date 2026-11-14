# Jobs

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxjobcontroller--jobcontroller"></a>

### `ctx.jobController` — `JobController`

Host service backing the generated `ctx.remote.job` namespace.

```ts cordis-catalog
/**
 * Stream the jobs one session can see — its own plus every unowned job —
 * as whole-set frames: one on open, then one after each coalesced burst of
 * lifecycle commits. The stream has no natural end; the carrier closes it.
 * @param request - the session whose visible set to mirror.
 * @param signal - cancellation owned by the Remote stream carrier.
 * @returns the roster frames.
 */
@Remote({ mode: 'stream' }) list(request: JobListRequest, signal: AbortSignal): AsyncIterable<JobListFrame>

/**
 * Stream one job's retained output from an absolute byte offset, then its
 * terminal projection once settled and drained. Non-consuming: the
 * model-facing cursor and notice state never observe these reads. The
 * request's session is the fenced read's caller; the registry rejects a
 * job the session cannot see and an unknown job.
 * @param request - target job, owning session, and optional resume offset.
 * @param signal - cancellation owned by the Remote stream carrier.
 * @returns anchor, coalesced output frames, and the terminal status.
 */
@Remote({ mode: 'stream' }) follow(request: JobFollowRequest, signal: AbortSignal): AsyncIterable<JobFollowFrame>

/**
 * Kill one background job on a human's behalf. The request's session is
 * the fenced read's caller, so the job must be one that session can see:
 * the registry's owner fence is the only access rule, and a child session's
 * own jobs are killable from its list like any other. The kill records
 * `cancelled by the user` as its reason; it is not one the model requested,
 * so the owning agent still receives the completion notice, and a shell
 * tool waiting on that job reads the reason in its own result.
 * @param request - Session whose job list carries the job, and the job id.
 * @returns the registry's admission of the kill request.
 */
@Remote('kill') kill(request: JobKillRequest): JobKillValue
```

Source: [`packages/api/job-controller/src/index.ts`](../../packages/api/job-controller/src/index.ts)

<a id="ctxjobs--jobregistry-abstract-seam"></a>

### `ctx.jobs` — `JobRegistry` (abstract seam)

Abstract background job registry. Subclass, implement the abstract members, and load the subclass as a plugin — it registers as `ctx.jobs` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior).

Implementations must honor these semantics:

- Registrations outlive producer and controller fibers. Owner and service disposal cancel live work and await compliant producers; a throwing teardown cancel force-fails only the record. Such settlements announce `cause: 'teardown'`, because a job whose owner is being destroyed has no reader left.
- Owned-job access is fenced by the owner's session id. Ids are predictable, so authorization — not secrecy — is the boundary.
- Settlement is first-wins: one terminal record, released waiters, then one round of contained event delivery, even against a late producer outcome. The `settled` event follows every released waiter and reports whether it released one (`awaited`), so a completion reporter can skip settlements a waiting caller already collected.
- A settled record stays listed until its owner's disposal, service disposal, or an explicit remove by a caller that collected the terminal state itself and never handed the id out.
- start refuses work while no attached job controller serves the spec's owner, so a producer cannot start work that owner cannot collect or stop. One registry serves every composition in the process, so this question — and event delivery under `{ owners: 'scope' }` — is owner-relative rather than process-wide: registrations made from an unscoped context serve every owner, and registrations made under an agent composition's scope serve exactly the agents composed under it.
- Every job owns one output ring. Pull sources named by the spec are pumped by the registry and drained once more before settlement; pushed appends land whole. The model's consuming cursor and observers' absolute offsets read the same bytes and never disturb each other.
- Ring retention is bounded. Appends past the live cap drop the oldest retained bytes; a reader below the retained window gets a lossy read, never an error. Settlement trims retention to the settled cap and ends the stream; the ring has no separate lifecycle.

```ts cordis-catalog
/**
 * Preflight access, validation, owner cleanup, and implementation-owned
 * admission before starting and atomically registering work. Any preflight
 * rejection leaves no job id or execution resource. A throwing starter
 * leaves nothing registered; after it returns, registration cannot fail.
 * @param spec - job identity, owner, output sources, and synchronous starter.
 * @returns the registry-issued `<kind>-<short-uuid>` id.
 */
abstract start(spec: JobSpec): JobId

/**
 * List caller-owned and unowned jobs in registration order.
 * @param caller - reading session; omission sees only unowned jobs.
 * @returns fresh projections.
 */
abstract list(caller?: SessionId): JobView[]

/**
 * Project one job without changing its cursor. Throws for an unknown or
 * foreign job.
 * @param id - job to look up.
 * @param caller - reading session checked against the owner.
 * @returns a fresh projection.
 */
abstract get(id: JobId, caller?: SessionId): JobView

/**
 * Consume the ring from the model cursor and advance it to the current
 * total. After settlement the first read also carries the producer's
 * result. Throws for an unknown or foreign job.
 * @param id - job to read.
 * @param caller - reading session checked against the owner.
 * @returns the chunks since the cursor, the lossy flag, the result once, and the post-read projection.
 */
abstract read(id: JobId, caller?: SessionId): JobRead

/**
 * Read retained ring output without moving the model cursor. Resume with
 * a previous read's `next`; an offset inside a retained chunk returns the
 * whole chunk (its `at` may precede `from`). Throws for a negative or
 * non-integer offset, or an unknown or foreign job.
 * @param id - job to read.
 * @param from - absolute byte offset to read from (0 for the retained head).
 * @param caller - reading session checked against the owner.
 * @returns retained chunks overlapping `[from, total)`, the resume offset, and the lossy flag.
 */
abstract readAt(id: JobId, from: number, caller?: SessionId): JobOutputRead

/**
 * Request cancellation, then mark the job stopping. A producer throw
 * propagates without changing job state. A supplied reason is merged into
 * terminal `detail` when the job settles `killed`. Throws for an unknown
 * or foreign job.
 * @param id - job to cancel.
 * @param caller - killing session checked against the owner.
 * @param reason - cancellation reason forwarded verbatim to the producer.
 * @returns `requested` for live work, otherwise `already-finished`.
 */
abstract kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished'

/**
 * Wait for settlement or timeout without cancelling the job. Caller abort
 * rejects only while the job is live; after settlement the terminal
 * projection wins. Rejects for an invalid timeout or an unknown or foreign
 * job.
 * @param id - job to wait for.
 * @param timeoutMs - positive finite wait bound in milliseconds.
 * @param caller - waiting session checked against the owner.
 * @param signal - optional cancellation of the wait itself.
 * @returns projection at settlement or timeout.
 */
abstract wait(id: JobId, timeoutMs: number, caller?: SessionId, signal?: AbortSignal): Promise<JobView>

/**
 * Drop one settled job's record from the visible set and announce
 * `removed`. For a caller that collected the terminal state through its own
 * {@link wait} and never handed the id to the model, such as a shell tool's
 * foreground call. Throws for a job that is still live, unknown, or foreign.
 * @param id - settled job to drop.
 * @param caller - removing session checked against the owner.
 */
abstract remove(id: JobId, caller?: SessionId): void

/**
 * Attach an effect-scoped controller that can read and stop jobs. It serves the
 * owners its registering context's scope covers, and {@link start} refuses an
 * owner no attached controller serves.
 * @param name - diagnostic label; duplicate names remain independent.
 * @returns disposer that detaches this controller.
 */
abstract attachController(name: string): () => void
```

Types: [SessionId](core.md)

Source: [`packages/jobs/jobs/src/index.ts`](../../packages/jobs/jobs/src/index.ts)
<!-- END GENERATED cordis-surface -->
