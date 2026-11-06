/**
 * Generic pi-ai-backed implementation of the Harness LLM seam.
 *
 * Each resolution produces one **immutable** snapshot — the profiles plus a
 * `Models` collection holding the `Provider` each route built — and an
 * operation captures a whole snapshot before its first `await`. A
 * configuration change builds a *new* collection rather than mutating the one
 * in use, because `Models.streamSimple()` is lazy: it resolves the provider
 * when the stream is first consumed, which is after the credential await, so a
 * mutated collection would let a request that started under one configuration
 * finish under another — or fail with a provider that no longer exists. This is
 * what makes the seam's per-step call freeze (`llm.prepareCall()`) hold all the
 * way down: switching models mid-reply takes effect on the next step, never
 * inside the one in flight.
 *
 * A route naming a credential reference still resolves it through the harness
 * seam and passes it as the request's `apiKey` option, which pi-ai treats as
 * the highest-priority auth override — that is what keeps the fail-loud
 * reference semantics. Everything that override does not cover reaches pi-ai
 * through the collection's own auth: the credential store holds the records a
 * login wrote and a refresh rotates, and the auth context answers the ambient
 * questions a provider asks while resolving. Both are stable across snapshots,
 * so a configuration change rebuilds the collection without forgetting who is
 * signed in.
 *
 * @module dsh-llm-pi-ai/adapter
 */

import type {
  Api,
  AuthContext,
  CredentialStore,
  Model,
  Models,
  ModelThinkingLevel,
  MutableModels,
  SimpleStreamOptions,
  ThinkingLevel,
} from '@earendil-works/pi-ai'
import {
  attributionHeaders,
  contentHasImage,
  countRequestImages,
  LlmAdapter,
  LlmError,
  omitOldestImages,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  waitForKey,
} from '@hackdevcode/dsh-llm'
import type {
  GenerateOptions,
  ImageAttachmentAccess,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  RequestMessage,
  ReasoningEffortId as ReasoningEffortIdType,
  ResolvedRetryPolicy,
  StreamChunk,
  ToolSchema,
} from '@hackdevcode/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef } from '@hackdevcode/dsh-attachment'
import { idleWatchdog, timeoutOf } from '@hackdevcode/dsh-timeout'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { requestImageTarget, toPiContext } from './context.ts'
import { conversationUpdates, createModels, getSupportedThinkingLevels } from './models.ts'
import { toStreamChunks } from './stream.ts'

/**
 * Initially active declaration added to an Anthropic request whose projected
 * tools are all deferred, because Anthropic rejects a tool list without one.
 */
const ANTHROPIC_TOOL_UPDATE_PLACEHOLDER: ToolSchema = {
  name: 'DeferredToolPlaceholder',
  description: 'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
  parameters: { type: 'object', properties: {} },
}

/** Provider wording for a request that carries more images than it accepts. */
const IMAGE_LIMIT_PATTERN =
  /too many images|image count|maximum (?:of )?\d+ images?|more than \d+ images?|images? (?:in|per) (?:a |the )?request/i
/** Provider wording for a model that is temporarily overloaded rather than broken. */
const OVERLOADED_PATTERN = /\b(?:503|529)\b|high demand|overloaded|UNAVAILABLE|temporarily unavailable/i

/** How long later steps stay on the fallback model after an overload. */
const OVERLOAD_FALLBACK_MS = 10 * 60_000
/** How long later steps stay on the fallback model after the requested model ran out of quota. */
const QUOTA_FALLBACK_MS = 60 * 60_000

/** Provider wording for a quota that resets in hours or days rather than within the minute. */
const LONG_QUOTA_PATTERN = /per day|daily|PerDay|retry in \d+h|retry in \d{2,}m/i

/** How many times one request may shed old images before the failure is reported. */
const MAX_IMAGE_OMISSIONS = 3
/** Model-visible stand-in for an image dropped to fit the provider's limit. */
const IMAGE_OMITTED_NOTE = '[An earlier image was omitted because the provider limits images per request.]'

