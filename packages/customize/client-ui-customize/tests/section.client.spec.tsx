// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CustomizeSnapshot } from '@hackdevcode/dsh-api-remotes/client'
import { createSnapshotStore } from '@hackdevcode/dsh-client-store'
import { bindSnapshotSelector } from '@hackdevcode/dsh-client-test-runtime'
import { CustomizeSection } from '../src/client/CustomizeSection.tsx'
import type { CustomizeSectionProps } from '../src/client/CustomizeSection.tsx'
import { en, type CustomizeLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: CustomizeLocaleKey, params: Record<string, string> = {}) =>
  en[key].replace(/\{(\w+)\}/gu, (_match, name: string) => params[name] as string)

const SNAPSHOT: CustomizeSnapshot = {
  skills: [
    { id: 'review', title: 'Code review', description: 'Reviews a change.', license: 'MIT', state: 'no' },
    { id: 'docs', title: 'Doc writer', description: 'Writes docs.', license: 'Apache-2.0', state: 'directory' },
    { id: 'own', title: 'Own skill', description: 'Hand installed.', license: 'MIT', state: 'other' },
  ],
  connectors: [
    {
      id: 'tracker', title: 'Tracker', description: 'Issues.', homepage: 'https://tracker.example.com', url: 'https://tracker.example.com/mcp',
      custom: false, added: false, signedIn: false,
    },
    { id: 'wiki', title: 'Wiki', description: 'Pages.', homepage: '', url: 'https://wiki.example.com/mcp', custom: true, added: true, signedIn: false },
    { id: 'mail', title: 'Mail', description: 'Mail.', homepage: '', url: 'https://mail.example.com/mcp', custom: false, added: true, signedIn: true },
  ],
  servers: [
    {
      id: 'files', title: 'Files', description: 'Reads folders.', homepage: 'https://files.example.com', custom: false, enabled: false,
      note: 'Needs a folder.', requires: [], opensFolders: true, roots: ['C:/work'], command: 'npx -y files-server', url: '',
    },
    {
      id: 'search', title: 'Search', description: 'Web search.', homepage: '', custom: false, enabled: true, note: '',
      requires: [
        { name: 'SEARCH_KEY', description: 'search key', set: false },
        { name: 'SEARCH_REGION', description: 'region', set: false },
        { name: 'SEARCH_OLD', description: 'already stored', set: true },
      ],
      opensFolders: false, roots: [], command: 'npx -y search-server', url: '',
    },
    {
      id: 'mine', title: 'Mine', description: '', homepage: '', custom: true, enabled: true, note: '', requires: [],
      opensFolders: false, roots: [], command: '', url: 'https://mine.example.com/mcp',
    },
  ],
}

function mount(over: Partial<Record<'read' | 'connect', unknown>> = {}) {
  // `over` swaps a method wholesale; the returned face keeps the mock types.
  const revision = createSnapshotStore(0)
  const face = {
    t,
    read: vi.fn(async () => SNAPSHOT),
    setServer: vi.fn(async () => {}),
    saveCustom: vi.fn(async () => {}),
    removeCustom: vi.fn(async () => {}),
    connect: vi.fn(async (): Promise<string | undefined> => undefined),
    disconnect: vi.fn(async () => {}),
    installSkill: vi.fn(async () => {}),
    removeSkill: vi.fn(async () => {}),
    openLink: vi.fn(),
    useRevision: bindSnapshotSelector(revision),
  }
  render(<CustomizeSection {...{ ...face, ...over } as unknown as CustomizeSectionProps} />)
  return { face, revision }
}

