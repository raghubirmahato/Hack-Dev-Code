// Mission-control additions to the new-session screen: the pipeline a mission
// runs through, and templates that start a draft in the composer.

import type { ConversationContentProps } from '../contract/slots.ts'
import css from './MissionHome.module.css'

/** The owner's locale seat type, passed as a plain prop. */
type MissionTranslate = ConversationContentProps['t']

const PIPELINE = ['council', 'forge', 'factcheck', 'gates', 'chronicle'] as const
const TEMPLATES = ['build', 'fix', 'review', 'resume'] as const

/**
 * The five stages every mission passes through, shown as an ordered strip.
 * @param props.t - locale seat.
 * @returns the pipeline list.
 */
export function MissionPipeline({ t }: { t: MissionTranslate }) {
  return (
    <ol className={css.pipeline} aria-label={t('mission.pipeline.label')} data-testid="mission-pipeline">
      {PIPELINE.map((stage, index) => (
        <li key={stage} className={css.stage}>
          <span className={css.stageIndex} aria-hidden="true">{index + 1}</span>
          <span className={css.stageText}>
            <span className={css.stageTitle}>{t(`mission.pipeline.${stage}.title`)}</span>
            <span className={css.stageCaption}>{t(`mission.pipeline.${stage}.caption`)}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Starter missions; choosing one writes its prompt into the composer draft.
 * @param props.t - locale seat.
 * @param props.onPick - receives the prompt text of the chosen template.
 * @returns the template grid.
 */
export function MissionTemplates({ t, onPick }: { t: MissionTranslate; onPick: (prompt: string) => void }) {
  return (
    <section className={css.templates} aria-label={t('mission.templates.title')} data-testid="mission-templates">
      <h2 className={css.templatesTitle}>{t('mission.templates.title')}</h2>
      <div className={css.grid}>
        {TEMPLATES.map(template => (
          <button
            key={template}
            type="button"
            className={css.card}
            onClick={() => { onPick(t(`mission.template.${template}.prompt`)) }}
          >
            <span className={css.cardTitle}>{t(`mission.template.${template}.title`)}</span>
            <span className={css.cardText}>{t(`mission.template.${template}.description`)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
