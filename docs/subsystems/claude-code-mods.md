# Claude code mods

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxclaudecodemods--claudecodemods"></a>

### `ctx.claudeCodeMods` — `ClaudeCodeMods`

The bridge service: loaded mods, their hooks, and the harness listeners that raise their events. Mods join through ClaudeCodeMods.add, which defineMod calls when a mod plugin mounts. The Remote methods let a Client draw each session's band above the prompt and press its buttons.

```ts cordis-catalog
/**
 * Watch the band above the prompt of one session: the current drawing, then
 * every redraw, until the Client stops watching.
 * @param agent - the session's agent, resolved by the Gateway.
 * @param signal - carrier cancellation.
 * @returns the band's snapshots.
 */
@Remote({ mode: 'stream' }) watchBand(agent: Agent, signal: AbortSignal): AsyncIterable<SurfaceSnapshot>

/**
 * Press a button of the band's current drawing: runs the mod's `onPress` and redraws.
 * @param agent - the session's agent, resolved by the Gateway.
 * @param generation - the drawing the Client saw.
 * @param actionId - the button's action id in that drawing.
 * @returns the snapshot after the press.
 */
@Remote pressBand(agent: Agent, generation: number, actionId: string): Promise<SurfaceSnapshot>

/**
 * Load one mod beneath every mod loaded before it: run its `register`,
 * keep its hooks, and report which of its events this host never raises.
 * @param definition - the mod as its plugin defined it.
 * @returns the disposer that removes the mod's hooks, closes its timers, and releases its registrations.
 * @throws Error when the name is invalid or taken, or when `register` throws (Claude Code's `hooks module did not load` wording).
 */
async add(definition: ModDefinition): Promise<() => Promise<void>>
```

Types: [Agent](core.md)

Source: [`packages/experimental/claude-code-mods/src/index.ts`](../../packages/experimental/claude-code-mods/src/index.ts)
<!-- END GENERATED cordis-surface -->
