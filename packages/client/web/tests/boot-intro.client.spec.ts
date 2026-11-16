// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BootIntro, INTRO_DURATION_MS, REDUCED_INTRO_DURATION_MS } from '../src/boot-intro.ts'

/** The exit length the intro uses for its curtain. */
const EXIT_MS = 700

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const layer = () => document.querySelector<HTMLElement>('[data-dsh-boot-intro]')

describe('BootIntro', () => {
  it('draws the wordmark letter by letter with its tagline in solid colors, hidden from assistive technology', () => {
    new BootIntro(document.body, false)
    const intro = layer()
    expect(intro?.getAttribute('aria-hidden')).toBe('true')
    expect(intro?.textContent).toContain('HackDevCode')
    expect(intro?.textContent).toContain('Plan \u00b7 Build \u00b7 Verify')
    expect(intro?.querySelectorAll('svg path')).toHaveLength(2)
    expect(intro?.querySelector('svg linearGradient')).toBeNull()
    expect(intro?.style.getPropertyValue('--dsh-intro-duration')).toBe(`${String(INTRO_DURATION_MS)}ms`)
  })

  it('plays its full length, opens its curtain and removes itself', () => {
    const intro = new BootIntro(document.body, false)
    vi.advanceTimersByTime(INTRO_DURATION_MS - EXIT_MS - 1)
    expect(layer()?.hasAttribute('data-dsh-boot-intro-closing')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(layer()?.hasAttribute('data-dsh-boot-intro-closing')).toBe(true)
    expect(intro.visible).toBe(true)
    vi.advanceTimersByTime(EXIT_MS)
    expect(layer()).toBeNull()
    expect(intro.visible).toBe(false)
  })

  it('is short and still when the person prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    expect(BootIntro.prefersReducedMotion()).toBe(true)
    new BootIntro(document.body)
    expect(layer()?.style.getPropertyValue('--dsh-intro-duration')).toBe(`${String(REDUCED_INTRO_DURATION_MS)}ms`)
    vi.advanceTimersByTime(REDUCED_INTRO_DURATION_MS)
    expect(layer()).toBeNull()
  })

  it('assumes full motion where the media query is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(BootIntro.prefersReducedMotion()).toBe(false)
  })

  it.each([
    ['a click', () => { layer()?.dispatchEvent(new Event('pointerdown')) }],
    ['any key', () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) }],
  ])('skips straight to the exit on %s', (_label, gesture) => {
    new BootIntro(document.body, false)
    gesture()
    expect(layer()?.hasAttribute('data-dsh-boot-intro-closing')).toBe(true)
    vi.advanceTimersByTime(EXIT_MS)
    expect(layer()).toBeNull()
  })

  it('finishes once and can be removed at once', () => {
    const intro = new BootIntro(document.body, false)
    intro.finish()
    intro.finish()
    intro.dispose()
    expect(layer()).toBeNull()
    // No timer left behind removes anything later.
    vi.advanceTimersByTime(INTRO_DURATION_MS)
    expect(intro.visible).toBe(false)
  })
})
