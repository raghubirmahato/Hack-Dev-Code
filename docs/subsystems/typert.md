# Typert

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxremoteaccess--remoteaccessservice"></a>

### `ctx.remoteAccess` — `RemoteAccessService`

Registry of access policies, the Gateway's access decisions, list filtering, and the per-Peer access snapshot. Every composition that mounts the Gateway mounts this service too.

```ts cordis-catalog
/**
 * Register the policy of one non-owner principal kind in the caller's
 * fiber; open snapshots are recomputed on registration and removal.
 * @param kind - the principal kind the policy serves; never `owner`.
 * @param policy - business-owned bindings and refusal reasons for principals of `kind`.
 * @returns disposer removing this policy.
 * @throws Error when `kind` already has a policy.
 */
registerPolicy<K extends Exclude<keyof PrincipalMap, 'owner'>>(kind: K, policy: RemoteAccessPolicy<PrincipalMap[K]>): () => void

/**
 * Report that the bindings or condition answers for `principal` may have
 * changed. Business packages call this on every grant, revocation, mode
 * change, and expiry; open snapshots re-push, and the next failure of each
 * policy is logged again.
 * @param principal - affected principal; omitted for every principal.
 */
invalidate(principal?: Principal): void

/**
 * Gateway-only: decide one request whose resources the Gateway resolved.
 * The owner is allowed, and so is `remoteAccess/follow`: every Peer reads
 * its own snapshot. Otherwise the action is allowed only when, on every
 * listed resource, some binding of the principal's policy names that
 * resource, has a role listing the action, and has no condition or a
 * condition that allows. `bindings()` is called once per decision.
 * @param request - the caller or recipient, the action, the resources it
 *   touches, and a call's arguments.
 * @returns `allow`; or `deny` with `no-allow` when the principal kind has
 *   no policy, the first refusing condition's reason on the first resource
 *   no binding allows, else `explain()`'s reason, else `no-allow`;
 *   `policy-failed` when `bindings()`, a condition, or `explain()` throws,
 *   logged once per policy until the next `invalidate()`. The Gateway
 *   throws `remote-access/denied` for a denied call and drops a denied event.
 */
decide(request: RemoteAccessRequest<Principal>): RemoteAccessDecision

/**
 * Filter items inside a Remote method. The invocation is read from the
 * Context that accessed this service, so call it as
 * `this.ctx.remoteAccess.allows(resource)` from the Remote method. Each
 * check reads the policy's bindings again, so a long-running stream sees
 * binding changes from the next check on.
 * @param resource - resource of one result item.
 * @returns true for the owner and outside a Remote call; otherwise whether
 *   the invocation's endpoint action is allowed on `resource` without call
 *   arguments, false when the policy is absent or fails.
 */
allows(resource: RemoteAccessResource): boolean

/**
 * The baseline a page opens with before its snapshot stream connects; every
 * index the webServer renders carries it under
 * {@link REMOTE_ACCESS_SNAPSHOT_KEY} for the Peer the page speaks for.
 * @param principal - the page's caller identity.
 * @returns the owner baseline for the owner; otherwise the principal's current grants.
 */
snapshotFor(principal: Principal): RemoteAccessBaseline

/**
 * Stream the calling Peer's access snapshot: one baseline, then `upsert`
 * and `remove` frames after each `invalidate()` and each policy
 * registration or removal that changes a grant. The owner receives only
 * `{ owner: true }`. The generation ends when `signal` aborts or this
 * service unloads, so a reloaded service starts every reader from a fresh
 * baseline.
 * @param signal - generation cancellation.
 * @returns the access frames of one generation.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<RemoteAccessFrame>
```

Source: [`packages/api/remote-access/src/index.ts`](../../packages/api/remote-access/src/index.ts)

<a id="ctxtypert--typertregistry"></a>

### `ctx.typert` — `TypertRegistry`

Registry of generated schemas, package reflection, invocations, and Remote dependency providers.

```ts cordis-catalog
/**
 * Register one generated contribution atomically for the calling fiber.
 * Duplicate package-face identities, schemas, invocation ids, or endpoints
 * reject the whole batch.
 * @param contribution - generated schemas, reflection, and Host invocations.
 * @returns the exact effect disposer that removes this contribution.
 */
register(contribution: TypertContribution): TypertDisposer

/**
 * Look up one schema by `<package>#<name>`.
 * @param key - global schema key.
 * @returns a record containing the cached schema, or `undefined` when absent.
 */
get(key: string): TypertSchemaRecord | undefined

/**
 * Resolve one required schema.
 * @param key - global schema key.
 * @returns a record containing the cached schema.
 * @throws when the key is malformed, the package face is absent, or the schema is not contributed.
 */
resolve(key: string): TypertSchemaRecord

/**
 * Enumerate live schemas in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching records containing the cached schemas.
 */
list(filter: TypertSchemaFilter = {}): TypertSchemaRecord[]

/**
 * Look up generated reflection for one package face.
 * @param packageName - exact npm package name.
 * @param face - face to query; defaults to the host runtime.
 * @returns the live package record, or `undefined` when absent.
 */
getPackage(packageName: string, face: TypertFace = 'host'): TypertPackageRecord | undefined

/**
 * Enumerate generated package reflection in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching package records.
 */
listPackages(filter: TypertPackageFilter = {}): TypertPackageRecord[]

/**
 * Project a live Zod schema to JSON Schema without caching the result.
 * @param key - global schema key.
 * @param params - Zod projection parameters.
 * @returns a fresh JSON Schema document.
 */
toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema
```

Source: [`packages/typert/registry/src/service.ts`](../../packages/typert/registry/src/service.ts)

<a id="ctxtypertgateway--typertgatewayservice"></a>

### `ctx.typertGateway` — `TypertGatewayService`

Resolve strict generated definitions or conservative SRC markers against current Cordis Services and Typert providers.

```ts cordis-catalog
/**
 * Check for an active owner Client event stream, the only kind that can answer forwarded waterfalls.
 * @returns whether an owner stream is open and has not been cancelled.
 */
hasLiveClient(): boolean

/**
 * Inspect unsettled forwarded events without changing their lifetime.
 * @returns detached event names and Agent identities.
 */
getPendingRemoteEvents(): readonly PendingRemoteEventInfo[]

/**
 * Register the sole application-selected forwarded-event source.
 * @param source - stream factory installed by the Remote assembly.
 * @param host - stable Host facts included in each Client generation's opening frame.
 * @returns disposer removing this source and cancelling its active streams.
 */
registerRemoteEvents( source: TypertRemoteEventSource, host: RemoteEventHostInfo, ): () => Promise<void>

/**
 * Invoke one live Remote method through strict generated reflection or SRC markers.
 * @param request - decoded endpoint and exact named wire arguments.
 * @returns the business result without output decoding.
 * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
 */
async invoke(request: InvokeRemoteRequest): Promise<unknown>

/**
 * Open one live stream Remote method without assuming a physical carrier.
 * @param request - decoded endpoint, named wire arguments, and the Client uplink when the carrier has one.
 * @returns a cancellation-aware iterable over the business results.
 */
async stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>>
```

Source: [`packages/api/gateway/src/index.ts`](../../packages/api/gateway/src/index.ts)
<!-- END GENERATED cordis-surface -->
