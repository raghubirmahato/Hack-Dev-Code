// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OLLAMA_BASE_URL, OllamaProviderCard, ollamaRoute } from '../src/client/OllamaProviderCard.tsx'
import type { ModelsOperations, ModelDiscoveryOutcome } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** Props every render here shares. */
const base = { t: (key: keyof typeof en): string => en[key], readOnly: false, revision: 1, taken: [] as string[] }


function operations(answer: ModelDiscoveryOutcome) {
  const discoverModels = vi.fn(() => Promise.resolve(answer))
  const writeSettings = vi.fn(() => Promise.resolve({ kind: 'written' as const, revision: 2 }))
  const storeCredential = vi.fn(() => Promise.resolve(undefined))
  const ops = { discoverModels, writeSettings, storeCredential, removeCredential: vi.fn() } as unknown as ModelsOperations
  return { ops, discoverModels, writeSettings, storeCredential }
}

describe('the Ollama card', () => {
  it('lists the downloaded models, all checked, and adds the chosen ones as a local provider', async () => {
    const { ops, discoverModels, writeSettings, storeCredential } = operations({
      kind: 'found', models: [{ id: 'qwen2.5-coder:7b' }, { id: 'llama3.2:3b' }, { id: 'qwen2.5-coder:7b' }],
    })
    const onClose = vi.fn()
    render(<OllamaProviderCard {...base} taken={['ollama']} revision={4} operations={ops} onClose={onClose} />)
    await screen.findByText(en.ollamaModels)
    expect(discoverModels).toHaveBeenCalledWith('llm-pi-ai', { baseURL: OLLAMA_BASE_URL, api: 'openai-completions', apiKey: 'ollama' })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('llama3.2:3b'))
    fireEvent.click(screen.getByText(en.create))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writeSettings).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set', path: ['providers', 'ollama-2'],
      value: { displayName: 'Ollama (ollama-2)', apiKeyEnv: 'OLLAMA_2_API_KEY', api: 'openai-completions', baseURL: OLLAMA_BASE_URL, models: [{ id: 'qwen2.5-coder:7b', contextWindow: 32768 }] },
    }], 4)
    expect(storeCredential).toHaveBeenCalledWith('OLLAMA_2_API_KEY', 'ollama')
  })

  it('says how to start Ollama when it does not answer, and how to download a model when it has none', async () => {
    const unreachable = operations({ kind: 'refused', message: 'connect ECONNREFUSED' })
    const { unmount } = render(<OllamaProviderCard {...base} operations={unreachable.ops} onClose={vi.fn()} />)
    expect(await screen.findByText(en.ollamaUnreachable)).toBeTruthy()
    expect(screen.getByText(en.create).closest('button')?.disabled).toBe(true)
    unmount()
    const empty = operations({ kind: 'found', models: [] })
    render(<OllamaProviderCard {...base} operations={empty.ops} onClose={vi.fn()} />)
    expect(await screen.findByText(en.ollamaNone)).toBeTruthy()
  })

  it('asks a changed address again on refresh', async () => {
    const { ops, discoverModels } = operations({ kind: 'found', models: [{ id: 'phi3' }] })
    const busy: boolean[] = []
    render(<OllamaProviderCard {...base} operations={ops} onClose={vi.fn()} onBusyChange={(value) => { busy.push(value) }} />)
    await screen.findByText(en.ollamaModels)
    // The listing holds the surrounding card still while it runs.
    expect(busy).toContain(true)
    expect(busy.at(-1)).toBe(false)
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'http://192.168.1.20:11434/v1' } })
    fireEvent.click(screen.getByText(en.ollamaRefresh))
    await waitFor(() => { expect(discoverModels).toHaveBeenLastCalledWith('llm-pi-ai', expect.objectContaining({ baseURL: 'http://192.168.1.20:11434/v1' })) })
  })

  it('reports a settings conflict and a key that could not be stored, and keeps the card open', async () => {
    const conflict = operations({ kind: 'found', models: [{ id: 'phi3', name: 'Phi 3', contextWindow: 4096, maxTokens: 1024 }] })
    conflict.writeSettings.mockResolvedValueOnce({ kind: 'conflict' } as never)
    const onClose = vi.fn()
    const { unmount } = render(<OllamaProviderCard {...base} operations={conflict.ops} onClose={onClose} />)
    // A model the person unchecks and checks again is still added.
    fireEvent.click(await screen.findByLabelText('Phi 3'))
    fireEvent.click(screen.getByLabelText('Phi 3'))
    fireEvent.click(screen.getByText(en.create))
    expect(await screen.findByText(en.conflict)).toBeTruthy()
    conflict.writeSettings.mockResolvedValueOnce({ kind: 'failed', message: 'disk is full' } as never)
    fireEvent.click(screen.getByText(en.create))
    expect(await screen.findByText('disk is full')).toBeTruthy()
    conflict.storeCredential.mockResolvedValueOnce('keychain locked' as never)
    fireEvent.click(screen.getByText(en.create))
    expect(await screen.findByText('keychain locked')).toBeTruthy()
    const lastWrite = JSON.stringify(conflict.writeSettings.mock.calls.at(-1))
    expect(lastWrite).toContain('"displayName":"Ollama"')
    expect(lastWrite).toContain('{"id":"phi3","name":"Phi 3","contextWindow":4096,"maxTokens":1024}')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(en.cancel))
    expect(onClose).toHaveBeenCalledWith(false)
    unmount()
  })

  it('shows a lost connection, and never creates a route for an address it did not list', async () => {
    const lost = operations({ kind: 'found', models: [] })
    lost.discoverModels.mockRejectedValueOnce(new Error('connection closed'))
    const { unmount } = render(<OllamaProviderCard {...base} operations={lost.ops} onClose={vi.fn()} />)
    expect(await screen.findByText('connection closed')).toBeTruthy()
    unmount()
    const silent = operations({ kind: 'found', models: [] })
    silent.discoverModels.mockRejectedValueOnce('no message')
    const second = render(<OllamaProviderCard {...base} operations={silent.ops} onClose={vi.fn()} />)
    expect(await screen.findByText(en.ollamaUnreachable)).toBeTruthy()
    second.unmount()
    const listed = operations({ kind: 'found', models: [{ id: 'phi3' }] })
    render(<OllamaProviderCard {...base} operations={listed.ops} onClose={vi.fn()} />)
    await screen.findByText(en.ollamaModels)
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'http://10.0.0.5:11434/v1' } })
    // The list is gone until the new address is listed, so nothing can be created for it yet.
    expect(screen.queryByText(en.ollamaModels)).toBeNull()
    expect(screen.getByText(en.create).closest('button')?.disabled).toBe(true)
    fireEvent.click(screen.getByText(en.ollamaRefresh))
    await screen.findByText(en.ollamaModels)
    fireEvent.click(screen.getByText(en.create))
    await waitFor(() => { expect(JSON.stringify(listed.writeSettings.mock.calls[0])).toContain('http://10.0.0.5:11434/v1') })
  })

  it('picks a free route id', () => {
    expect(ollamaRoute([])).toBe('ollama')
    expect(ollamaRoute(['ollama', 'ollama-2'])).toBe('ollama-3')
  })
})
