// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { ToolsSection, type ToolsSectionProps } from '../src/client/ToolsSection.tsx'

afterEach(cleanup)

const t = ((key: keyof typeof en) => en[key]) as never

function mount(tools: { id: string; label: string }[]) {
  const close = vi.fn()
  const openTool = vi.fn()
  const props = { t, close, listTools: () => tools, openTool } as unknown as ToolsSectionProps
  render(<ToolsSection {...props} />)
  return { close, openTool }
}

describe('ToolsSection', () => {
  it('lists the registered pages and says there is nothing under More when there are two', () => {
    mount([{ id: 'plugins', label: 'Plugins' }, { id: 'schedule', label: 'Automation tasks' }])
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['PluginsOpen', 'Automation tasksOpen'])
    expect(screen.getByText('No other tools are installed.')).toBeTruthy()
  })

  it('lists pages beyond the first two under More', () => {
    mount([
      { id: 'plugins', label: 'Plugins' }, { id: 'schedule', label: 'Automation tasks' }, { id: 'extra', label: 'Extra tool' },
    ])
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByText('No other tools are installed.')).toBeNull()
  })

  it('closes Settings and opens the chosen page', () => {
    const { close, openTool } = mount([{ id: 'plugins', label: 'Plugins' }, { id: 'schedule', label: 'Automation tasks' }])
    fireEvent.click(screen.getByRole('button', { name: /Automation tasks/u }))
    expect(close).toHaveBeenCalledOnce()
    expect(openTool).toHaveBeenCalledExactlyOnceWith('schedule')
  })
})
