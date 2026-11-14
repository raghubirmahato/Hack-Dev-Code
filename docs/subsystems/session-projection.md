# Session projection

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionprojectioncache--sessionprojectioncache"></a>

### `ctx.sessionProjectionCache` — `SessionProjectionCache`

The persisted projection cache service. Opens the `session_projcache` domain at init, checkpoints live sessions on a throttled write-behind (count/interval triggers from Config) plus three mandatory points — session creation, `turn/end`, and session disposal (the live-to-cold moment) — and serves the cached rows for a session header. Every durable write is fail-soft: failures log a warning and the cache self-heals on the next write.

```ts cordis-catalog
/**
 * The zero-I/O listing read: whole values viewed straight from the stored
 * rows (version-matching keys only) of the record bound to the caller's
 * lifecycle. The header is the only identity witness a listing holds, so
 * this face matches the lifecycle identity (`formatVersion`, `createdAt`,
 * `cwd`, `isSeeded`) and not the inherited cut: within one format
 * generation the cut is fixed at fork time, so it distinguishes no
 * lifecycle the other fields do not, and a viewed value never seeds a fold.
 * The view is as stale as the last durable checkpoint but never wrong and
 * never from an unrelated log. Its `asOfSeq` is the lowest watermark among
 * the served rows: the stored record's own position, which the header
 * cannot relate to the log the caller later opens. The Session list
 * therefore labels the block as cached, and the client lets every value the
 * connected Session produces supersede it whatever this number says.
 * @param meta - the listed session's header (identity witness; no log read).
 * @param keys - optional projection keys required by the caller's audience.
 * @returns the viewed block, or `undefined` when no usable row exists for
 *   this lifecycle at the current Session format.
 */
cachedSnapshot( meta: SessionHeader, keys?: ProjectionKeySelection, ): ProjectionSnapshot | undefined

/**
 * Read only a predecessor checkpoint's title as a zero-I/O listing hint.
 *
 * The authoritative Session header supplies the lifecycle identity. A cache
 * checkpoint can lag that log but cannot lead it because writes flush the
 * log first, so a matching predecessor title is a genuine (possibly stale)
 * fact from this Session. The registry still requires the current title
 * projection's row version and schema. No other predecessor projection is
 * exposed: format normalization can change their current meaning, and the
 * {@link cachedSnapshot} / hydration paths continue to reject them.
 * @param meta - authoritative listed Session header.
 * @returns a title-only block at the stored title row's watermark, or
 *   `undefined` when the record is current, newer, unrelated, missing, or
 *   incompatible with the title unit.
 */
cachedPredecessorTitle(meta: SessionHeader): ProjectionSnapshot | undefined

/**
 * Hydrate projection cells for an already-prepared Session without another
 * persistence read. The cache seeds matching rows; the supplied exact log
 * advances every unit to the observation cut. No checkpoint is written
 * because the logical observation may contain recovery events not yet durable.
 * @param session - exact unpublished Session retained by persistence.
 * @param events - exact logical event prefix represented by the observation.
 * @returns all projection values at the event cut.
 */
hydratePrepared( session: Session, events: readonly SessionEvent[], ): ProjectionSnapshot

/**
 * Durably checkpoint one live session NOW (all mandatory points call
 * this; tests and carriers may too). The registry cut is snapshotted at
 * this boundary (states are live references), then the session's record is
 * replaced on the domain's write chain. NOT fail-soft — callers on the
 * fail-soft paths contain it.
 * @param session - the live session to checkpoint.
 * @returns resolution after durability and event emission.
 */
async write(session: Session): Promise<void>

/**
 * Cold-read one session's projections from its complete log. Each unit is
 * seeded from the identity-checked cached rows — the registry skips `apply`
 * for the already-folded prefix (events at or below the row's `seq`) — and
 * the refreshed checkpoint is written back (fail-soft, fire-and-forget), so
 * the first cold read creates the cache row and later ones seed from it.
 * The caller supplies the complete log in seq order: this service never
 * consults the persistence layer.
 * @param meta - the stored session header (identity witness).
 * @param inheritedEventCount - exact inherited prefix length for projection initialization and identity.
 * @param events - the session's complete log, in seq order.
 * @returns the projection cut at the log end.
 */
coldSnapshot( meta: SessionHeader, inheritedEventCount: SessionLogOffset, events: readonly SessionEvent[], ): ProjectionSnapshot
```

