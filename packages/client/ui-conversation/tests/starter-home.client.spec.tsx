// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { StarterTemplates } from '../src/client/skeleton/StarterHome.tsx'

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as never

describe('StarterTemplates', () => {
  it('offers the four starter prompts as buttons', () => {
    render(<StarterTemplates t={t} onPick={vi.fn()} />)
    const buttons = within(screen.getByTestId('starter-templates')).getAllByRole('button')
    expect(buttons.map(button => button.querySelector('span')?.textContent)).toEqual([
      'Build an app', 'Fix a failing test', 'Review my changes', 'Do something on my computer',
    ])
  })

  it('writes the chosen template prompt into the draft', () => {
    const onPick = vi.fn<(prompt: string) => void>()
    render(<StarterTemplates t={t} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /Review my changes/u }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('Review the uncommitted changes in this workspace and list any bugs or risks.')
    fireEvent.click(screen.getByRole('button', { name: /Build an app/u }))
    expect(onPick).toHaveBeenLastCalledWith('Build: ')
  })
})
