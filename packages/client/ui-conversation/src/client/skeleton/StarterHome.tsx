// Starter prompts on the new-session screen: each card writes the beginning of
// a request into the composer draft for the person to finish.

import type { ConversationContentProps } from '../contract/slots.ts'
import css from './StarterHome.module.css'

/** The owner's locale seat type, passed as a plain prop. */
type StarterTranslate = ConversationContentProps['t']

const TEMPLATES = ['build', 'fix', 'review', 'computer'] as const

/**
 * Starter prompts; choosing one writes its text into the composer draft.
 * @param props.t - locale seat.
 * @param props.onPick - receives the prompt text of the chosen template.
 * @returns the template grid.
 */
export function StarterTemplates({ t, onPick }: { t: StarterTranslate; onPick: (prompt: string) => void }) {
  return (
    <section className={css.templates} aria-label={t('starter.templates.title')} data-testid="starter-templates">
      <h2 className={css.templatesTitle}>{t('starter.templates.title')}</h2>
      <div className={css.grid}>
        {TEMPLATES.map(template => (
          <button
            key={template}
            type="button"
            className={css.card}
            onClick={() => { onPick(t(`starter.template.${template}.prompt`)) }}
          >
            <span className={css.cardTitle}>{t(`starter.template.${template}.title`)}</span>
            <span className={css.cardText}>{t(`starter.template.${template}.description`)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
