# Liveshare

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxliveshareshares--liveshareshares"></a>

### `ctx.liveshareShares` — `LiveshareShares`

Owner-only Remote surface over the share-management operations.

The Gateway decides each call through remote access, so a `share-viewer` Peer is refused before a method runs; the owner Peer reaches the one implementation that owns each share-management side effect. `create` takes its Session as the `sessionId` of its single request object, so the Session resource kind's default resolver names that Session for the call without a reader declared here.

```ts cordis-catalog
/**
 * Publish one Session and store the share.
 * @param request - Session, title, access, lifetime, and both switches the owner chose.
 * @returns The created share's link and stored values.
 */
@Remote('create') create(request: CreateShareRequest): Promise<CreatedShare>

/**
 * Refresh titles and Liveshare server authority, then list this host's shares.
 * @returns Every share this host publishes.
 */
@Remote('list') list(): Promise<OwnerShareList>

/**
 * Stop one share locally, revoke its forks, and delete its row on the Liveshare server when reachable.
 * @param request - Share to stop.
 * @returns Whether the row on the Liveshare server still needs a retry.
 */
@Remote('stop') stop(request: StopShareRequest): Promise<StopShareResult>

/**
 * Change one share's tier, fork switch, or both.
 * @param request - Share and the switches to change.
 * @returns The permissions the share now carries.
 */
@Remote('updatePermissions') updatePermissions(request: UpdateSharePermissionsRequest): Promise<SharePermissions>

/**
 * Replace one share's exposed plugin endpoints.
 * @param request - Share and the selection to store.
 * @returns The capability selection the share now carries.
 */
@Remote('setCapabilities') setCapabilities(request: SetShareCapabilitiesRequest): Promise<ShareCapabilities>

/**
 * Read the endpoints plugins currently offer.
 * @returns The live offer list.
 */
@Remote('capabilities') capabilities(): ShareCapabilityOffers

/**
 * Read the Liveshare server address the owner saved.
 * @returns The current Liveshare server state, with both address fields absent while none is saved.
 */
@Remote('relay') relay(): OwnerRelayState

/**
 * Choose the Liveshare server address later shares publish to.
 * @param request - Normalized address or null to clear the saved one.
 * @returns The Liveshare server state after the change.
 */
@Remote('setRelay') setRelay(request: SetRelayRequest): Promise<OwnerRelayState>

/**
 * Report this host's owner identity for one Liveshare server address.
 * @param request - Address to report, or the effective one when absent.
 * @returns The owner identity status, without the credential.
 */
@Remote('identity') identity(request: OwnerIdentityRequest): Promise<OwnerIdentityStatus>

/**
 * Read the Liveshare server's durable audit trail for one share.
 * @param request - Share whose audit is read.
 * @returns The audit events, or a structured failure when the Liveshare server cannot answer.
 */
@Remote('audit') audit(request: ShareAuditRequest): Promise<ShareAudit>

/**
 * Check that the effective Liveshare server answers at all.
 * @returns The anonymous connectivity result.
 */
@Remote('testRelay') testRelay(): Promise<RelayConnectivityView>

/**
 * Register one throwaway share to check whether this host may publish.
 * @param request - Session the throwaway registration names.
 * @returns The Liveshare server's decision about this host's credential.
 */
@Remote('testPublish') testPublish(request: TestPublishRequest): Promise<RelayPublishView>
```

Source: [`packages/experimental/liveshare/src/host/share-remote.ts`](../../packages/experimental/liveshare/src/host/share-remote.ts)
<!-- END GENERATED cordis-surface -->
