import { describe, expect, it } from 'vitest'
import { ApiKeyPool, splitApiKeys } from '../src/key-pool.ts'

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

  it('counts distinct keys', () => {
    expect(ApiKeyPool.count('a,b,a')).toBe(2)
  })
})
