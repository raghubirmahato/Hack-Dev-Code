# SSH

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxssh--sshconnection"></a>

### `ctx.ssh` — `SshConnection`

One non-reconnecting SSH session; loss invalidates all active operations.

```ts cordis-catalog
/**
 * Send a helper operation; cancellation never replays an ambiguous mutation.
 * @param method - the private helper operation.
 * @param params - JSON request fields validated by the helper.
 * @param result - response validation before returning provider-visible data.
 * @param signal - cancellation, which does not undo completed remote effects.
 * @param wait - allow a process observation to outlast the administrative deadline.
 * @returns the validated remote result.
 */
async request<T>(method: string, params: unknown, result: z.ZodType<T>, signal?: AbortSignal, wait: boolean = false): Promise<T>

/**
 * Forward one authenticated stream through an independent SSH channel.
 * @param endpoint - private coordinates issued by this connection's helper.
 * @param signal - cancellation of allocation and the resulting socket.
 * @returns a paused socket; attach a consumer before resuming it.
 */
async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket>

/** Tear down the helper's remote managed ranges before releasing the SSH master when reachable. */
dispose(): Promise<void>
```

Source: [`packages/ssh/ssh/src/index.ts`](../../packages/ssh/ssh/src/index.ts)
<!-- END GENERATED cordis-surface -->
