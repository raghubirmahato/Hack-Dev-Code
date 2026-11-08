/**
 * The card that adds local models served by Ollama. It asks the Ollama server (through the Host, the same model
 * listing the custom card uses) which models are downloaded, shows them all checked, and creates one provider
 * route with the chosen ones over Ollama's OpenAI-compatible endpoint. Ollama ignores the API key, but the client
 * refuses to send a request without one, so the route stores a placeholder key.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { JsonValue } from '@hackdevcode/dsh-util-values'
import type { LlmDiscoveredModel } from '@hackdevcode/dsh-api-remotes/client'
import { EditorFooter } from './EditorFooter.tsx'
import { deriveKeyRef } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace the route is written into. */
const NS = 'llm-pi-ai'

/** Where Ollama listens unless it was started elsewhere. */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1'

/** Placeholder key: Ollama accepts any. */
const OLLAMA_KEY = 'ollama'

/** Props of {@link OllamaProviderCard}. */
export interface OllamaProviderCardProps {
  /** Route ids already declared, so the card picks a free one. */
  taken: readonly string[]
  /** Revision of the `llm-pi-ai` section this card opened at. */
  revision: number
  /** Host operations. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes. */
  readOnly: boolean
  /** Close the card; `changed` reports whether a provider was created. */
  onClose: (changed: boolean) => void
  /** Called with whether the listing or the create is in flight. */
  onBusyChange?: (busy: boolean) => void
}

/**
 * A free route id for Ollama: `ollama`, else `ollama-2`, `ollama-3`, ...
 * @param taken - route ids in use.
 * @returns the id.
 */
export function ollamaRoute(taken: readonly string[]): string {
  let id = 'ollama'
  for (let n = 2; taken.includes(id); n++) id = `ollama-${String(n)}`
  return id
}

/**
 * Render the Ollama card.
 * @param props - existing routes, Host operations and copy.
 * @returns the card.
 */
export function OllamaProviderCard(props: OllamaProviderCardProps): ReactNode {
  const { taken, operations, t, onBusyChange } = props
  const [openedAt] = useState(() => props.revision)
  const [baseURL, setBaseURL] = useState(OLLAMA_BASE_URL)
  const [models, setModels] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  // The address the shown models came from; the route is created for it, not for an edited, unlisted address.
  const [listedURL, setListedURL] = useState(OLLAMA_BASE_URL)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [listing, setListing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  useEffect(() => { onBusyChange?.(listing || creating) }, [listing, creating, onBusyChange])

  const list = useCallback(async (address: string): Promise<void> => {
    setListing(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(NS, { baseURL: address.trim(), api: 'openai-completions', apiKey: OLLAMA_KEY })
      if (answer.kind === 'refused') {
        setModels(undefined)
        setFailure(t('ollamaUnreachable'))
        return
      }
      const unique = [...new Map(answer.models.map(model => [model.id, model])).values()]
      setModels(unique)
      setListedURL(address.trim())
      setPicked(new Set(unique.map(model => model.id)))
    } catch (error: unknown) {
      // A lost connection to the Host rejects instead of refusing; it reads the same to the person.
      setModels(undefined)
      setFailure(error instanceof Error && error.message.length > 0 ? error.message : t('ollamaUnreachable'))
    } finally {
      setListing(false)
    }
  }, [operations, t])

  // Ask once when the card opens; Refresh asks again.
  useEffect(() => { void list(OLLAMA_BASE_URL) }, [list])

  const create = async (): Promise<void> => {
    /* v8 ignore next -- the create button stays disabled until a listing has returned models */
    if (models === undefined) return
    setCreating(true)
    setFailure(undefined)
    try {
      const route = ollamaRoute(taken)
      const keyRef = deriveKeyRef(route)
      const chosen = models.filter(model => picked.has(model.id))
      const written = await operations.writeSettings(NS, [{
        op: 'set',
        path: ['providers', route],
        value: {
          displayName: route === 'ollama' ? 'Ollama' : `Ollama (${route})`,
          apiKeyEnv: keyRef,
          api: 'openai-completions',
          baseURL: listedURL,
          models: chosen.map(model => ({
            id: model.id,
            ...model.name === undefined ? {} : { name: model.name },
            ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
            ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
          })),
        } as JsonValue,
      }], openedAt)
      if (written.kind !== 'written') {
        setFailure(written.kind === 'conflict' ? t('conflict') : written.message)
        return
      }
      const stored = await operations.storeCredential(keyRef, OLLAMA_KEY)
      if (stored !== undefined) {
        setFailure(stored)
        return
      }
      props.onClose(true)
    } finally {
      setCreating(false)
    }
  }

  const toggle = (id: string): void => {
    setPicked((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const disabled = props.readOnly || creating
  return (
    <div className={styles['editor']}>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
        <input
          className={styles['input']}
          type="text"
          value={baseURL}
          aria-label={t('baseUrl')}
          disabled={disabled}
          onChange={(event) => {
            setBaseURL(event.target.value)
            // Models listed from another address would not match this one; list again first.
            setModels(undefined)
          }}
        />
      </div>
      <div className={styles['presetRow']}>
        <button type="button" className={styles['presetButton']} disabled={disabled || listing} onClick={() => { void list(baseURL) }}>
          {t(listing ? 'ollamaLoading' : 'ollamaRefresh')}
        </button>
      </div>
      {models !== undefined && models.length === 0 ? <p className={styles['advancedHint']}>{t('ollamaNone')}</p> : null}
      {models !== undefined && models.length > 0
        ? (
          <fieldset className={styles['ollamaModels']}>
            <legend className={styles['fieldLabel']}>{t('ollamaModels')}</legend>
            {models.map(model => (
              <label key={model.id} className={styles['ollamaModel']}>
                <input type="checkbox" checked={picked.has(model.id)} disabled={disabled} onChange={() => { toggle(model.id) }} />
                <span>{model.name ?? model.id}</span>
              </label>
            ))}
          </fieldset>
        )
        : null}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      <EditorFooter
        t={t}
        busy={creating}
        submitDisabled={disabled || listing || models === undefined || picked.size === 0}
        submitLabelKey="create"
        submitBusyLabelKey="creating"
        onCancel={() => { props.onClose(false) }}
        onSubmit={() => { void create() }}
      />
    </div>
  )
}
