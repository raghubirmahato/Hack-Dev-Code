import { describe, expect, it } from 'vitest'
import { ApiKeyPool, splitApiKeys, waitForKey } from '../src/key-pool.ts'

describe('splitApiKeys', () => {
  it('splits on commas and semicolons and drops blanks and duplicates', () => {
    expect(splitApiKeys(' a,b;c ,, a, d ')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('leaves a space inside one key for key validation to refuse', () => {
    expect(splitApiKeys('has space')).toEqual(['has space'])
    expect(splitApiKeys('bad\nkey')).toEqual(['bad\nkey'])
  })
})

describe('ApiKeyPool', () => {
  it('returns a single key unchanged', () => {
    expect(new ApiKeyPool().next('REF', 'only')).toBe('only')
  })

  it('rotates through the keys in order', () => {
    const pool = new ApiKeyPool()
    const seen = Array.from({ length: 5 }, () => pool.next('REF', 'a,b,c'))
    expect(seen).toEqual(['a', 'b', 'c', 'a', 'b'])
  })

  it('keeps a separate position per reference', () => {
    const pool = new ApiKeyPool()
    expect(pool.next('ONE', 'a,b')).toBe('a')
    expect(pool.next('TWO', 'x,y')).toBe('x')
    expect(pool.next('ONE', 'a,b')).toBe('b')
  })

  it('skips a resting key until its cooldown ends', () => {
    let now = 0
    const pool = new ApiKeyPool(() => now, 1000)
    pool.report('b')
    expect(Array.from({ length: 4 }, () => pool.next('REF', 'a,b,c'))).toEqual(['a', 'c', 'a', 'c'])
    now = 1000
    expect(pool.next('REF', 'a,b,c')).toBe('a')
    expect(pool.next('REF', 'a,b,c')).toBe('b')
  })

  it('offers the soonest-resting key when every key is resting', () => {
    const pool = new ApiKeyPool(() => 0, 1000)
    pool.report('a', 500)
    pool.report('b', 100)
    expect(pool.next('REF', 'a,b')).toBe('b')
  })

  it('rests a refused key far longer than a throttled one, and never makes a request wait for it', () => {
    let now = 0
    const pool = new ApiKeyPool(() => now, 1000)
    pool.report('a', undefined, 'key')
    pool.report('b')
    expect(pool.readyInMs('a')).toBe(0)
    expect(pool.readyInMs('b')).toBe(1000)
    now = 1000
    // The throttled key is back; the refused one stays out for its 15 minutes.
    expect(Array.from({ length: 3 }, () => pool.next('REF', 'a,b'))).toEqual(['b', 'b', 'b'])
    now = 15 * 60_000
    expect(pool.next('REF', 'a,b')).toBe('a')
  })

  it('keeps the provider wait hint for a refused key and clears the refusal on a later throttle', () => {
    const pool = new ApiKeyPool(() => 0, 1000)
    pool.report('a', 5000, 'key')
    pool.report('b', undefined, 'key')
    expect(pool.next('REF', 'a,b')).toBe('a')
    pool.report('a', 2000)
    expect(pool.readyInMs('a')).toBe(2000)
  })

  it('counts distinct keys', () => {
    expect(ApiKeyPool.count('a,b,a')).toBe(2)
  })
})

describe('resting keys', () => {
  it('reports the remaining rest of a key and zero once it recovers', () => {
    let now = 0
    const pool = new ApiKeyPool(() => now, 1000)
    expect(pool.readyInMs('a')).toBe(0)
    pool.report('a')
    now = 400
    expect(pool.readyInMs('a')).toBe(600)
    now = 1000
    expect(pool.readyInMs('a')).toBe(0)
  })

  it('waits for a resting key and stops early on abort', async () => {
    const started = Date.now()
    await waitForKey(30)
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
    const controller = new AbortController()
    const waiting = waitForKey(60_000, controller.signal)
    controller.abort()
    await waiting
    await waitForKey(-5)
  })
})
