/** API-key authentication, credential-gated discovery, and the official model listing for the official DeepSeek route. */
import type { Context } from '@hackdevcode/cordis'
import { ApiKeyPool, APP_IDENTITY, assertUsableApiKey, LlmError, splitApiKeys } from '@hackdevcode/dsh-llm'
import type { LlmModelBadge } from '@hackdevcode/dsh-llm'
import type {} from '@hackdevcode/cordis-plugin-loader'
import { launchEnvironmentOf } from '@hackdevcode/dsh-launch-environment'
import {
  catalogModelInfo, createModelListingCache, refuseListedModel, registerDeepSeekProvider, requestModelListing, resolveListedCatalog,
} from '@hackdevcode/dsh-llm-deepseek'
import type { CatalogRefusal, DeepSeekCatalogModel, DeepSeekRequestAuth, ListingView, ModelListing } from '@hackdevcode/dsh-llm-deepseek'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'

export { Config, plainOptions, resolveAdapterOptions } from './config.ts'
export type { Options, ResolvedDeepSeekOptions } from './config.ts'
export const name = 'llm-deepseek-api-key'
export const inject = ['llm']

const PROVIDER = 'deepseek-official'
/** Refusals that another key can cure: invalid key, no balance, forbidden, and rate limit. */
const ROTATING_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 429])
/** Console tag of listing diagnostics; product profiles mount no console exporter for `ctx.logger`. */
const LOG_TAG = '[llm-deepseek-api-key]'

/** Connection facts of one operation: protocol settings plus the catalog resolved with them. */
interface OfficialConnection extends ResolvedDeepSeekOptions {
  /** Selectable models: the configured catalog, or the offered part of the followed listing. */
  readonly offered: readonly DeepSeekCatalogModel[]
  /** Listed models refused before network I/O, by id. */
  readonly refusals: ReadonlyMap<string, CatalogRefusal>
  /** Listed badges of offered models, by id; empty without a followed listing. */
  readonly badges: ReadonlyMap<string, LlmModelBadge>
}

export function apply(ctx: Context, config: Config): void {
  const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  options()
  // A credential may hold several keys; each request takes the next one so free-tier limits are shared out.
  const pool = new ApiKeyPool()
  // Listing the catalog is not a model request: it reads the first key and leaves the rotation where it was.
  const resolveApiKey = async (connection: ResolvedDeepSeekOptions, rotate = true): Promise<string> => {
    const ref = connection.apiKeyEnv
    const choose = (stored: string): string => rotate ? pool.next(ref, stored) : splitApiKeys(stored)[0] ?? stored
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(choose(hit.value), 'llm-deepseek', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(choose(ambient.value), 'llm-deepseek', ref)
      }
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }
  /** The next stored key this request has not yet tried, or `undefined` when every key was refused. */
  const untriedKey = async (connection: ResolvedDeepSeekOptions, tried: ReadonlySet<string>): Promise<string | undefined> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    const stored = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (stored === undefined) return undefined
    for (let attempt = 0; attempt < splitApiKeys(stored).length; attempt++) {
      const key = assertUsableApiKey(pool.next(ref, stored), 'llm-deepseek', ref)
      if (!tried.has(key)) return key
    }
    return undefined
  }
  /** Auth for one key; a refusal rests that key and offers the next one for the same request. */
  const authWith = (connection: ResolvedDeepSeekOptions, key: string, tried: Set<string>): DeepSeekRequestAuth => ({
    headers: { 'x-api-key': key },
    readyInMs: pool.readyInMs(key),
    rotate: async ({ status, retryAfterMs }) => {
      if (!ROTATING_STATUSES.has(status)) return undefined
      pool.report(key, retryAfterMs)
      tried.add(key)
      const next = await untriedKey(connection, tried)
      return next === undefined ? undefined : authWith(connection, next, tried)
    },
  })
  /** The API key, or `undefined` when none is configured; other credential failures propagate. */
  const presentApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string | undefined> => {
    try { return await resolveApiKey(connection, false) }
    catch (error) {
      if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') return undefined
      throw error
    }
  }
  const listings = createModelListingCache(ctx, name, PROVIDER, {
    settings: () => options().listing,
    credential: async () => presentApiKey(options()),
    load: (url, apiKey, signal) => requestModelListing(url, { 'x-api-key': apiKey }, signal),
  })
  let reportedListing: ModelListing | undefined
  /** Resolve the catalog, reporting each listing's hidden entries and dropped badges once. */
  const connectionOf = (connection: ResolvedDeepSeekOptions, view: ListingView | undefined): OfficialConnection => {
    if (view === undefined) return { ...connection, offered: connection.models, refusals: new Map(), badges: new Map() }
    const catalog = resolveListedCatalog({
      listing: view.listing?.entries,
      supported: connection.models,
      overrides: {},
      routeMaxTokens: connection.maxTokens,
      clientVersion: APP_IDENTITY.version,
    })
    if (view.listing !== reportedListing) {
      reportedListing = view.listing
      for (const problem of catalog.problems) console.warn(LOG_TAG, problem)
    }
    return { ...connection, models: catalog.resolution, offered: catalog.offered, refusals: catalog.refusals, badges: catalog.badges }
  }
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [] },
  ])
  registerDeepSeekProvider<OfficialConnection>(ctx, PROVIDER, {
    providerName: 'DeepSeek',
    options: () => {
      const connection = options()
      return connectionOf(connection, connection.listing === undefined ? undefined : listings.current())
    },
    connect: async (signal) => {
      const connection = options()
      if (connection.listing === undefined) return connectionOf(connection, undefined)
      let view: ListingView
      try { view = await listings.view(connection.listing, signal) }
      catch (error) {
        if (signal?.aborted === true) throw error
        // The cache keeps the previous credential's listing when this lookup fails, so gate nothing;
        // `resolveAuth` reports the failure on the model request, after the turn records the prompt.
        return connectionOf(connection, undefined)
      }
      return connectionOf(connection, view)
    },
    resolveAuth: async (connection) => {
      const key = await resolveApiKey(connection)
      return authWith(connection, key, new Set())
    },
    admit: (connection, model) => { refuseListedModel(model, connection.refusals.get(model)) },
    discoverModels: async (provider) => {
      const connection = options()
      if (connection.listing === undefined) {
        if (await presentApiKey(connection) === undefined) return []
        return connection.models.map(model => catalogModelInfo(provider, model))
      }
      const view = await listings.view(connection.listing)
      if (!view.authenticated) return []
      const { offered, badges } = connectionOf(connection, view)
      return offered.map(model => catalogModelInfo(provider, model, badges.get(model.id)))
    },
  })
  // Starting or stopping to follow the listing discards it, so restoring the built-in
  // catalog after a customization reloads the listing on the next access.
  let following = options().listing !== undefined
  ctx.on('loader/volatile-update', () => {
    let next: boolean
    // The transport's own listener reports a configuration the adapter rejects.
    try { next = options().listing !== undefined }
    catch (_rejectedConfiguration) { return }
    if (next !== following) listings.invalidate()
    following = next
  })
}
