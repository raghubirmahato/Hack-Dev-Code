// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DropOverlay } from '../src/DropOverlay.tsx'

afterEach(cleanup)

describe('DropOverlay', () => {
  it('portals the invitation with its title and limits desc to the body', () => {
    const view = render(
      <DropOverlay disabled={false} labels={{ title: 'Drag files or images here to add them', desc: 'Image limit: up to 20 images, 5MB each' }} />,
    )
    const overlay = view.getByRole('status')
    expect(overlay.parentElement).toBe(document.body)
    expect(overlay.textContent).toContain('Drag files or images here to add them')
    expect(overlay.textContent).toContain('Image limit: up to 20 images, 5MB each')
  })

  it('omits the desc line when none is resolved', () => {
    const view = render(<DropOverlay disabled={false} labels={{ title: 'Drag files or images here to add them' }} />)
    expect(view.getByRole('status').textContent).toBe('Drag files or images here to add them')
  })

  it('drops the desc and switches the illustration while disabled', () => {
    const enabled = render(
      <DropOverlay disabled={false} labels={{ title: 'Drop files here', desc: 'Limit' }} />,
    )
    const enabledSvg = enabled.getByRole('status').querySelector('svg')!.innerHTML
    enabled.unmount()
    const disabled = render(
      <DropOverlay disabled labels={{ title: 'Cannot add images', desc: 'Limit' }} />,
    )
    const overlay = disabled.getByRole('status')
    expect(overlay.textContent).toBe('Cannot add images')
    expect(overlay.querySelector('svg')!.innerHTML).not.toBe(enabledSvg)
  })
})