const type = (label: string, value: string) => { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
const press = (name: string, index = 0) => { fireEvent.click(screen.getAllByRole('button', { name })[index]!) }
const open = async (tab: string) => {
  await screen.findByText('Code review')
  fireEvent.click(screen.getByRole('tab', { name: tab }))
}
const settled = (calls: number, read: { mock: { calls: unknown[] } }) => waitFor(() => { expect(read.mock.calls).toHaveLength(calls) })

describe('CustomizeSection', () => {
  it('shows a loading line, then the skills with what each one allows', async () => {
    const { face } = mount()
    expect(screen.getByText('Loading…')).toBeTruthy()
    await screen.findByText('Code review')
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('Installed')).toBeTruthy()
    expect(screen.getByText('Installed separately')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Install' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)

    press('Install')
    await settled(2, face.read)
    expect(face.installSkill).toHaveBeenCalledWith('review')
    press('Remove')
    await settled(3, face.read)
    expect(face.removeSkill).toHaveBeenCalledWith('docs')
  })

  it('reads again when the Host announces a change', async () => {
    const { face, revision } = mount()
    await settled(1, face.read)
    revision.set(1)
    await settled(2, face.read)
  })

  it('shows a failed read with a way to try again', async () => {
    const read = vi.fn(async () => SNAPSHOT).mockRejectedValueOnce(new Error('The Host is not reachable.'))
    mount({ read })
    expect((await screen.findByRole('alert')).textContent).toContain('The Host is not reachable.')
    expect(screen.queryByText('Loading…')).toBeNull()
    press('Try again')
    await screen.findByText('Code review')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a refused change and clears it on the next one', async () => {
    const { face } = mount()
    await screen.findByText('Code review')
    face.installSkill.mockRejectedValueOnce(new Error('The skill could not be installed.'))
    press('Install')
    expect((await screen.findByRole('alert')).textContent).toContain('The skill could not be installed.')
    press('Install')
    await settled(2, face.read)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('connects, signs in to and disconnects connectors', async () => {
    const connect = vi.fn(async (): Promise<string | undefined> => undefined)
      .mockResolvedValueOnce('https://tracker.example.com/authorize')
    const { face } = mount({ connect })
    await open('Connectors')
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('Sign-in needed')).toBeTruthy()

    press('Website')
    expect(face.openLink).toHaveBeenCalledWith('https://tracker.example.com')

    press('Connect')
    expect((await screen.findByRole('status')).textContent).toBe('Finish signing in to Tracker in the browser window that opened.')
    expect(connect).toHaveBeenCalledWith({ id: 'tracker' })
    expect(face.openLink).toHaveBeenCalledWith('https://tracker.example.com/authorize')

    // A connector that needs no browser step opens nothing and leaves no notice.
    press('Sign in')
    await settled(3, face.read)
    expect(connect).toHaveBeenLastCalledWith({ id: 'wiki' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(face.openLink).toHaveBeenCalledTimes(2)

    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2)
    press('Disconnect', 1)
    await settled(4, face.read)
    expect(face.disconnect).toHaveBeenCalledWith('mail')
  })

  it('adds a connector by address and refuses a name that makes no id', async () => {
    const { face } = mount()
    await open('Connectors')
    const add = screen.getByRole('button', { name: 'Add connector' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)

    type('Name', '9 lives')
    type('MCP address, such as https://example.com/mcp', 'https://lives.example.com/mcp')
    press('Add connector')
    expect((await screen.findByRole('alert')).textContent).toContain('Start the name with a letter')
    expect(face.connect).not.toHaveBeenCalled()

    type('Name', ' Team Board ')
    type('MCP address, such as https://example.com/mcp', ' https://board.example.com/mcp ')
    press('Add connector')
    await settled(2, face.read)
    expect(face.connect).toHaveBeenCalledWith({ id: 'team-board', url: 'https://board.example.com/mcp', title: 'Team Board' })
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('')
  })

  it('switches servers, stores their keys and folders, and removes your own', async () => {
    const { face } = mount()
    await open('MCP servers')
    expect(screen.getByText('Yours')).toBeTruthy()
    expect(screen.getByText('Needs a folder.')).toBeTruthy()
    expect(screen.getByText('npx -y files-server')).toBeTruthy()
    expect(screen.getByText('https://mine.example.com/mcp')).toBeTruthy()
    expect(screen.queryByLabelText('SEARCH_OLD')).toBeNull()

    press('Website')
    expect(face.openLink).toHaveBeenCalledWith('https://files.example.com')

    fireEvent.click(screen.getByRole('switch', { name: 'Use Files' }))
    await settled(2, face.read)
    expect(face.setServer).toHaveBeenCalledWith('files', { enabled: true })

    type('Folders it may open, separated by commas', 'C:/work, D:/notes')
    press('Save')
    await settled(3, face.read)
    expect(face.setServer).toHaveBeenLastCalledWith('files', { enabled: false, keys: {}, roots: ['C:/work', 'D:/notes'] })

    type('SEARCH_KEY', 'value-one')
    type('SEARCH_REGION', 'eu')
    type('SEARCH_REGION', '')
    press('Save', 1)
    await settled(4, face.read)
    expect(face.setServer).toHaveBeenLastCalledWith('search', { enabled: true, keys: { SEARCH_KEY: 'value-one' } })
    await waitFor(() => { expect(screen.getByLabelText<HTMLInputElement>('SEARCH_KEY').value).toBe('') })

    press('Remove')
    await settled(5, face.read)
    expect(face.removeCustom).toHaveBeenCalledWith('mine')
  })

  it('adds your own server and refuses a name that makes no id', async () => {
    const { face } = mount()
    await open('MCP servers')
    type('Name', '!!!')
    type('Command to start it, or its https address', 'npx -y notes-server')
    press('Add server')
    expect((await screen.findByRole('alert')).textContent).toContain('Start the name with a letter')
    expect(face.saveCustom).not.toHaveBeenCalled()

    type('Name', 'Notes')
    press('Add server')
    await settled(2, face.read)
    expect(face.saveCustom).toHaveBeenCalledWith('notes', { enabled: true, title: 'Notes', command: 'npx', args: ['-y', 'notes-server'] })
    expect(screen.getByLabelText<HTMLInputElement>('Command to start it, or its https address').value).toBe('')
  })
})
