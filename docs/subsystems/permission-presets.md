# Permission presets

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpermissionpresets--permissionpresetservice"></a>

### `ctx.permissionPresets` — `PermissionPresetService`

Owns the deployment's configured permission presets, the fixed Auto integration hook, and their write path. Requires a confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are reported as CUSTOM_PRESET, not an error.

```ts cordis-catalog
/**
 * Read the complete process-level catalog exposed to current-session UI.
 * @returns every currently selectable preset in contribution order.
 */
@Remote('catalog') catalog(): PermissionCatalog

/**
 * Publish the fixed current-session Auto preset for the calling
 * integration's effect lifetime.
 * @param admit - synchronous gate run before live Auto selection or restore.
 * @returns the async effect disposer that removes Auto.
 */
registerAuto(admit: () => void): () => Promise<void>

/**
 * Resolve the preset matching the effective knob values. A still-matching
 * last selection wins shared-bundle ties, and a still-selected Auto also
 * matches the `never` approval policy; otherwise the first configured
 * match wins. Returns
 * {@link CUSTOM_PRESET} when no available preset matches.
 * @param session - the session whose knob state is read.
 * @returns the effective preset name, or `custom` when nothing matches.
 */
current(session: Session): string

/**
 * Resolve an available preset's knob bundle.
 * @param name - the preset name to resolve.
 * @returns the configured bundle.
 * @throws when `name` is neither configured nor the currently live Auto preset.
 */
resolve(name: string): PresetSpec

/**
 * Build the client option for an available preset or {@link CUSTOM_PRESET}.
 * A missing label falls back to the preset key.
 * @param name - a configured preset key, live `auto`, or `custom`.
 * @returns the option a client renders.
 * @throws when `name` is neither a configured preset, live `auto`, nor `custom`.
 */
optionOf(name: string): PresetOption

/**
 * Record a changed preset, then update each changed knob through its own
 * setter. Selecting the effective preset again appends nothing.
 * @param session - the session the switch belongs to.
 * @param name - the preset to switch to; unknown names throw.
 */
set(session: Session, name: string): void
```

Types: [Session](session.md)

Source: [`packages/interaction/permission-presets/src/index.ts`](../../packages/interaction/permission-presets/src/index.ts)

<a id="permission-presets-events"></a>

### `permission-presets/*` events

<a id="permission-presetscatalog-changed--emit"></a>

#### `permission-presets/catalog-changed` — emit

The selectable process catalog changed. Payload-free by design: consumers subscribe first, then re-read the complete catalog.

```ts cordis-catalog
/**
 * The selectable process catalog changed. Payload-free by design:
 * consumers subscribe first, then re-read the complete catalog.
 * @mode emit
 */
'permission-presets/catalog-changed'(): void
```

Source: [`packages/interaction/permission-presets/src/types.ts`](../../packages/interaction/permission-presets/src/types.ts)
<!-- END GENERATED cordis-surface -->
