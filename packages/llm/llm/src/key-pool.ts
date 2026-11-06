/**
 * Round-robin rotation over several API keys stored under one credential reference.
 *
 * @module @hackdevcode/dsh-llm/key-pool
 */

/** Milliseconds a key rests after the provider rejected it for rate limiting. */
const DEFAULT_COOLDOWN_MS = 60_000

/** Longest a request waits for a resting key before it is sent anyway. */
export const MAX_KEY_WAIT_MS = 60_000

/**
 * Wait until a resting key may be used again, so a request does not spend itself on a key that is
 * certain to be refused. Resolves early when the signal aborts.
 * @param ms - remaining rest, capped at {@link MAX_KEY_WAIT_MS}.
 * @param signal - the request's abort signal.
 */
export async function waitForKey(ms: number, signal?: AbortSignal): Promise<void> {
  const wait = Math.min(Math.max(0, ms), MAX_KEY_WAIT_MS)
  if (wait === 0 || signal?.aborted === true) return
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, wait)
    signal?.addEventListener('abort', done, { once: true })
  })
}

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
   * How long a key still rests; zero once it may be used again.
   * @param key - a key previously returned by {@link next}.
   * @returns the remaining rest in milliseconds.
   */
  readyInMs(key: string): number {
    return Math.max(0, (this.restingUntil.get(key) ?? 0) - this.now())
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
