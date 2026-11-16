/**
 * Framework-free launch intro: a short animated title sequence drawn over the
 * whole window while the client boots underneath it. It is pure presentation —
 * the boot never waits for it — and the person can skip it with a click or any
 * key. Reduced-motion preferences get a brief, still version.
 * @module @hackdevcode/dsh-client-web/src/boot-intro
 */
import css from './boot-intro.module.css'

/** Full intro length in milliseconds, including the exit. */
export const INTRO_DURATION_MS = 4500

/** Intro length when the person prefers reduced motion. */
export const REDUCED_INTRO_DURATION_MS = 1200

/** Length of the closing curtain. */
const EXIT_MS = 700

/** The wordmark words; the last one takes the accent color. */
const WORDS = ['Hack', 'Dev', 'Code'] as const

/** The line under the wordmark. */
const TAGLINE = 'Plan \u00b7 Build \u00b7 Verify'

/** Number of drifting particles. */
const PARTICLES = 16

/** Number of blocks in the segmented progress bar. */
const SEGMENTS = 12

/** Number of ripple rings behind the mark. */
const RINGS = 3

/** The SVG namespace for the drawn mark. */
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Create an element with one module class. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | undefined, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className ?? ''
  if (text !== undefined) node.textContent = text
  return node
}

/** Create one SVG element with attributes. */
function svg(tag: string, attributes: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  return node
}

/**
 * The drawn mark: a hexagon outline and a code glyph whose strokes draw themselves in.
 * @returns the decorative svg.
 */
function mark(): SVGElement {
  const root = svg('svg', { viewBox: '0 0 96 96', width: '96', height: '96', 'aria-hidden': 'true', class: css.mark ?? '' })
  root.append(
    svg('path', {
      class: css.markRing ?? '',
      d: 'M48 6 L84 27 L84 69 L48 90 L12 69 L12 27 Z',
      fill: 'none', 'stroke-width': '4', 'stroke-linejoin': 'round', pathLength: '1',
    }),
    svg('path', {
      class: css.markCode ?? '',
      d: 'M38 36 L26 48 L38 60 M58 36 L70 48 L58 60 M52 32 L44 64',
      fill: 'none', 'stroke-width': '4.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: '1',
    }),
  )
  return root
}

/** Plays the launch intro once over the document body, then removes itself. */
export class BootIntro {
  private readonly root: HTMLDivElement
  private readonly timers: ReturnType<typeof setTimeout>[] = []
  private readonly skip = (): void => { this.finish() }
  private closing = false

  /**
   * Draw the intro and schedule its exit.
   * @param host - element the full-window layer attaches to, normally `document.body`.
   * @param reducedMotion - whether the person asked for reduced motion; defaults to the media query.
   */
  constructor(host: HTMLElement, reducedMotion = BootIntro.prefersReducedMotion()) {
    const duration = reducedMotion ? REDUCED_INTRO_DURATION_MS : INTRO_DURATION_MS
    this.root = el('div', `${css.intro ?? ''} ${reducedMotion ? css.still ?? '' : ''}`.trim())
    this.root.dataset.dshBootIntro = ''
    // Decorative motion: the boot page underneath carries the accessible loading state.
    this.root.setAttribute('aria-hidden', 'true')
    this.root.style.setProperty('--dsh-intro-duration', `${String(duration)}ms`)

    // The two curtain halves the exit slides away.
    const top = el('div', `${css.curtain ?? ''} ${css.curtainTop ?? ''}`)
    const bottom = el('div', `${css.curtain ?? ''} ${css.curtainBottom ?? ''}`)

    const particles = el('div', css.particles)
    for (let index = 0; index < PARTICLES; index++) {
      const particle = el('span', css.particle)
      // Spread the particles evenly with a little jitter so they never line up.
      particle.style.setProperty('--x', `${String(Math.round(((index + 0.5) / PARTICLES) * 100))}%`)
      particle.style.setProperty('--delay', `${String((index * 137) % 1600)}ms`)
      particle.style.setProperty('--size', `${String(2 + (index % 3))}px`)
      particles.append(particle)
    }

    const stage = el('div', css.stage)
    for (let index = 0; index < RINGS; index++) {
      const ring = el('span', css.ripple)
      ring.style.setProperty('--ring', String(index))
      stage.append(ring)
    }
    const orbit = el('div', css.orbit)
    orbit.append(el('span', css.orbiter), el('span', `${css.orbiter ?? ''} ${css.orbiterB ?? ''}`))
    stage.append(orbit, mark())

    const word = el('div', css.wordmark)
    let letterIndex = 0
    WORDS.forEach((text, wordIndex) => {
      const group = el('span', wordIndex === WORDS.length - 1 ? `${css.word ?? ''} ${css.wordAccent ?? ''}` : css.word)
      for (const letter of text) {
        const span = el('span', css.letter, letter)
        span.style.setProperty('--i', String(letterIndex++))
        group.append(span)
      }
      word.append(group)
    })

    const tagline = el('div', css.tagline, TAGLINE)
    const progress = el('div', css.progress)
    for (let index = 0; index < SEGMENTS; index++) {
      const segment = el('span', css.segment)
      segment.style.setProperty('--s', String(index))
      progress.append(segment)
    }

    const center = el('div', css.center)
    center.append(stage, word, tagline, progress)
    top.append(particles)
    this.root.append(top, bottom, center)
    host.append(this.root)

    this.timers.push(setTimeout(() => { this.finish() }, duration - EXIT_MS))
    this.root.addEventListener('pointerdown', this.skip)
    host.ownerDocument.addEventListener('keydown', this.skip, true)
  }

  /** Whether the person asked the system for reduced motion. */
  static prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /** Whether the intro is still on screen (playing or leaving). */
  get visible(): boolean {
    return this.root.isConnected
  }

  /** Start the exit now, then remove the layer; a second call is a no-op. */
  finish(): void {
    if (this.closing) return
    this.closing = true
    this.detachSkip()
    this.root.dataset.dshBootIntroClosing = ''
    this.timers.push(setTimeout(() => { this.dispose() }, EXIT_MS))
  }

  /** Remove the layer at once, without the exit. */
  dispose(): void {
    this.closing = true
    this.detachSkip()
    for (const timer of this.timers.splice(0)) clearTimeout(timer)
    this.root.remove()
  }

  /** Stop listening for the skip gestures. */
  private detachSkip(): void {
    this.root.removeEventListener('pointerdown', this.skip)
    this.root.ownerDocument.removeEventListener('keydown', this.skip, true)
  }
}
