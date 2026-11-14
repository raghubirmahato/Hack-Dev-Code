# Tools

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtools--toolsservice"></a>

### `ctx.tools` — `ToolsService`

Concrete tool registry and scoped executor dispatcher.

```ts cordis-catalog
/**
 * Register globally or in the calling agent scope. Scoped tools shadow
 * globals; duplicates within one layer and the reserved `run_code` name fail.
 * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
 * @param options - optional step-time activation condition.
 * @returns the exact disposer that unregisters the tool.
 */
register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void

/**
 * Restrict global tools for the calling agent scope. Empty filters, unknown
 * names, scope-local names, and reserved transport names fail. Restrictions
 * intersect; scoped registrations remain visible.
 * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
 * @returns the exact disposer that lifts this restriction.
 */
restrict(filter: ToolRestriction): () => void

/**
 * Look up a tool as one scope sees it (scoped
 * shadows global; a restricted-away global reads as absent). Presenters pass
 * the calling agent so the rendered card matches the definition that
 * actually executed.
 * @param name - the tool name as registered.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @param toolSet - step admission; omit only to inspect registered definitions.
 * @returns the definition the scope resolves, or undefined when none is visible.
 */
get(name: string, scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolDefinition | undefined

/**
 * Resolve the definition a call may execute. With a step's admitted set, the
 * set decides; without one, conditional registrations are unavailable.
 * @param name - the tool name as registered.
 * @param scope - the calling agent; omitted = the global view.
 * @param toolSet - step admission, or omitted for a call outside a model step.
 * @returns the executable definition, or undefined when the call must fail as `UNKNOWN_TOOL`.
 */
executable(name: string, scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolDefinition | undefined

/**
 * Resolve conditions once for this step without changing shared registrations.
 * Cancellation or a rejected condition publishes no partial selection. Removed
 * registrations cannot be restored by a late condition result.
 * @param context - preparing agent, captured model selection, and cancellation.
 * @returns the complete selection; the caller disposes it after its tool batch settles.
 */
async resolve(context: ToolActivationContext): Promise<ResolvedToolSet>

/**
 * Read the visible capability definitions for descriptions and program bindings.
 * @param scope - viewing Agent or preset; omitted selects the global view.
 * @param toolSet - step admission; omit only to inspect registered definitions.
 * @returns definitions after scoped shadowing and restrictions, limited to the step's admission when given.
 */
definitions(scope?: ScopeKey, toolSet?: ResolvedToolSet): readonly ToolDefinition[]

/**
 * Project visible definitions onto the allowlisted model-facing schema fields,
 * excluding execution and presentation callbacks.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @param toolSet - step admission, or omitted for registered-definition inspection.
 * @returns one deep-cloned schema per visible tool.
 */
schemas(scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolSchema[]

/**
 * Provide the executor for the calling scope; an unscoped contribution is the deployment default.
 * Rendering any executor-owned section requires the viewing scope's selection to remain available.
 * @param executor - initialized provider owned by the contributing plugin.
 * @returns the effect disposer. Unloading leaves the selection unavailable until it is replaced.
 */
setExecutor(executor: ToolExecutor): () => void

/**
 * Delegate a raw call batch to its Agent's provider or the deployment default.
 * Select at dispatch; accepted batches settle through that provider even if it unloads.
 * @param input - original calls, optional owning Agent, and optional logging step.
 * @returns the selected executor's settled batch; unavailable selections reject.
 */
async execute(input: ToolBatchInput): Promise<ToolBatchResult>

/**
 * Register a monotonic denial in the calling scope.
 * @param guard - evaluated after extensible pre-execute policy by the shared pipeline.
 * @returns the effect disposer that removes this guard.
 */
guard(guard: ToolGuard): () => void

/**
 * Check global and inherited guards after pre-execute policy and approval resolve.
 * @param exec - invocation whose guards are checked before dispatch.
 * @returns the first denial reason, or undefined when no guard denies.
 */
checkGuards(exec: ToolExecution): string | undefined
```

Types: [ScopeKey](scope.md)

Source: [`packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts)

<a id="tools-events"></a>

### `tools/*` events

<a id="toolschange--emit"></a>

#### `tools/change` — emit

A tool was registered or unregistered, or a scoped restriction changed. Unfiltered registry notification: scoped listeners receive changes from every scope because a global contribution can affect every agent's next assembly.

```ts cordis-catalog
/**
 * A tool was registered or unregistered, or a scoped restriction changed.
 * Unfiltered registry notification: scoped listeners receive changes from every
 * scope because a global contribution can affect every agent's next assembly.
 * @mode emit
 */
'tools/change'(): void
```

Source: [`packages/core/tools/src/events.ts`](../../packages/core/tools/src/events.ts)

<a id="toolsexecute--waterfall"></a>

#### `tools/execute` — waterfall

Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns a normalized result; wrappers may change only `exec.signal`, while call identity remains immutable. The registry re-fuses the original caller signal before the body, so replacement cannot detach caller cancellation; wrappers must still restore their signal and reach quiescence. Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns
 * a normalized result; wrappers may change only `exec.signal`, while call
 * identity remains immutable. The registry re-fuses the original caller
 * signal before the body, so replacement cannot detach caller cancellation;
 * wrappers must still restore their signal and reach quiescence.
 * Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the allowed call about to dispatch (name, parsed arguments, caller agent, signal).
 * @mode waterfall
 */
'tools/execute'(this: Scoped<ToolsService>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/events.ts`](../../packages/core/tools/src/events.ts)