Types: [Session](session.md) · [SessionEvent](session.md) · [SessionHeader](persistence.md) · [SessionLogOffset](session.md)

Source: [`packages/session/session-projection-cache/src/index.ts`](../../packages/session/session-projection-cache/src/index.ts)

<a id="ctxsessionprojections--sessionprojectionregistry"></a>

### `ctx.sessionProjections` — `SessionProjectionRegistry`

`ctx.sessionProjections`: the projection unit table and its drive. The service subscribes to `session/event` once; every committed event passes every registered unit's `apply` (eager drive). A changed state reference computes the next client view; the change feed is notified only when its raw result changes by `Object.is`. Cells build lazily — a unit registered after events flowed, or a session older than the registry, folds `init` over the in-memory log on first touch (event or read). Consumers declare `sessionProjections` as a required injection, await registration during activation, and retain its ready handle. Registrants sharing a key share one unit and are counted. The last release removes the unit from live drives, checkpoints, and client snapshots; retained handles still fold new events on demand using the original unit.

```ts cordis-catalog
/**
 * Register one domain's unit on the calling context's fiber. Fiber or handle
 * disposal releases one reference; the final release removes live participation.
 * Retained handles remain readable after release.
 * Callers must await registration before publishing consumers; registration may perform asynchronous work.
 * @param definition - key, state schema, pure unit functions, and stateVersion.
 * @returns an awaitable yielding a ready handle; the callable runtime value is deprecated.
 */
register<K extends keyof SessionProjectionMap, S>( definition: Omit<ProjectionDefinition<K, S>, 'wire'> & { wire: NonNullable<ProjectionDefinition<K, S>['wire']> }, ): Promise<ProjectionHandle<S>>

/**
 * Register one host-only unit. Its state is omitted from client snapshots
 * and always checkpointed like every other unit.
 * Callers must await registration before publishing consumers; registration may perform asynchronous work.
 * @param definition - key, state schema, pure unit functions, and stateVersion.
 * @returns an awaitable yielding a ready handle; the callable runtime value is deprecated.
 */
register<K extends string, S>( definition: ProjectionDefinition<K, S> & { key: Exclude<K, keyof SessionProjectionMap> }, ): Promise<ProjectionHandle<S>>

/**
 * Subscribe to the change feed. The registration is an effect on the
 * calling context's fiber.
 * @param listener - called once per client-visible unit whose raw view changed by `Object.is`, per committed event.
 * @returns the exact disposer that unsubscribes.
 */
onChanged(listener: ProjectionChangeListener): () => void

/**
 * One consistent cut over every registered client-visible unit for one session, read from
 * the watermark cache (missing cells fold lazily over the in-memory log).
 * Fully synchronous — every value and `asOfSeq` reflect the same log
 * position. Each value passes its unit's `viewSchema` before leaving.
 * @param session - the session whose projection values are read.
 * @param keys - optional client-visible outputs; state materialization remains complete.
 * @returns the snapshot; `values` is empty when no selected client-visible unit is registered.
 */
snapshot( session: Session, keys?: ProjectionKeySelection, ): ProjectionSnapshot

/**
 * Read only already-materialized client-visible cells without folding history.
 * Values may trail the live Session and are therefore hints, not a complete
 * baseline. Missing cells are omitted.
 * @param session - attached Session whose cached cells are inspected.
 * @param keys - optional wire keys to view.
 * @returns the lowest common cached cut, or `undefined` when no wire cell exists.
 */
cachedSnapshot( session: Session, keys?: ProjectionKeySelection, ): ProjectionSnapshot | undefined

/**
 * The keys a Session summary carries: every registered client-visible key
 * whose unit does not declare `summary: false`. The returned set is stable —
 * the same instance on every call — until a registration or its disposal
 * changes the key table, so a consumer may hold it across rows. Callers pass
 * it to a key-taking read face such as `cachedSnapshot(session, summaryKeys())`
 * or `viewCheckpoint(rows, summaryKeys())`; those faces use the set as-is.
 * @returns the current summary key set; do not mutate it.
 */
summaryKeys(): ReadonlySet<Extract<keyof SessionProjectionMap, string>>

/**
 * State-level checkpoint of every persisted unit for one session, read
 * from the watermark cache (missing cells fold lazily over the in-memory
 * log). This is the write side of the persisted projection cache: the
 * returned rows are the `(key → {ver, seq, val})` part of the durable
 * `(sessionId, key, ver, seq, val)`
 * rows. Every `val` is a DETACHED structured clone — never the live
 * cell reference: the watermark cache is this registry's authoritative
 * mutable state, and a caller reaching the live reference could corrupt
 * every subsequent snapshot and frame through it (plain JSON by the unit
 * contract, so the clone is total).
 * @param session - the session whose unit states are checkpointed.
 * @returns one row per registered key.
 */
checkpoint(session: Session): ProjectionCheckpoint

/**
 * The stored seq a {@link restore} tail read over `checkpoint` must start
 * at: one event BELOW the lowest usable watermark (a row is usable when
 * its `ver` matches the live unit's `stateVersion`; an absent or mismatched row
 * pulls the floor to `0` — that key must refold the full log). The
 * one-below anchor is load-bearing: the tail then proves how far the
 * stored log still extends, so {@link restore} can detect a log that
 * shrank below a row's watermark (crash-repair truncation) instead of
 * serving the stale row as current — an empty tail read from the anchor
 * yields an end below every watermark and the restore rejects for a full
 * re-read.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @returns the offset for the stored-log suffix read (`SessionHandle.read`),
 *   or `undefined` when no unit is registered (no read needed —
 *   {@link restore} would serve empty values regardless).
 */
restoreFloor(checkpoint: ProjectionCheckpoint): SessionLogOffset | undefined

/**
 * View a checkpoint's rows without any log read: for every registered
 * client-visible unit whose row's `ver` matches, serve the schema-validated
 * `view` of the schema-validated stored state; mismatched, malformed, or absent rows leave their key
 * absent (a cold or listing consumer treats it as not-yet-available and a
 * fuller read path refolds it). The zero-I/O rung of the read ladder —
 * values are as stale as their rows, never wrong.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @param keys - optional wire keys to view.
 * @returns whole values per key with a usable row; empty when none.
 */
viewCheckpoint( checkpoint: ProjectionCheckpoint, keys?: ProjectionKeySelection, ): Partial<SessionProjectionMap>

/**
 * Cold read: fold every persisted unit over a stored log suffix, seeding
 * each from its checkpoint row when usable — the one read recipe (cached
 * state + forward tail replay + `view`) applied without a live `Session`.
 * Call with the stored events at or past `restoreFloor(checkpoint)` (a
 * `SessionHandle.read` slice) and that same floor as
 * `baseSeq`; the floor's one-below anchor makes the supplied end honest,
 * so a shrunk log is detected here. A row is usable iff its
 * `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq`
 * (`seq >= baseSeq - 1`), and it does not claim events past the
 * supplied end (`seq <= endSeq`); an unusable row is discarded
 * and its key refolds from `init` — which is only sound over the full
 * log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
 * from seq 0, e.g. after a crash-repair truncation shrank the log below
 * a row's watermark).
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @param events - the stored events with `seq >= baseSeq`, in seq order.
 * @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
 * @param header - immutable metadata for the Session being restored.
 * @param inheritedEventCount - exact fork-inherited prefix length supplied to unit initialization.
 * @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
 *   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
 *   refreshed checkpoint rows at that cut, ready for a durable write-back.
 */
restore( checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: SessionLogOffset, header: SessionHeader, inheritedEventCount: SessionLogOffset, ): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }

/**
 * Restore an exact cut and install its states on the supplied prepared Session.
 * A later publication reuses these cells; ordinary live reads and event drive
 * advance any constructor-owned suffix exactly once.
 * @param session - exact prepared Session that owns the restored log prefix.
 * @param checkpoint - persisted rows for this Session lifecycle.
 * @param events - exact events at the observation cut.
 * @param baseSeq - first supplied event sequence.
 * @returns all projection values at the supplied cut.
 */
hydrate( session: Session, checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: SessionLogOffset, ): ProjectionSnapshot
```

Types: [Session](session.md) · [SessionEvent](session.md) · [SessionHeader](persistence.md) · [SessionLogOffset](session.md)

Source: [`packages/session/session-projection/src/index.ts`](../../packages/session/session-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
