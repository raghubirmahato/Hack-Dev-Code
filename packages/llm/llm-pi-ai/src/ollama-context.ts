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

/** Ollama's port. Only servers on it are probed, so other OpenAI-compatible endpoints never see extra requests. */
const OLLAMA_PORT = '11434'

/** The fetch this module uses; replaceable in tests. */
export type OllamaFetch = (
  url: string,
  init?: { method?: string; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/**
 * Root of a possible Ollama server for an OpenAI-compatible base URL.
 * @param baseUrl - the route's base URL.
 * @returns `protocol//host:port`, or undefined when the URL is not on Ollama's port.
 */
export function ollamaRoot(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined || baseUrl.length === 0) return undefined
  let url: URL
  try { url = new URL(baseUrl) } catch { return undefined }
  return url.port === OLLAMA_PORT ? `${url.protocol}//${url.host}` : undefined
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
interface ShowAnswer { model_info?: Record<string, unknown>; parameters?: string }

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

  constructor(private readonly fetchImpl: OllamaFetch = (url, init) => fetch(url, init)) {}

  /**
   * The model to request on this route.
   * @param baseUrl - the route's OpenAI-compatible base URL.
   * @param model - the configured model id.
   * @param contextWindow - the context the route configures for the model, if any.
   * @returns the variant name, or `model` when the server is not Ollama or nothing needs to change.
   */
  async modelFor(baseUrl: string | undefined, model: string, contextWindow?: number): Promise<string> {
    const root = ollamaRoot(baseUrl)
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
    let known = this.servers.get(root)
    if (known === undefined) {
      known = this.fetchImpl(`${root}/api/version`, { signal: AbortSignal.timeout(5_000) })
        .then(async response => response.ok && typeof (await response.json() as { version?: unknown }).version === 'string', () => false)
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
