/** General Settings control for the standing instructions every agent follows. */
import { useMemo, useState } from 'react'
import { Button } from '@hackdevcode/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@hackdevcode/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@hackdevcode/dsh-client-ui-slots'
import { previewRules } from './custom-rules.ts'
import css from './CustomInstructionsRow.module.css'

/** Accepted text and its writer supplied by the settings owner. */
export interface CustomInstructionsRowInjected {
  hooks: { customInstructions: ObservableSnapshot<string> }
  /** Longest text the Host keeps. */
  limit: number
  /** Store the text; resolves false when the Host refused it. */
  save(text: string): Promise<boolean>
}

/**
 * Render the custom-instructions editor: the text, how many rules agents will see, an optional preview of those
 * numbered rules, and save and discard actions (ctrl+enter or cmd+enter also saves).
 * @param props - accepted text, writer, length limit and localized copy.
 * @returns the General Settings row.
 */
export function CustomInstructionsRow({ useCustomInstructions, save, limit, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<CustomInstructionsRowInjected>) {
  const accepted = useCustomInstructions(value => value)
  const [draft, setDraft] = useState<string | undefined>()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [previewing, setPreviewing] = useState(false)
  const text = draft ?? accepted
  const dirty = text !== accepted
  const tooLong = text.length > limit
  const rules = useMemo(() => previewRules(text), [text])
  const canSave = dirty && !tooLong && status !== 'saving'
  const submit = (): void => {
    setStatus('saving')
    void save(text.trim()).then((ok) => {
      setStatus(ok ? 'saved' : 'failed')
      if (ok) setDraft(undefined)
    }).catch(() => { setStatus('failed') })
  }
  return <div className={css.row}>
    <div className={css.title}>{t('customInstructions.title')}</div>
    <div className={css.description}>{t('customInstructions.description')}</div>
    <textarea
      className={css.input}
      aria-label={t('customInstructions.title')}
      placeholder={t('customInstructions.placeholder')}
      rows={7}
      value={text}
      disabled={status === 'saving'}
      onChange={(event) => { setDraft(event.target.value); setStatus('idle') }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSave) {
          event.preventDefault()
          submit()
        }
      }}
    />
    <div className={css.hint}>{t('customInstructions.hint')}</div>
    <div className={css.footer}>
      <span className={tooLong ? css.counterOver : css.counter}>{`${String(text.length)} / ${String(limit)}`}</span>
      <span className={css.counter}>{t(rules.length === 1 ? 'customInstructions.ruleCountOne' : 'customInstructions.ruleCount', { count: rules.length })}</span>
      {status === 'saved' && !dirty && <span role="status" className={css.counter}>{t('customInstructions.saved')}</span>}
      {status === 'failed' && <span role="alert" className={css.counterOver}>{t('customInstructions.error')}</span>}
      <span className={css.actions}>
        <Button variant="ghost" size="sm" disabled={rules.length === 0} aria-expanded={previewing}
          onClick={() => { setPreviewing(open => !open) }}>
          {t(previewing ? 'customInstructions.hidePreview' : 'customInstructions.preview')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!dirty || status === 'saving'} onClick={() => { setDraft(undefined); setStatus('idle') }}>
          {t('customInstructions.discard')}
        </Button>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={submit}>
          {t('customInstructions.save')}
        </Button>
      </span>
    </div>
    {previewing && rules.length > 0 && <ol className={css.preview} aria-label={t('customInstructions.previewLabel')}>
      {rules.map((rule, index) => <li key={`${String(index)}:${rule}`}>{rule}</li>)}
    </ol>}
  </div>
}