<a id="toolspost-execute--waterfall"></a>

#### `tools/post-execute` — waterfall

Accept, replace, enrich, or block a normalized dispatch result. `next()` accepts it unchanged; thrown tools still reach this waterfall as errors. Async listeners must observe `exec.signal`; after they settle, caller cancellation replaces only a successful accepted outcome with the code selected by whether the tool body was invoked. Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Accept, replace, enrich, or block a normalized dispatch result. `next()`
 * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
 * listeners must observe `exec.signal`; after they settle, caller
 * cancellation replaces only a successful accepted outcome with the code
 * selected by whether the tool body was invoked.
 * Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the call that just ran (name, parsed arguments, caller agent).
 * @param result - the dispatch outcome a listener may accept, replace, or block.
 * @mode waterfall
 */
'tools/post-execute'(this: Scoped<ToolsService>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/events.ts`](../../packages/core/tools/src/events.ts)

<a id="toolspre-execute--waterfall"></a>

#### `tools/pre-execute` — waterfall

Allow, deny, cancel, or ask before dispatch. `next()` delegates to allow; `cancel` selects the canonical pre-dispatch cancellation result, and missing approval support turns `ask` into denial. Async gates must observe `exec.signal`; the registry rechecks cancellation after they settle but never abandons their promise. Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's calls.

```ts cordis-catalog
/**
 * Allow, deny, cancel, or ask before dispatch. `next()` delegates to allow;
 * `cancel` selects the canonical pre-dispatch cancellation result, and missing
 * approval support turns `ask` into denial. Async gates must observe
 * `exec.signal`; the registry rechecks cancellation after they settle but
 * never abandons their promise.
 * Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the pending call (name, parsed arguments, caller agent).
 * @mode waterfall
 */
'tools/pre-execute'(this: Scoped<ToolsService>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/events.ts`](../../packages/core/tools/src/events.ts)

<a id="toolsptc-dispatch-log--waterfall"></a>

#### `tools/ptc-dispatch-log` — waterfall

Allow a listener to replace content in the DURABLE LOG COPY of one `run_code` sub-dispatch outcome before the bridge appends its `tool/ptc-dispatch` event. `next()` keeps the content unchanged; a listener may return replacement blocks (e.g. the spill policy's preview + locator for an oversized text result). Only the logged copy is affected — the program already received the complete value, and the model sees neither. A throwing listener is contained: the bridge falls back to logging the original settled content. Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.

```ts cordis-catalog
/**
 * Allow a listener to replace content in the DURABLE LOG COPY of one
 * `run_code` sub-dispatch outcome before the bridge appends its
 * `tool/ptc-dispatch` event. `next()` keeps the
 * content unchanged; a listener may return replacement blocks (e.g. the
 * spill policy's preview + locator for an oversized text result). Only the
 * logged copy is affected — the program already received the complete
 * value, and the model sees neither. A throwing listener is contained:
 * the bridge falls back to logging the original settled content.
 * Scope-filtered dispatch (`@hackdevcode/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.
 * @param dispatch - the parent execution, sub-call identity, and the settled content to log.
 * @mode waterfall
 */
'tools/ptc-dispatch-log'(this: Scoped<ToolsService>, dispatch: PtcDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>
```

Types: [ContentBlock](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/tool-executor-ptc/src/runtime-types.ts`](../../packages/core/tool-executor-ptc/src/runtime-types.ts)

<a id="toolsresult--emit"></a>

#### `tools/result` — emit

Observe the frozen, lossless-JSON final outcome. Listener failures are contained. Scope-filtered dispatch (`@hackdevcode/dsh-scope`): keyed by `exec.agent`.

```ts cordis-catalog
/**
 * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
 * Scope-filtered dispatch (`@hackdevcode/dsh-scope`): keyed by `exec.agent`.
 * @param exec - the execution object that traversed the pipeline.
 * @param result - a deep-frozen snapshot of the final returned result.
 * @mode emit
 */
'tools/result'(this: Scoped<ToolsService>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
```

Types: [Scoped](scope.md)

Source: [`packages/core/tools/src/events.ts`](../../packages/core/tools/src/events.ts)
<!-- END GENERATED cordis-surface -->
