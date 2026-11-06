/**
 * Round-robin rotation over several API keys stored under one credential reference.
 *
 * @module @hackdevcode/dsh-llm/key-pool
 */

/** Milliseconds a key rests after the provider rejected it for rate limiting. */
const DEFAULT_COOLDOWN_MS = 60_000

/**
 * Split one stored credential into its individual keys.
 * Keys are separated by commas or semicolons; a space or line break inside one key is left for key
 * validation to refuse. Blanks and duplicates are dropped.
 * @param raw - the credential exactly as stored.
 * @returns the distinct non-empty keys in stored order.
 */
export function splitApiKeys(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[,;]+/)) {
    const key = part.trim()
    if (key.length > 0) seen.add(key)
  }
  return [...seen]
}

/** Rotates through the keys of each credential reference, resting a key that the provider throttled. */
export class ApiKeyPool {
  private readonly cursor = new Map<string, number>()
  private readonly restingUntil = new Map<string, number>()

  /**
   * @param now - clock in milliseconds; injectable for deterministic tests.
   * @param cooldownMs - how long a reported key rests before it is offered again.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly cooldownMs: number = DEFAULT_COOLDOWN_MS,
  ) {}

  /**
   * Choose the key for the next request.
   * @param ref - credential reference the keys were stored under.
   * @param raw - the stored credential, one key or several.
   * @returns the next rested key; when every key is resting, the one that rests the shortest.
   */
  next(ref: string, raw: string): string {
    const keys = splitApiKeys(raw)
    const [only] = keys
    if (keys.length <= 1) return only ?? raw
    const start = (this.cursor.get(ref) ?? 0) % keys.length
    const at = this.now()
    let chosen = start
    let soonestUntil = Number.POSITIVE_INFINITY
    for (let step = 0; step < keys.length; step++) {
      const index = (start + step) % keys.length
      const until = this.restingUntil.get(keys[index] ?? '') ?? 0
      if (until <= at) {
        chosen = index
        break
      }
      if (until < soonestUntil) {
        soonestUntil = until
        chosen = index
      }
    }
    this.cursor.set(ref, chosen + 1)
    return keys[chosen] ?? raw
  }

  /**
   * Rest a key the provider throttled or rejected so the next requests use another one.
   * @param key - the key that failed.
   * @param retryAfterMs - the provider's own wait hint, when it gave one.
   */
  report(key: string, retryAfterMs?: number): void {
    this.restingUntil.set(key, this.now() + (retryAfterMs !== undefined && retryAfterMs > 0 ? retryAfterMs : this.cooldownMs))
  }

  /**
   * Number of keys stored under a credential, for diagnostics.
   * @param raw - the stored credential.
   * @returns how many distinct keys it holds.
   */
  static count(raw: string): number {
    return splitApiKeys(raw).length
  }
}
