// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { MissionTemplates } from '../src/client/skeleton/MissionHome.tsx'

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as never

describe('MissionTemplates', () => {
  it('offers the four starter missions as buttons', () => {
    render(<MissionTemplates t={t} onPick={vi.fn()} />)
    const buttons = within(screen.getByTestId('mission-templates')).getAllByRole('button')
    expect(buttons.map(button => button.querySelector('span')?.textContent)).toEqual([
      'Build an app', 'Fix a failing test', 'Review and harden', 'Resume last mission',
    ])
  })

  it('writes the chosen template prompt into the draft', () => {
    const onPick = vi.fn<(prompt: string) => void>()
    render(<MissionTemplates t={t} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /Review and harden/u }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('Use hackdev_review to review and harden this repository.')
    fireEvent.click(screen.getByRole('button', { name: /Build an app/u }))
    expect(onPick).toHaveBeenLastCalledWith('Use hackdev to build: ')
  })
})
