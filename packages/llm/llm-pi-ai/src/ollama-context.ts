/**
 * Ollama's OpenAI-compatible endpoint loads every model with the server's default context (4096 tokens unless the
 * server sets OLLAMA_CONTEXT_LENGTH) and ignores a per-request context size, so a prompt with tool definitions is cut
 * from the front and the model never sees its instructions or tools. This module gives each Ollama model a variant
 * with a larger `num_ctx`, created once through Ollama's own API (it shares the original's weights, so it costs no
 * disk space), and names the variant to request instead.
 * @module @hackdevcode/dsh-llm-pi-ai/ollama-context
 */

/** Context the variant asks for when the route does not configure a context window. */
export const OLLAMA_DEFAULT_NUM_CTX = 32_768

/** Below this the server default is already large enough for an agent prompt to be unlikely to fit better. */
const SERVER_DEFAULT_NUM_CTX = 4_096

/** Ollama's default port. */
const OLLAMA_PORT = '11434'

/** How long a local server that answered, but not as Ollama, is left alone before it is asked again. */
const NOT_OLLAMA_MS = 300_000

/**
 * Whether a host is this machine or a private network address, where locally served models live.
 * @param hostname - the URL's host, without brackets for IPv6.
 * @returns true for loopback, private IPv4 ranges, `.local` names and the container host aliases.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0] = parts
  // Loopback, the three private ranges, link-local, and the carrier-grade range that mesh VPNs hand out.
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
}

/** The fetch this module uses; replaceable in tests. */
export type OllamaFetch = (
  url: string,
  init?: { method?: string; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/**
 * Whether a route is one the person set up for Ollama: the Ollama card names its routes `ollama`, `ollama-2`, ...
 * whatever address they point at.
 * @param provider - the route id.
 * @returns true when the id starts with `ollama`.
 */
export function isOllamaRoute(provider: string | undefined): boolean {
  return provider !== undefined && provider.toLowerCase().startsWith('ollama')
}

/**
 * Root of a possible Ollama server for an OpenAI-compatible base URL: a server on Ollama's port, or, for a route the
 * person set up as Ollama, a server on any port or machine (Ollama moved to another port, in a container, or on
 * another computer). Whether it really is Ollama is settled by asking it once; other endpoints never see that
 * question.
 * @param baseUrl - the route's base URL.
 * @param named - the route was set up as Ollama (see {@link isOllamaRoute}).
 * @returns `protocol//host:port`, or undefined when the URL is not taken for an Ollama server.
 */
export function ollamaRoot(baseUrl: string | undefined, named = false): string | undefined {
  if (baseUrl === undefined || baseUrl.length === 0) return undefined
  let url: URL
  try { url = new URL(baseUrl) } catch { return undefined }
  return url.port === OLLAMA_PORT || named ? `${url.protocol}//${url.host}` : undefined
}

/**
 * Whether a route serves a model on this machine or the private network, where chat templates are often not applied.
 * @param baseUrl - the route's base URL.
 * @param provider - the route id.
 * @returns true for Ollama's port, an Ollama route, or a local or private-network host.
 */
export function isLocalModelServer(baseUrl: string | undefined, provider?: string): boolean {
  if (ollamaRoot(baseUrl, isOllamaRoute(provider)) !== undefined) return true
  if (baseUrl === undefined) return false
  try { return isLocalHost(new URL(baseUrl).hostname) } catch { return false }
}

/**
 * The name of the larger-context variant of an Ollama model: `hackdev/<model>:<tag>`.
 * @param model - the model the route names, such as `gemma4:e2b`.
 * @returns the variant name.
 */
export function ollamaVariantName(model: string): string {
  const [name = model, tag = 'latest'] = model.split(':')
  return `hackdev/${name.replaceAll('/', '-')}:${tag}`
}

/** Fields of `/api/show` used here. */
interface ShowAnswer { model_info?: Record<string, unknown>; parameters?: string; capabilities?: unknown }

/** What Ollama says about one model. */
export interface OllamaModelFacts {
  /** The context length the model was trained with. */
  trained?: number
  /** What the model can do, such as `completion`, `tools`, `vision`, `thinking`, `embedding`; absent on old servers. */
  capabilities?: readonly string[]
}

/**
 * Ask an Ollama server what its models can do, for the model list a settings page offers.
 * @param baseUrl - the route's OpenAI-compatible base URL.
 * @param models - model ids to describe.
 * @param named - the route was set up as Ollama, so any port is asked.
 * @param fetchImpl - the fetch to use.
 * @param signal - cancels the questions.
 * @returns facts per model id; empty when the server is not Ollama or did not answer in time.
 */
export async function describeOllamaModels(
  baseUrl: string | undefined, models: readonly string[], named = false,
  fetchImpl: OllamaFetch = (url, init) => fetch(url, init), signal?: AbortSignal,
): Promise<Map<string, OllamaModelFacts>> {
  const facts = new Map<string, OllamaModelFacts>()
  const root = ollamaRoot(baseUrl, named)
  if (root === undefined || models.length === 0) return facts
  const within = (ms: number): AbortSignal =>
    signal === undefined ? AbortSignal.timeout(ms) : AbortSignal.any([signal, AbortSignal.timeout(ms)])
  try {
    const version = await fetchImpl(`${root}/api/version`, { signal: within(3_000) })
    if (!version.ok || typeof (await version.json() as { version?: unknown }).version !== 'string') return facts
  } catch {
    return facts
  }
  await Promise.all(models.slice(0, 200).map(async (model) => {
    try {
      const response = await fetchImpl(`${root}/api/show`, { method: 'POST', body: JSON.stringify({ model }), signal: within(10_000) })
      if (!response.ok) return
      const answer = await response.json() as ShowAnswer
      const { trained } = contextOf(answer)
      const capabilities = Array.isArray(answer.capabilities) ? answer.capabilities.filter((entry): entry is string => typeof entry === 'string') : undefined
      facts.set(model, { ...trained === undefined ? {} : { trained }, ...capabilities === undefined ? {} : { capabilities } })
    } catch {
      // One model that cannot be described keeps what the listing said about it.
    }
  }))
  return facts
}

/** The trained context length from `/api/show`, and the `num_ctx` the model already sets, if any. */
function contextOf(answer: ShowAnswer): { trained?: number; numCtx?: number } {
  const entry = Object.entries(answer.model_info ?? {}).find(([key]) => key.endsWith('.context_length'))
  const trained = typeof entry?.[1] === 'number' ? entry[1] : undefined
  const match = /(?:^|\n)\s*num_ctx\s+(\d+)/u.exec(answer.parameters ?? '')
  return { ...trained === undefined ? {} : { trained }, ...match?.[1] === undefined ? {} : { numCtx: Number(match[1]) } }
}

/**
 * Resolves, per server and model, the model name to request so the prompt fits. Answers are cached for the life of
 * the adapter; a failure falls back to the original name, which behaves as before.
 */
export class OllamaContext {
  private readonly resolved = new Map<string, Promise<string>>()
  private readonly servers = new Map<string, Promise<boolean>>()
  /** Local servers that answered but are not Ollama (LM Studio, llama.cpp, vLLM), with when to ask again. */
  private readonly notOllama = new Map<string, number>()

  constructor(private readonly fetchImpl: OllamaFetch = (url, init) => fetch(url, init)) {}

  /**
   * The model to request on this route.
   * @param baseUrl - the route's OpenAI-compatible base URL.
   * @param model - the configured model id.
   * @param contextWindow - the context the route configures for the model, if any.
   * @param named - the route was set up as Ollama, so a server on any port is asked whether it is one.
   * @returns the variant name, or `model` when the server is not Ollama or nothing needs to change.
   */
  async modelFor(baseUrl: string | undefined, model: string, contextWindow?: number, named = false): Promise<string> {
    const root = ollamaRoot(baseUrl, named)
    if (root === undefined || model.startsWith('hackdev/')) return model
    const key = `${root} ${model} ${String(contextWindow ?? '')}`
    let pending = this.resolved.get(key)
    if (pending === undefined) {
      // A failure (Ollama still starting, a slow first answer) is not remembered: the next request tries again.
      pending = this.resolve(root, model, contextWindow).catch(() => {
        this.resolved.delete(key)
        return model
      })
      this.resolved.set(key, pending)
    }
    return pending
  }

  private isOllama(root: string): Promise<boolean> {
    const retryAt = this.notOllama.get(root)
    if (retryAt !== undefined) {
      if (retryAt > Date.now()) return Promise.resolve(false)
      this.notOllama.delete(root)
    }
    let known = this.servers.get(root)
    if (known === undefined) {
      known = this.fetchImpl(`${root}/api/version`, { signal: AbortSignal.timeout(5_000) })
        .then(async (response) => {
          const ollama = response.ok && typeof (await response.json() as { version?: unknown }).version === 'string'
          // Another kind of server answered: it is not asked again on every request.
          if (!ollama) this.notOllama.set(root, Date.now() + NOT_OLLAMA_MS)
          return ollama
        }, () => false)
        .then((ollama) => {
          // Only a confirmed Ollama is remembered; a server that did not answer is asked again next time.
          if (!ollama) this.servers.delete(root)
          return ollama
        })
      this.servers.set(root, known)
    }
    return known
  }

  private async show(root: string, model: string): Promise<ShowAnswer | undefined> {
    const response = await this.fetchImpl(`${root}/api/show`, {
      method: 'POST', body: JSON.stringify({ model }), signal: AbortSignal.timeout(10_000),
    })
    return response.ok ? await response.json() as ShowAnswer : undefined
  }

  private async resolve(root: string, model: string, contextWindow: number | undefined): Promise<string> {
    // Failures throw, so they are not cached and the next request tries again; only a settled answer is kept.
    if (!await this.isOllama(root)) throw new Error('no Ollama server answered')
    const original = await this.show(root, model)
    if (original === undefined) throw new Error('Ollama did not describe the model')
    const { trained, numCtx } = contextOf(original)
    const wanted = Math.min(contextWindow ?? OLLAMA_DEFAULT_NUM_CTX, trained ?? Number.POSITIVE_INFINITY)
    // The model already asks for enough context, or more would not help.
    if (wanted <= SERVER_DEFAULT_NUM_CTX || (numCtx !== undefined && numCtx >= wanted)) return model
    const variant = ollamaVariantName(model)
    const existing = await this.show(root, variant).catch(() => undefined)
    if (existing !== undefined && contextOf(existing).numCtx === wanted) return variant
    const created = await this.fetchImpl(`${root}/api/create`, {
      method: 'POST',
      body: JSON.stringify({ model: variant, from: model, parameters: { num_ctx: wanted }, stream: false }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!created.ok) throw new Error('Ollama did not create the variant')
    return variant
  }
}

/**
 * Whether a base URL names Ollama's default port, so the route's models get Ollama's context as their default.
 * @param baseUrl - the route's base URL.
 * @returns true for port 11434.
 */
export function isOllamaPort(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined) return false
  try { return new URL(baseUrl).port === OLLAMA_PORT } catch { return false }
}
