/** Shared projection of the live LLM registry into the browser model catalog. */

import { RemoteError } from '@hackdevcode/dsh-typert-protocol'
import { credentialRef } from '@hackdevcode/dsh-credentials'
import type {} from '@hackdevcode/dsh-settings'
import { ReasoningEffortId } from '@hackdevcode/dsh-llm'
import type { LlmModelInfo } from '@hackdevcode/dsh-llm'
import type { Context } from '@hackdevcode/cordis'
import type {
  ModelCatalog,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(model.badge === undefined ? {} : { badge: model.badge }),
        }
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const groups = catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
    .filter(group => group.models.length > 0)
  return {
    default: { ...defaultSelection },
    routableProviders: groups.map(group => group.id),
    groups,
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * Check a GUI selection against the current available provider catalog.
 * @param ctx - Host LLM registry.
 * @param selection - stored or explicitly requested selection.
 * @returns whether the exact model is currently advertised as available.
 */
export async function modelAvailable(ctx: Context, selection: ModelSelection): Promise<boolean> {
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)) return false
  let models: readonly LlmModelInfo[]
  try { models = await ctx.llm.listModels(selection.provider) }
  catch (error) {
    throw new RemoteError('session/model-unavailable',
      error instanceof Error ? error.message : String(error),
      { provider: selection.provider, model: selection.model })
  }
  return models.some(model => model.id === selection.model)
}

/**
 * Check configured provider API-key references independently of model availability.
 * @param ctx - Host registry, settings, and credential services.
 * @returns whether any API-key provider has a configured credential.
 */
export async function hasProviderApiKey(ctx: Context): Promise<boolean> {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) {
    throw new RemoteError('session/provider-credentials-unavailable', 'provider credentials are unavailable', {})
  }
  const namespaces = settings.describe({ redactSecrets: true })
  for (const provider of ctx.llm.listConfigurableProviders()) {
    if (provider.provider === 'deepseek-account') continue
    let profile = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
    for (const key of provider.settingsPath) {
      profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
    }
    if (typeof profile !== 'object' || profile === null) continue
    const ref: unknown = Reflect.get(profile, 'apiKeyEnv')
    if (typeof ref === 'string' && ref.length > 0
      && (await credentials.describe(credentialRef(ref))).configured) return true
  }
  return false
}

/**
 * Make the default model one that works. When no default was ever chosen, or the default's provider is not
 * registered or offers no models without failing (a provider with no key), save the first available model. A
 * provider that failed to list (Ollama not running yet) keeps its default, so a passing outage never replaces it.
 * DeepSeek is chosen only when no other provider offers a model.
 * @param ctx - Host LLM registry and default-model service.
 * @param catalog - an already built catalog, to avoid listing twice.
 * @returns the catalog with the default it now holds.
 */
export async function ensureUsableDefault(ctx: Context, catalog?: ModelCatalog): Promise<ModelCatalog> {
  const current = catalog ?? await buildModelCatalog(ctx)
  const chosen = current.default
  const usable = current.groups.some(group => group.id === chosen.provider && group.models.some(model => model.id === chosen.model))
  const failing = current.failures.some(failure => failure.id === chosen.provider)
  // DeepSeek is not the preferred default: another working provider (a local model, or one the person added) comes first.
  const first = current.groups.find(group => !group.id.startsWith('deepseek')) ?? current.groups[0]
  const model = first?.models[0]
  if (usable || (failing && chosen.provider !== '') || first === undefined || model === undefined) return current
  const effort = model.reasoning?.defaultEffort
  await ctx.agentDefaultModel.saveSelection({
    provider: first.id, model: model.id, ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
  })
  const selection: ModelSelection = { provider: first.id, model: model.id, ...effort === undefined ? {} : { reasoningEffort: effort } }
  return { ...current, default: selection }
}
