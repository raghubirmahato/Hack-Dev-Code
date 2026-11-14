# Schedule

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxschedule--scheduleservice"></a>

### `ctx.schedule` — `ScheduleService`

Shared management service; reads, deletion, and timing edits never activate a Session.

`sessionPersistence` is a load-order requirement rather than a directly called service: a delivery commits only when `ctx.sessions.flush()` reports that a `session/flush` listener participated, and the persistence backend providing this service is the plugin that registers that listener.

```ts cordis-catalog
/**
 * Create a reminder bound to the caller-selected Session without activating it.
 *
 * The request must supply a title; a missing, blank-after-trim, or over-long
 * title rejects with `invalid_prompt` instead of deriving one from the prompt.
 * A Session a delegated child owns rejects with `subagent_session`, because delivery
 * can never reach it: the child is one whose delegation depth is above zero.
 * The record is built from the clock reading taken before the request joins the
 * serialized queue, so a create that waits behind a longer operation keeps its
 * request-time anchor and may already be due when the queue reaches it.
 * @param sessionId - Original Session receiving the reminder.
 * @param request - Validated tool selector, required title, and reminder content.
 * @param signal - Optional cancellation checked before persistence begins, including after FIFO waits.
 * @returns The durably stored schedule. Cancellation does not roll back an in-flight write.
 */
async create(sessionId: SessionId, request: ScheduleCreateRequest, signal?: AbortSignal): Promise<ScheduleRecord>

/**
 * Read the selected Session's active tasks without resuming its Agent.
 * @param request - Session whose task list is requested.
 * @returns Persisted reminders in storage order.
 */
@Remote('list') async list(request: ScheduleListRequest): Promise<ScheduleRecord[]>

/**
 * Read all active and inactive Host reminders with their original Session bindings.
 * A deleted reminder has no row, so it is absent here.
 * Does not activate Sessions or read Session history.
 * @returns Reminders ordered by scheduledAt ascending, then lexicographically by id.
 */
@Remote('catalog') async catalog(): Promise<ScheduleCatalogEntry[]>

/**
 * Read saved inbox deliveries without activating or reading the original Session.
 * The task's own row supplies its binding, so its records stay readable through this lookup.
 * @param request - Session binding, task identity, explicit limit, and optional exclusive message cursor.
 * @returns Newest-first deliveries in append order, or a task/cursor lookup failure.
 * @throws ScheduleInputError when limit is not a safe integer from 1 through 100.
 */
@Remote('history') async history(request: ScheduleDeliveryHistoryRequest): Promise<ScheduleDeliveryHistoryResult>

/**
 * Delete one task belonging to the selected Session, leaving queued messages intact.
 *
 * The row is removed: the task no longer schedules, leaves `list` and `catalog`, and its
 * saved delivery records go with it. A task bound to a Session a delegated child owns
 * stays deletable even though creation and timing edits refuse that binding, so a task
 * stored before that rule existed remains removable.
 * @param request - Session and exact task identity.
 * @param signal - Optional cancellation checked before persistence begins, including after FIFO waits.
 * @returns Whether that Session owned a deleted task. Cancellation does not roll back an in-flight write.
 */
@Remote('delete') async delete(request: ScheduleDeleteRequest, signal?: AbortSignal): Promise<ScheduleDeleteResult>

/**
 * Delete every ended Host task, leaving active tasks armed.
 *
 * Ended tasks never schedule another delivery, so the removal changes no pending
 * target and no timer is recomputed. Rows are enumerated and removed in one FIFO
 * slot, so a delivery ordered behind this call ends its task after the
 * enumeration rather than during it. The batch is one domain write: a normal
 * failure rejects with every listed row still stored, while a backend
 * `unknown-state` failure may have removed rows and quarantines the Host
 * domain, so later schedule operations reject until the domain is reopened.
 * Every rejection announces `schedule/changed` because it does not establish
 * which rows landed, and clients then re-read the catalog.
 * @returns Count of removed rows; zero when the Host held no ended task.
 */
@Remote('deleteInactive') async deleteInactive(): Promise<ScheduleDeleteInactiveResult>

/**
 * Update the name, instruction, and timing of an active task within the original Session
 * binding without activating the Session or changing saved deliveries.
 *
 * Each supplied field replaces its stored value; an omitted field keeps it. A name or
 * instruction change alone does not reset the committed target. A Session a delegated
 * child owns returns the non-mutating `subagent_session` result, so an edit cannot
 * re-arm a task bound to a Session delivery can never reach, and the Web editor can
 * explain the refusal through the ordinary result it already renders.
 * @param request - Task binding, complete observed record, and any combination of timing, name, and instruction.
 * @param signal - Cancellation checked after domain readiness and FIFO waits, before persistence begins.
 * @returns The committed record, unchanged record for a no-op, or a non-mutating input/lookup/conflict/refusal result.
 * Storage and lifecycle failures reject; cancellation after a write starts does not roll it back.
 */
@Remote('update') async update(request: ScheduleUpdateRequest, signal?: AbortSignal): Promise<ScheduleUpdateResult>
```

Types: [SessionId](core.md)

Source: [`packages/schedule/schedule/src/index.ts`](../../packages/schedule/schedule/src/index.ts)

<a id="schedule-events"></a>

### `schedule/*` events

<a id="schedulechanged--emit"></a>

#### `schedule/changed` — emit

Durable task set changed; clients refetch global task and Session-active catalogs.

```ts cordis-catalog
/** Durable task set changed; clients refetch global task and Session-active catalogs.
 * @mode emit
 */
'schedule/changed'(): void
```

Source: [`packages/schedule/schedule/src/types.ts`](../../packages/schedule/schedule/src/types.ts)

<a id="scheduleresolve-agent--waterfall"></a>

#### `schedule/resolve-agent` — waterfall

Restore a reminder's Session through its embedding's owning controller. Call next() to use the Web Session controller.

```ts cordis-catalog
/**
 * Restore a reminder's Session through its embedding's owning controller.
 * Call next() to use the Web Session controller.
 * @param sessionId - Original Session receiving the reminder.
 * @mode waterfall
 */
'schedule/resolve-agent'(sessionId: SessionId, next: () => Promise<Agent>): Promise<Agent>
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/schedule/schedule/src/index.ts`](../../packages/schedule/schedule/src/index.ts)
<!-- END GENERATED cordis-surface -->
