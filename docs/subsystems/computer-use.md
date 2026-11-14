# Computer use

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseregistry"></a>

### `ctx.computerUse` — `ComputerUseRegistry`

Owns one optional provider registration in the shared computer-use service.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name. Providers
 * must stop their tools and await owned work before releasing this registration.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>
```

Source: [`packages/computer-use/computer-use/src/index.ts`](../../packages/computer-use/computer-use/src/index.ts)

<a id="ctxcuaaccess--cuaaccess"></a>

### `ctx.cuaAccess` — `CuaAccess`

Browser controls for provider-owned native permission and application decisions.

```ts cordis-catalog
/** Read PTC execution state separately from native permission checks.
 * @returns Whether the shared runtime retains memory and has an editable profile entry.
 */
@Remote ptcConfiguration(): { persistent: boolean; writable: boolean }

/** Persist in-memory PTC execution through the existing profile editor and Loader lifecycle.
 * @returns Completion after the shared runtime reload; already-persistent runtimes are left intact.
 */
@Remote async enablePersistentPtc(): Promise<void>

/**
 * Read fresh stored application decisions without issuing a native request.
 * @returns Saved grants, refused applications and durable-storage availability.
 */
@Remote applications(): Promise<CuaApplicationState>

/**
 * Inspect system privileges independently of application decisions and icons.
 * @returns Fresh native preflight and launch metadata.
 */
@Remote async systemStatus(): Promise<CuaSystemPermissionState>

/**
 * Load presentation icons separately from application decisions.
 * @returns Optional native PNG icons keyed by executable path; applications without paths are skipped.
 */
@Remote async applicationIcons(): Promise<Record<string, string>>

/**
 * Request a system privilege explicitly selected by the user.
 * @param permission macOS privilege to request.
 * @returns Preflight state after requesting; a false value never implies consent.
 */
@Remote async requestPermission(permission: CuaSystemPermission): Promise<CuaSystemPermissionState>

/**
 * Open the macOS privacy pane selected by the user.
 * @param permission Corresponding system privilege.
 * @returns Completion after macOS accepted the open request.
 */
@Remote async openSettings(permission: CuaSystemPermission): Promise<void>

/**
 * Remove saved and session access and join affected operations.
 * @param id Application identity displayed on the permission page.
 * @returns Completion after persistence and cancellation; dispatched input cannot be undone.
 */
@Remote revoke(id: CuaApplicationId): Promise<void>

/**
 * Clear this application's refusals across sessions so each session may ask for access again.
 * @param id Refused or revoked application displayed on the permission page.
 * @returns Completion after clearing refusals; no permission is granted and no action is replayed.
 */
@Remote async retryApproval(id: CuaApplicationId): Promise<void>
```

Source: [`packages/computer-use/cua/src/access.ts`](../../packages/computer-use/cua/src/access.ts)
<!-- END GENERATED cordis-surface -->
