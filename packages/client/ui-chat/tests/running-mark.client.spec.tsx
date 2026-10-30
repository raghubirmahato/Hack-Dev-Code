// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RunningMark } from '../src/client/chat/RunningMark.tsx'

afterEach(cleanup)

describe('RunningMark', () => {
  it('renders a decorative CSS-only mark without inline styles, images, or SVG', () => {
    const view = render(<RunningMark />)
    const icon = view.container.firstElementChild!
    expect(icon.tagName).toBe('SPAN')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.children).toHaveLength(1)
    const mark = icon.firstElementChild!
    expect(mark.tagName).toBe('SPAN')
    expect(mark.childElementCount).toBe(0)
    expect(view.container.querySelector('svg, img, animate')).toBeNull()
    expect(view.container.querySelector('[style]')).toBeNull()
  })
})
