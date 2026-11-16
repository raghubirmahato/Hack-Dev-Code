/**
 * Write-only credential inputs, one row per key, with the same reveal behavior as masked conversation text. Saved
 * keys are listed one per row as protected masks that can only be removed; new keys are typed in rows below them
 * and join the saved ones, so a key is added to the rotation without typing the others again.
 */
import { useState } from 'react'
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

const EYE_CONTOUR = 'M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8Z'
const EYE_PATH = `${EYE_CONTOUR}M10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z`
const EYE_OFF_PATH = `${EYE_CONTOUR}M2.5 2.5L13.5 13.5`
const CROSS_PATH = 'M4 4L12 12M12 4L4 12'

/** One saved key as the Host previews it. */
export interface SavedKeyEntry {
  /** Position of the key in the stored value, which a removal names. */
  readonly index: number
  /** Server-made mask; the key itself never reaches the page. */
  readonly masked: string
}

/** Input attributes and section copy for the current credential draft. */
interface ApiKeyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'type' | 'className' | 'autoComplete'> {
  /** Unsaved new keys, separated by commas; stored credentials are never read into this field. */
  readonly value: string
  /** The saved keys still kept, and how to stage removing one; the full stored credential stays on the Host. */
  readonly saved?: {
    readonly entries: readonly SavedKeyEntry[]
    /** Stage removing one saved key; absent when the store cannot be written. */
    readonly remove?: (index: number) => void
  }
  /** Section copy, including the same reveal labels as SecretText. */
  readonly t: (key: keyof typeof en) => string
}

/** Split the draft into rows, keeping empty rows the person added and has not filled yet. */
function rowsOf(value: string): string[] {
  return value.length === 0 ? [''] : value.split(/[,;]/)
}

/** Report a new draft through the input's change handler. */
function changed(props: ApiKeyInputProps, next: string): void {
  props.onChange?.({ target: { value: next } } as ChangeEvent<HTMLInputElement>)
}

/** The small cross shared by every remove button. */
function CrossIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
      <path d={CROSS_PATH} />
    </svg>
  )
}

/**
 * Saved keys first, then one row per new key: requests rotate through every key, and a key the provider refuses is
 * skipped. A nonempty new row can be revealed; a changed value starts masked, as in SecretText.
 * @param props - current draft, saved key previews, input attributes for the first new row, and translated labels.
 * @returns the saved rows, the new key rows, an add button and the pool summary.
 */
export function ApiKeyInput(props: ApiKeyInputProps): ReactNode {
  const { value, t, saved, ...inputProps } = props
  const [revealed, setRevealed] = useState<{ row: number; value: string } | undefined>()
  const rows = rowsOf(value)
  const savedCount = saved?.entries.length ?? 0
  const keyCount = savedCount + rows.filter(row => row.trim().length > 0).length
  const write = (next: string[]): void => {
    setRevealed(undefined)
    changed(props, next.join(','))
  }
  return (
    <>
      <div className={styles['keyRows']}>
        {saved?.entries.map(({ index, masked }, position) => {
          const label = String(position + 1)
          return (
            <div key={`saved-${String(index)}`} className={styles['keyRow']}>
              <div className={styles['keyInput']}>
                <input
                  className={`${styles['input']} ${styles['savedKey']}`}
                  type="text"
                  readOnly
                  value={masked}
                  aria-label={t('keySavedRowLabel').replace('{n}', label)}
                  // The stored key never leaves the Host: its mask cannot be copied, and Backspace or Delete removes it.
                  onCopy={(event) => { event.preventDefault() }}
                  onCut={(event) => { event.preventDefault() }}
                  onKeyDown={(event) => {
                    if (saved.remove === undefined || inputProps.disabled === true) return
                    if (event.key !== 'Backspace' && event.key !== 'Delete') return
                    event.preventDefault()
                    saved.remove(index)
                  }}
                />
              </div>
              {saved.remove === undefined ? null : <button
                type="button"
                className={styles['keyRemove']}
                aria-label={t('keySavedRemove').replace('{n}', label)}
                disabled={inputProps.disabled}
                onClick={() => { saved.remove?.(index) }}
              >
                <CrossIcon />
              </button>}
            </div>
          )
        })}
        {rows.map((row, index) => {
          const canReveal = row.length > 0 && inputProps.disabled !== true
          const shown = canReveal && revealed?.row === index && revealed.value === row
          return (
            <div key={index} className={styles['keyRow']}>
              <div className={styles['keyInput']}>
                <input
                  {...index === 0 ? inputProps : { disabled: inputProps.disabled, 'aria-label': t('keyRowLabel').replace('{n}', String(savedCount + index + 1)) }}
                  className={`${styles['input']} ${canReveal ? styles['keyInputFilled'] : ''}`}
                  type={shown ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={row}
                  placeholder={index === 0 ? inputProps.placeholder : undefined}
                  onPaste={(event) => {
                    // Pasted lines are separate keys: each becomes its own row.
                    const text = event.clipboardData.getData('text')
                    if (!/[\r\n,;]/.test(text)) return
                    event.preventDefault()
                    const pasted = text.trim().split(/\s*[\r\n,;]+\s*/).filter(part => part.length > 0)
                    const input = event.currentTarget
                    /* v8 ignore start -- text and password inputs always report a selection; the fallback appends */
                    const before = row.slice(0, input.selectionStart ?? row.length)
                    const after = row.slice(input.selectionEnd ?? row.length)
                    /* v8 ignore stop */
                    // Keys hold no line breaks, so a line break joins and splits the pieces safely.
                    const merged = `${before}${pasted.join('\n')}${after}`.split('\n')
                    write([...rows.slice(0, index), ...merged, ...rows.slice(index + 1)])
                  }}
                  onChange={(event) => {
                    write(rows.map((existing, at) => at === index ? event.target.value.replace(/[,;]/g, '') : existing))
                  }}
                />
                {!canReveal ? null : <button
                  type="button"
                  className={styles['keyToggle']}
                  aria-label={t(shown ? 'keyHide' : 'keyReveal')}
                  aria-pressed={shown}
                  onClick={() => { setRevealed(shown ? undefined : { row: index, value: row }) }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" aria-hidden="true">
                    <path d={shown ? EYE_OFF_PATH : EYE_PATH} />
                  </svg>
                </button>}
              </div>
              {rows.length === 1 ? null : <button
                type="button"
                className={styles['keyRemove']}
                aria-label={t('keyRemove').replace('{n}', String(savedCount + index + 1))}
                disabled={inputProps.disabled}
                onClick={() => { write(rows.filter((_, at) => at !== index)) }}
              >
                <CrossIcon />
              </button>}
            </div>
          )
        })}
      </div>
      {inputProps.disabled === true ? null : <div className={styles['keyFooter']}>
        <button
          type="button"
          className={styles['keyAdd']}
          disabled={/(?:^|[,;])\s*$/u.test(value)}
          onClick={() => { write([...rows, '']) }}
        >
          {t('keyAdd')}
        </button>
        {keyCount > 1 && <p className={styles['keyCount']} role="status">{t('keyPoolCount').replace('{count}', String(keyCount))}</p>}
      </div>}
    </>
  )
}