/** Failure codes another stored key can cure: refused key, exhausted quota and rate limit. */
const ROTATING_CODES: ReadonlySet<string> = new Set(['AUTH', 'QUOTA', 'RATE_LIMIT'])

/** One resolution's frozen view: the profiles and the collection built from them. */
interface PiAiSnapshot {
  /** The resolved profiles this collection was built from, used as its identity. */
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /** Providers for exactly those profiles; never mutated once published. */
  models: Models
}

/** Constructor options for {@link PiAiAdapter}: the two resolution hooks the plugin owns. */
export interface PiAiAdapterOptions {
  /** Current validated profiles by provider route; called once per operation. */
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /**
   * Resolve the credential for one already-resolved profile; called once per
   * stream call and frozen for that call, and by `listModels`, which offers no
   * models while it throws `MISSING_CREDENTIAL`. `undefined` defers to the route's own
   * pi-ai auth, which for an installed catalog route is its provider-native
   * ambient discovery; the plugin allows that only for a profile naming no
   * credential at all, because a named reference that misses throws `LlmError`
   * `MISSING_CREDENTIAL` rather than falling back.
   */
  resolveApiKey: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<string | undefined>
  /**
   * After a provider refused `refused` for rate, quota or key reasons, rest it and return another stored
   * key that this request has not tried, or `undefined` when none is left.
   */
  /** Milliseconds a stored key still rests after a refusal; omission means keys never rest. */
  apiKeyReadyInMs?: (key: string) => number
  rotateApiKey?: (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
    refused: ReadonlySet<string>,
  ) => Promise<string | undefined>
  /**
   * How every collection this adapter builds resolves auth the request-level
   * `apiKey` override does not cover. Required rather than optional: a
   * collection built without them gets pi-ai's in-memory default store, which
   * is empty at every boot and discarded on every configuration change, so a
   * route whose only method is a login would report itself unconfigured on
   * every request no matter how often the human signed in.
   */
  auth: PiAiAuthInjection
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentStore | undefined
  /** Bridge one attachment reference into the current model-tool execution world. */
  resolveImageAccess?: (attachments: AttachmentStore, ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined
  /**
   * Observe one assistant history message degrading to provider-neutral
   * conversion because its stored replay state is unusable by this build.
   */
  onReplayDegrade?: (detail: { provider: string; model: string; reason: string }) => void
}

/** The two auth injectables a pi-ai collection is built with. */
export interface PiAiAuthInjection {
  /** Durable storage for credentials pi-ai itself writes: logins, and the refreshes it runs under its own lock. */
  credentials: CredentialStore
  /** Ambient lookups a provider performs while resolving its own auth. */
  authContext: AuthContext
}

/** Copy profile stream knobs into pi-ai's common option vocabulary. */
function profileOptions(
  profile: ResolvedPiAiProviderProfile,
  reasoning: ModelThinkingLevel | undefined,
  apiKey: string | undefined,
): SimpleStreamOptions {
  const enabledReasoning: ThinkingLevel | undefined = reasoning === 'off' ? undefined : reasoning
  return {
    ...apiKey === undefined ? {} : { apiKey },
    ...enabledReasoning === undefined ? {} : { reasoning: enabledReasoning },
    ...profile.thinkingBudgets === undefined ? {} : { thinkingBudgets: profile.thinkingBudgets },
    ...profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention },
    ...profile.transport === undefined ? {} : { transport: profile.transport },
    ...profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs },
    ...profile.websocketConnectTimeoutMs === undefined ? {} : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs },
    // The agent recovery layer owns visible attempts; one adapter call is one SDK attempt.
    maxRetries: 0,
  }
}

/**
 * The profile default this exact model can actually take, for DESCRIBING it.
 * A configured level the model does not support yields none rather than
 * throwing: `resolveModel` builds the model catalog, and a catalog that fails
 * takes its whole provider out of every picker — so one mis-set profile field
 * would hide every model on the route, including the ones that support the
 * level. The request path still refuses, which is where a bad configuration
 * belongs: describing what a model can do must not fail because a deployment
 * asked it for something it cannot.
 * @param model - the resolved model descriptor.
 * @param effort - the profile's configured level, if any.
 * @returns the level when this model supports it, otherwise undefined.
 */
function describableReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  return getSupportedThinkingLevels(model).some(level => level === effort)
    ? effort as ModelThinkingLevel
    : undefined
}

/** Validate an explicit Harness/profile effort without invoking pi-ai's clamp. */
function resolveReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  const supported = getSupportedThinkingLevels(model)
  if (supported.some(level => level === effort)) return effort as ModelThinkingLevel
  throw new LlmError(
    `pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Selectable reasoning efforts for one model, or nothing at all.
 *
 * A model that carries no reasoning metadata — every hand-declared one, and
 * every catalog model pi-ai marks as non-reasoning — is reported by pi-ai as
 * supporting the single level `off`. Passing that through would offer a control
 * that cannot do what it says: `off` is translated to *omitting* the reasoning
 * option, which for such a model is byte-for-byte the same request as naming no
 * effort — so a provider whose own default is to think would keep thinking with
 * `off` selected. Omitting `reasoning` entirely is the seam's way of saying the
 * capability is unavailable, which leaves the surface offering only the
 * provider's default.
 * @param model - the resolved model descriptor.
 * @param defaultLevel - the profile's configured effort, already validated.
 * @returns the `reasoning` field, or an empty object when none can be offered.
 */
function reasoningInfo(
  model: Model<Api>,
  defaultLevel: ModelThinkingLevel | undefined,
): Pick<LlmResolvedModelInfo, 'reasoning'> | Record<string, never> {
  if (!model.reasoning) return {}
  const levels = getSupportedThinkingLevels(model)
  return {
    reasoning: {
      efforts: levels.map(level => ({
        id: ReasoningEffortId(level),
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
      ...defaultLevel === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultLevel) },
    },
  }
}

/** Merge deployment headers while removing case-insensitive attribution collisions. */
function requestHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  }
}

/**
 * pi-ai-backed multi-provider adapter. Each operation reads the current
 * profiles, so a configuration change reaches the next request without a
 * restart; model descriptors come from the collection those profiles built.
 */
export class PiAiAdapter extends LlmAdapter {
  private snapshot: PiAiSnapshot | undefined
  /**
   * Requested models that recently fell back, by `provider/model`, with the model that answered and until when. Later
   * steps go straight to that model: the conversation's replay data (such as Gemini thought signatures) then stays
   * with one model, and no request is spent on a model known to be out of quota or overloaded.
   */
  private readonly fallenBack = new Map<string, { readonly model: string; readonly until: number }>()

  constructor(private readonly config: PiAiAdapterOptions) {
    super()
  }

  override imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef) {
    const snapshot = this.current()
    this.modelOf(snapshot, provider, model)
    const profile = this.profileOf(snapshot, provider)
    return requestImageTarget(image, { maxPixels: profile.requestImagePixelBudget, maxBytes: profile.requestImageMaxBytes })
  }

  /**
   * The snapshot for the current profiles. Resolution memoizes its result, so
   * an unchanged configuration is recognized by identity; a changed one gets a
   * brand-new collection, leaving any snapshot an operation already captured
   * untouched for as long as that operation holds it.
   */
  private current(): PiAiSnapshot {
    const profiles = this.config.profiles()
    if (this.snapshot?.profiles === profiles) return this.snapshot
    const models: MutableModels = createModels(this.config.auth)
    for (const profile of profiles.values()) {
      if (profile.piProvider !== undefined) models.setProvider(profile.piProvider)
    }
    this.snapshot = { profiles, models }
    return this.snapshot
  }

  /** The profile for one route within one snapshot, or the not-owned failure. */
  private profileOf(snapshot: PiAiSnapshot, provider: string): ResolvedPiAiProviderProfile {
    const profile = snapshot.profiles.get(provider)
    if (profile === undefined) {
      throw new LlmError(`pi-ai adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    }
    return profile
  }

  /** The configured descriptor for one exact route/model pair within one snapshot. */
  private modelOf(snapshot: PiAiSnapshot, provider: string, model: string): Model<Api> {
    const profile = this.profileOf(snapshot, provider)
    const failure = profile.modelErrors.get(model)
      ?? (profile.piProvider === undefined ? profile.catalogError : undefined)
    if (failure !== undefined) throw new LlmError(failure, 'INVALID_CONFIG')
    const resolved = snapshot.models.getModel(provider, model)
    if (resolved === undefined) {
      throw new LlmError(`pi-ai provider "${provider}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
    }
    return resolved
  }

  override providerInfo(provider: string): LlmProviderInfo {
    // The configured name, not the route key: `displayName` exists so a
    // deployment can label a route, and a label only the configuration surface
    // reads would leave every selector showing the raw key.
    return { id: provider, name: this.current().profiles.get(provider)?.displayName ?? provider }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.current().profiles.get(provider)?.retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(async () => {
      const snapshot = this.current()
      const profile = this.profileOf(snapshot, provider)
      try { await this.config.resolveApiKey(provider, profile) }
      catch (error) {
        // A route whose named key does not resolve cannot serve a request, so it offers no models until the key is stored.
        if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') return []
        throw error
      }
      return snapshot.models.getModels(provider).map(model => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: [...model.input],
      }))
    })
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const snapshot = this.current()
      return this.modelInfo(snapshot, provider, model)
    })
  }

  private modelInfo(snapshot: PiAiSnapshot, provider: string, model: string): LlmResolvedModelInfo {
    const profile = this.profileOf(snapshot, provider)
    const resolvedModel = this.modelOf(snapshot, provider, model)
    const defaultLevel = describableReasoningLevel(resolvedModel, profile.reasoning)
    // Only a cap the deployment configured is a request default; the
    // catalog's `maxTokens` sizes the model and stops there.
    const configuredMaxTokens = profile.configuredMaxTokens.get(model)
    return {
      provider,
      id: model,
      name: resolvedModel.name,
      inputModalities: [...resolvedModel.input],
      context: { contextWindow: resolvedModel.contextWindow },
      ...configuredMaxTokens === undefined ? {} : { defaultMaxTokens: configuredMaxTokens },
      ...reasoningInfo(resolvedModel, defaultLevel),
      ...conversationUpdates(resolvedModel),
    }
  }

  override prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const snapshot = this.current()
    return Promise.resolve({
      model: this.modelInfo(snapshot, provider, model),
      stream: options => this.streamWithSnapshot(options, snapshot),
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithSnapshot(options, this.current())
  }

  private async * streamWithSnapshot(
    options: GenerateOptions,
    snapshot: PiAiSnapshot,
  ): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('llm-pi-ai does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    // One capture per stream call, taken before any await: the profile, the
    // model descriptor, and the collection all come from the same immutable
    // snapshot, and the credential freezes with them. A configuration change
    // mid-request builds a separate snapshot, so this request finishes under
    // the one it started with and the next call picks up the new one.
    const profile = this.profileOf(snapshot, options.provider)
    const fallbackKey = `${options.provider}/${options.model}`
    const recent = this.fallenBack.get(fallbackKey)
    if (recent !== undefined && recent.until <= Date.now()) this.fallenBack.delete(fallbackKey)
    const sticky = recent !== undefined && recent.until > Date.now() ? recent.model : undefined
    let model = this.modelOf(snapshot, options.provider, sticky ?? options.model)
    const fallbacks = (profile.fallbackModels ?? []).filter(id => id !== model.id && id !== options.model)
    /** Remember a fallback so the following steps start on the model that answered. */
    const rememberFallback = (to: string, quota: boolean): void => {
      this.fallenBack.set(fallbackKey, { model: to, until: Date.now() + (quota ? QUOTA_FALLBACK_MS : OVERLOAD_FALLBACK_MS) })
    }
    const updates = conversationUpdates(model)
    // pi-ai collapses Anthropic tool updates without an initially active declaration.
    const tools = options.tools ?? []
    const needsPlaceholder = model.api === 'anthropic-messages' && updates.toolUpdate === 'in-history'
      && tools.every(tool => tool.deferLoading === true)
      && options.messages.some(message => message.role === 'developer'
        && message.content.some(block => block.type === 'tool-addition' || block.type === 'tool-removal'))
    const request = needsPlaceholder
      ? { ...options, tools: [ANTHROPIC_TOOL_UPDATE_PLACEHOLDER, ...tools] }
      : options
    let reasoning = resolveReasoningLevel(
      model,
      options.reasoningEffort ?? profile.reasoning,
    )
    let apiKey = await this.config.resolveApiKey(options.provider, profile)
    const refusedKeys = new Set<string>()
    let switchedModel = false

    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    const streamIdleTimeoutMs = profile.streamIdleTimeoutMs
    using watchdog = idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')

    try {
      const containsImage = options.messages.some(message => contentHasImage(message.content))
      if (containsImage && !model.input.includes('image')) {
        throw new LlmError(`pi-ai model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
      }
      const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
      if (containsImage && attachments === undefined) {
        throw new LlmError('pi-ai image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const onReplayDegrade = (reason: string): void => {
        this.config.onReplayDegrade?.({ provider: options.provider, model: options.model, reason })
      }
      const buildContext = async (source: typeof request) => attachments === undefined
        ? toPiContext(source, undefined, onReplayDegrade, updates.systemPromptUpdate === 'in-history')
        : await toPiContext({ ...source, signal: watchdog.signal }, {
          attachments,
          resolveImageAccess: ref => this.config.resolveImageAccess?.(attachments, ref),
          maxRequestImageBytes: profile.maxRequestImageBytes,
          requestImagePolicy: {
            maxPixels: profile.requestImagePixelBudget,
            maxBytes: profile.requestImageMaxBytes,
          },
        }, onReplayDegrade, updates.systemPromptUpdate === 'in-history')
      let context = await buildContext(request)
      let imageMessages: readonly RequestMessage[] = request.messages
      let imageOmissions = 0
      // One attempt per usable key: a provider refusal before any content arrives swaps the key and
      // sends the same context again, so a rate limit never costs the conversation its position.
      while (true) {
        // Every stored key is resting: wait for the first to recover rather than spend the request on a refusal.
        // A key rested for another model's quota is fine for a fallback model, so a model switch skips the wait once.
        const restMs = apiKey === undefined || switchedModel ? 0 : this.config.apiKeyReadyInMs?.(apiKey) ?? 0
        switchedModel = false
        if (restMs > 0) {
          await waitForKey(restMs, watchdog.signal)
          watchdog.signal.throwIfAborted()
        }
        const events = snapshot.models.streamSimple(model, context, {
          ...profileOptions(profile, reasoning, apiKey),
          ...options.temperature === undefined ? {} : { temperature: options.temperature },
          ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
          ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
          signal: watchdog.signal,
          // Profile headers are deployment-owned; attribution names are
          // Harness-owned and therefore win collisions.
          headers: requestHeaders(profile.headers),
        })
        // Replay data names the model that actually answered, so its signatures go back to that model on later steps.
        const iterator = toStreamChunks(events, model.contextWindow, options.signal, model.id)[Symbol.asyncIterator]()
        let exhausted = false
        const retryKeys: string[] = []
        try {
          const leading: StreamChunk[] = []
          let started = false
          while (true) {
            const result = await watchdog.next(iterator)
            if (result.done) {
              exhausted = true
              for (const pending of leading.splice(0)) yield pending
              return
            }
            const chunk = result.value
            if (started) {
              // Output already reached the caller, so the request cannot be resent in place. Rest the key and
              // mark the failure retryable so the next attempt of this step continues on another key.
              if (chunk.type === 'finish' && chunk.reason.kind === 'error' && ROTATING_CODES.has(chunk.reason.failure.code)
                && apiKey !== undefined && this.config.rotateApiKey !== undefined) {
                refusedKeys.add(apiKey)
                const next = await this.config.rotateApiKey(options.provider, profile, refusedKeys)
                if (next !== undefined) {
                  yield { ...chunk, reason: { kind: 'error', failure: { ...chunk.reason.failure, code: 'RATE_LIMIT' } } }
                  continue
                }
              }
              yield chunk
              continue
            }
            if (chunk.type === 'usage') {
              leading.push(chunk)
              continue
            }
            if (chunk.type === 'finish' && chunk.reason.kind === 'error' && IMAGE_LIMIT_PATTERN.test(chunk.reason.failure.message)
              && imageOmissions < MAX_IMAGE_OMISSIONS && countRequestImages(imageMessages) > 0) {
              // The provider accepts fewer images per request than the history holds: drop the oldest half,
              // keep the newest, and send the same request again instead of failing the step for good.
              imageOmissions += 1
              const dropped = Math.max(1, Math.ceil(countRequestImages(imageMessages) / 2))
              imageMessages = omitOldestImages(imageMessages, dropped, IMAGE_OMITTED_NOTE)
              context = await buildContext({ ...request, messages: [...imageMessages] })
              await watchdog.next(iterator)
              exhausted = true
              retryKeys.push(apiKey ?? '')
              break
            }
            if (chunk.type === 'finish' && chunk.reason.kind === 'error' && OVERLOADED_PATTERN.test(chunk.reason.failure.message)) {
              const fallback = fallbacks.shift()
              if (fallback !== undefined) {
                // The model is overloaded; send the same request to the next configured model instead of waiting.
                model = this.modelOf(snapshot, options.provider, fallback)
                rememberFallback(fallback, false)
                switchedModel = true
                reasoning = resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning)
                await watchdog.next(iterator)
                exhausted = true
                retryKeys.push(apiKey ?? '')
                break
              }
            }
            if (chunk.type === 'finish' && chunk.reason.kind === 'error' && ROTATING_CODES.has(chunk.reason.failure.code)
              && apiKey !== undefined && this.config.rotateApiKey !== undefined) {
              refusedKeys.add(apiKey)
              const next = await this.config.rotateApiKey(options.provider, profile, refusedKeys)
              if (next !== undefined) {
                // The refused stream has ended; let it finish so the shared consumer stays usable.
                await watchdog.next(iterator)
                exhausted = true
                retryKeys.push(next)
                break
              }
              // Every stored key is used up for this model. Quotas are kept per model, so a configured fallback model
              // can usually answer the same request right away.
              if (chunk.reason.failure.code === QUOTA_EXCEEDED_CODE) {
                const fallback = fallbacks.shift()
                if (fallback !== undefined) {
                  model = this.modelOf(snapshot, options.provider, fallback)
                  rememberFallback(fallback, true)
                  switchedModel = true
                  reasoning = resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning)
                  refusedKeys.clear()
                  await watchdog.next(iterator)
                  exhausted = true
                  retryKeys.push(apiKey)
                  break
                }
                // A per-minute quota recovers soon: report a rate limit so the step is retried once a key recovers.
                // A daily quota does not, and retrying it every few seconds only spends the retry budget.
                if (!LONG_QUOTA_PATTERN.test(chunk.reason.failure.message)) {
                  started = true
                  for (const pending of leading.splice(0)) yield pending
                  yield { ...chunk, reason: { kind: 'error', failure: { ...chunk.reason.failure, code: 'RATE_LIMIT' } } }
                  continue
                }
              }
            }
            started = true
            for (const pending of leading.splice(0)) yield pending
            yield chunk
          }
        } finally {
          if (!exhausted) {
            consumer.abort('pi-ai stream consumer stopped')
            // A demand the deadline abandoned can stay pending forever, and this
            // generator queues its return behind it; the abort above owns SDK termination.
            /* v8 ignore next -- the detached drain only rejects while unwinding an abandoned stream. */
            void iterator.return(undefined).catch(() => {})
          }
        }
        const [retryKey] = retryKeys
        if (retryKey === undefined) return
        apiKey = retryKey === '' ? undefined : retryKey
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
        throw new LlmError(`pi-ai stream idle timeout after ${streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('pi-ai request aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    } finally {
      consumer.abort('pi-ai stream consumer stopped')
    }
  }
}
