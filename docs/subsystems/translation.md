# Translation

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcottranslation--cottranslationcontroller"></a>

### `ctx.cotTranslation` — `CotTranslationController`

Optional reasoning translation delegates Session-bound storage to the translator.

```ts cordis-catalog
/**
 * Read accepted translation preferences and the current request limit without sending text.
 * @param signal - browser query cancellation or Remote contribution withdrawal.
 * @returns authoritative preferences, eligible routes, and maximum UTF-16 text length per request.
 */
@Remote async limits(signal: AbortSignal): Promise<CotTranslationSnapshot>

/**
 * Translate one displayed fragment through the reader's selected provider.
 * @param request - original text and Session identity supplied by the Client; provider and explicit
 * target language match accepted preferences, while auto uses the browser locale.
 * @param signal - browser cancellation or Remote contribution withdrawal.
 * @returns translated text; an uncached inactive Session joins ordinary GUI activation before retry.
 * Failures omit the source and provider response. Cancellation stops this caller's wait, not shared activation.
 */
@Remote async translate(request: TranslationRequest, signal: AbortSignal): Promise<string>
```

Source: [`packages/experimental/client-ui-cot-translation/src/index.ts`](../../packages/experimental/client-ui-cot-translation/src/index.ts)

<a id="ctxtranslator--translator"></a>

### `ctx.translator` — `Translator`

One Host service with explicit routing, cancellation and quiescent unload.

```ts cordis-catalog
/**
 * Inspect eligible native routes without inference; saved results remain readable for unavailable routes.
 * @param signal - optional caller cancellation, combined with service disposal.
 * @returns anonymous choices followed by eligible explicitly selected paid routes.
 */
async availableProviders(signal?: AbortSignal): Promise<readonly TranslationProvider[]>

/**
 * Resolve provider and source-language defaults without sending text.
 * @param request - consumer text, destination and optional routing choices.
 * @returns a complete specification; exceeding `maxTextChars` throws `TRANSLATION_TEXT_LIMIT`.
 */
resolve(request: TranslationRequest): TranslationSpec

/**
 * Translate one resolved specification; the selected provider receives its text.
 * @param spec - complete routing and language choices from `resolve()`.
 * @param signal - optional caller cancellation, combined with service disposal.
 * @returns translated plain text, durably retained before return when a Session is supplied.
 * An uncached supplied Session must be active; otherwise rejects with `TRANSLATION_SESSION_INACTIVE` before dispatch.
 * Rejects provider/storage/limit failures and preserves cancellation reasons.
 */
async translate(spec: TranslationSpec, signal?: AbortSignal): Promise<string>
```

Source: [`packages/experimental/translator/src/index.ts`](../../packages/experimental/translator/src/index.ts)
<!-- END GENERATED cordis-surface -->
