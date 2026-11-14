# Webhook

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwebhookruntime--webhookruntime"></a>

### `ctx.webhookRuntime` — `WebhookRuntime`

Fire-and-forget rule runtime. Session creation is the only built-in action.

```ts cordis-catalog
/**
 * Register one trusted programmatic rule.
 * @param rule - unique id, provider kind, and arbitrary callback.
 * @returns awaitable effect disposer that aborts and drains this rule's active callbacks.
 */
register<K extends string>(rule: WebhookRule<K>): () => Promise<void>

/**
 * Start every currently matching rule and return before any callback settles.
 * @param delivery - authenticated provider data; snapshotted before dispatch.
 * @throws synchronously when the runtime is closing or the delivery is malformed.
 */
dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void
```

Source: [`packages/experimental/webhook/src/index.ts`](../../packages/experimental/webhook/src/index.ts)
<!-- END GENERATED cordis-surface -->
