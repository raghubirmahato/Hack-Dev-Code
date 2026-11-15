# Feedback

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

## Feedback in exported Session logs

This section is for consumers that select rated Sessions from exported logs. The [OTel backend](../../packages/session/session-telemetry-otel/README.md#use-this-package) owns the record fields and the feedback that releases a log prefix; the [session-telemetry subsystem](session-telemetry.md) owns deduplication, and [the redact waterfall](session-telemetry.md#session-telemetryrecord--waterfall) owns how exported `data` can differ from the canonical log. The feedback-specific `data` fields are:

| Event | Target | `data` | Meaning |
|---|---|---|---|
| `feedback/record` | Whole Session | `text?`, `category?` | One immutable remark. `/feedback <text>` records only `text`; the Web dialog records the selected `category` and the entered `text`, each optional; a record with neither field is valid. |
| `feedback/message-put` | One assistant message | `sessionId`, and `item` with `messageId`, `rating`, `note?`, `category?`, `version`, `createdAt`, `updatedAt` | Complete current value after a creation or edit |
| `feedback/message-delete` | One assistant message | `sessionId`, `messageId` | Retraction of the current value |

Derive feedback with these rules:

1. When counting a Session's own feedback, exclude feedback events whose `seq` is below `session.seed_length`, which only seeded Sessions carry, and `feedback/message-*` events whose `data.sessionId` differs from the record's `sessionId`. Keep every other event, including the inherited prefix, for the rules below.
2. Group `feedback/message-put` by `data.item.messageId` and `feedback/message-delete` by `data.messageId` within one Session; the event with the highest `seq` is the current value, and a `feedback/message-delete` there means no current feedback. Earlier puts remain as edit history.
3. The rated reply is the append-origin `assistant/message` whose `data.message.id` equals `data.item.messageId`; in a seeded Session it can lie in the inherited prefix. Its `data.turn` identifies the turn, and the events up to it reproduce the conversation state.

The services and events record no actor. Host plugins and runtime extensions can call `sessionFeedback.record` and `messageFeedback.put` or append these events directly, and Client plugins can call the same Remotes, so exported feedback fields can contain plugin-written state. Each appended feedback event of the Session itself also authorizes the release of the prefix that ends at it. Text content does not establish who wrote a value; recognition rules for specific plugins belong to the consumer's tooling.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmessagefeedback--messagefeedbackservice"></a>

### `ctx.messageFeedback` — `MessageFeedbackService`

Session-log service; cold operations never construct a Session or Agent.

```ts cordis-catalog
/**
 * Read current feedback from the canonical log.
 * @param request - Session to inspect.
 * @returns immutable items or a definite persistence miss.
 */
@Remote('list') list(request: MessageFeedbackListRequest): Promise<MessageFeedbackListResult>

/**
 * Create or replace feedback after checking its current version.
 * Matching no-ops retain the version and append no event.
 * @param request - Target, desired value, and observed item version.
 * @returns the durable item or an explicit business failure.
 */
@Remote('put') put(request: MessageFeedbackPutRequest): Promise<MessageFeedbackPutResult>

/**
 * Delete one item after checking its version; absence succeeds without an event.
 * @param request - Session, message, and observed item version.
 * @returns the stable absent postcondition or an explicit failure.
 */
@Remote('delete') delete(request: MessageFeedbackDeleteRequest): Promise<MessageFeedbackDeleteResult>
```

Source: [`packages/feedback/message-feedback/src/index.ts`](../../packages/feedback/message-feedback/src/index.ts)

<a id="ctxsessionfeedback--sessionfeedbackservice"></a>

### `ctx.sessionFeedback` — `SessionFeedbackService`

Host Remote through which a product surface records a Session-level remark.

```ts cordis-catalog
/**
 * Record one remark on a live Session.
 * @param request - target Session plus the optional text and category.
 * @returns the recorded postcondition, or `session-not-found` when no live
 * Session carries the id.
 */
@Remote('record') record(request: SessionFeedbackRecordRequest): Promise<SessionFeedbackRecordResult>
```

Source: [`packages/feedback/command-feedback/src/index.ts`](../../packages/feedback/command-feedback/src/index.ts)

<a id="feedback-events"></a>

### `feedback/*` events

<a id="feedbackcommitted--parallel"></a>

#### `feedback/committed` — parallel

Observe a durable cold feedback mutation without publishing a live Session. Observers run before write ownership is released and must not await another message-feedback operation for this Session. The payload is borrowed read-only; deep-clone it before transferring ownership (for example, to Session.fromRestore).

```ts cordis-catalog
/**
 * Observe a durable cold feedback mutation without publishing a live Session.
 * Observers run before write ownership is released and must not await
 * another message-feedback operation for this Session. The payload is borrowed
 * read-only; deep-clone it before transferring ownership (for example, to Session.fromRestore).
 * @param inspection - committed canonical prefix, including the feedback as its last event.
 * @mode parallel
 */
'feedback/committed'(inspection: SessionInspection): void
```

Types: [SessionInspection](persistence.md)

Source: [`packages/feedback/message-feedback/src/index.ts`](../../packages/feedback/message-feedback/src/index.ts)
<!-- END GENERATED cordis-surface -->
