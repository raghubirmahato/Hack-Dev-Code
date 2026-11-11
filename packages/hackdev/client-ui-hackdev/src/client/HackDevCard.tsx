import { memo, useMemo, useState, type ReactNode } from 'react'
import {
  DisclosureRow, IconShieldOutlineRegular, IconUsersOutlineRegular, StateDot, Tag,
  type StateDotState,
} from '@hackdevcode/dsh-client-ui-primitives'
import type { TagTone } from '@hackdevcode/dsh-client-ui-primitives'
import type { PropsLocale } from '@hackdevcode/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@hackdevcode/dsh-client-ui-tool/client'
import {
  attentionItems, headerCounts, missionFromArgs, readHackDevMeta,
  type AttentionItem, type CheckOutcome, type HackDevView, type IssueStatus, type Severity, type TaskStatus, type ViewGate,
  type ViewTask,
} from './model.ts'
import { NS } from './locales.ts'
import css from './HackDevCard.module.css'

/** Full props of the Hack Dev Code tool card. */
export type HackDevCardProps = ToolCallViewProps & PropsLocale<typeof NS>

type T = HackDevCardProps['t']

/** Attention items shown before the rest sit behind a toggle, so a long run stays scannable. */
export const ATTENTION_PREVIEW = 6

function taskDot(status: TaskStatus): StateDotState {
  switch (status) {
    case 'done': return 'done'
    case 'partial': return 'warning'
    case 'blocked':
    case 'failed': return 'error'
    case 'skipped': return 'idle'
  }
}

function checkDot(outcome: CheckOutcome): StateDotState {
  switch (outcome) {
    case 'pass': return 'done'
    case 'fail': return 'error'
    case 'skipped': return 'idle'
  }
}

function severityTone(severity: Severity): TagTone {
  switch (severity) {
    case 'critical':
    case 'high': return 'danger'
    case 'medium': return 'warning'
    case 'low': return 'neutral'
  }
}

function issueTone(status: IssueStatus, severity: Severity): TagTone {
  return status === 'fixed' ? 'success' : severityTone(severity)
}

function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

function attentionText(item: AttentionItem, t: T): string {
  switch (item.kind) {
    case 'task': return t('attention.task', { id: item.id, status: t(`taskStatus.${item.status}`), text: item.text })
    case 'criterion': return t('attention.criterion', { text: item.text })
    case 'open': return t('attention.open', { severity: t(`severity.${item.severity}`), text: item.text, gate: item.gate })
    case 'deferred': return t('attention.deferred', { severity: t(`severity.${item.severity}`), text: item.text, gate: item.gate })
    case 'human': return t('attention.human', { text: item.text })
  }
}

function GateSection({ gate, t }: { gate: ViewGate; t: T }) {
  const passed = gate.checks.filter(c => c.outcome === 'pass').length
  const detail = [
    t('gate.rounds', { count: gate.rounds }),
    gate.fixedIssues > 0 ? t('gate.fixed', { count: gate.fixedIssues }) : null,
    gate.checkCount > 0 ? t('gate.checks', { passed, count: gate.checks.length }) : null,
  ].filter((part): part is string => part !== null).join(' · ')
  // A passed gate needs only its headline; a failed one opens so the reason is visible.
  return (
    <details className={css.gate} open={gate.verdict === 'fail'} data-testid="hackdev-gate" data-verdict={gate.verdict}>
      <summary className={css.gateHead}>
        <StateDot state={gate.verdict === 'pass' ? 'done' : 'error'} />
        <span className={css.gateName}>{gate.gate}</span>
        <Tag tone={gate.verdict === 'pass' ? 'success' : 'danger'}>{t(`verdict.${gate.verdict}`)}</Tag>
        <span className={css.rowMeta}>{detail}</span>
      </summary>
      <div className={css.gateBody}>
        {gate.summary === '' ? null : <p className={css.gateSummary}>{gate.summary}</p>}
        {gate.checks.length === 0 ? null : (
          <ul className={css.checks}>
            {gate.checks.map((check, index) => (
              <li key={`${index}:${check.name}`} className={css.check} title={check.detail === '' ? undefined : check.detail}>
                <span className={css.rowDot}><StateDot state={checkDot(check.outcome)} size={8} /></span>
                <span className={css.checkName}>{check.name}</span>
                <span className={css.srOnly}>{t(`check.${check.outcome}`)}</span>
              </li>
            ))}
          </ul>
        )}
        {gate.issues.length === 0 ? null : (
          <ul className={css.list}>
            {gate.issues.map((issue, index) => (
              <li key={`${index}:${issue.title}`} className={css.row}>
                <Tag tone={issueTone(issue.status, issue.severity)}>{t(`issue.${issue.status}`)}</Tag>
                <span className={css.rowMain}>
                  <span className={css.rowTitle}>{issue.title}</span>
                  <span className={css.rowMeta}>{t(`severity.${issue.severity}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {gate.hasUi ? <span className={css.rowMeta}>{gate.uiVerified ? t('gate.uiVerified', { count: gate.screenshotCount }) : t('gate.uiNotVerified')}</span> : null}
        {gate.screenshots.length === 0 ? null : (
          <ul className={css.limitations} data-testid="hackdev-screenshots">
            {gate.screenshots.map((shot, index) => (
              <li key={`${index}:${shot.artifact}`}>
                <span className={css.mono}>{shot.viewport}</span> {shot.observation}
                <span className={css.srOnly}> ({shot.artifact})</span>
              </li>
            ))}
          </ul>
        )}
        {gate.limitations.length === 0 ? null : (
          <div>
            <span className={css.rowMeta}>{t('gate.limitations')}</span>
            <ul className={css.limitations}>
              {gate.limitations.map((text, index) => <li key={`${index}:${text}`}>{text}</li>)}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

function taskMeta(task: ViewTask, t: T): string {
  return [
    t(`taskStatus.${task.status}`),
    task.role === '' ? null : t('task.role', { role: task.role }),
    task.wave > 1 ? t('task.wave', { count: task.wave }) : null,
    task.verified === true ? t('task.verified') : task.verified === false ? t('task.unverified') : null,
    task.replaced ? t('task.replaced') : null,
    t('task.files', { count: task.files }),
    t('task.evidence', { count: task.evidenceCount }),
  ].filter((part): part is string => part !== null).join(' · ')
}

function Report({ view, t }: { view: HackDevView; t: T }) {
  const attention = useMemo(() => attentionItems(view), [view])
  const [showAll, setShowAll] = useState(false)
  const hidden = Math.max(0, attention.length - ATTENTION_PREVIEW)
  const visible = showAll ? attention : attention.slice(0, ATTENTION_PREVIEW)
  return (
    <>
      {attention.length === 0 ? null : (
        <section className={`${css.section} ${css.attention}`} data-testid="hackdev-attention">
          <h4 className={css.sectionTitle}>{t('attention')}</h4>
          <ul className={css.list}>
            {visible.map((item, index) => <li key={index} className={css.rowTitle}>{attentionText(item, t)}</li>)}
          </ul>
          {hidden === 0 ? null : (
            <button type="button" className={css.linkButton} aria-expanded={showAll} onClick={() => { setShowAll(open => !open) }}>
              {showAll ? t('attention.showFewer') : t('attention.showAll', { count: hidden })}
            </button>
          )}
        </section>
      )}
      {view.plan.summary === '' ? null : (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('plan')}</h4>
          <p className={css.gateSummary}>{view.plan.summary}</p>
          {view.plan.stack === '' ? null : <span className={css.rowMeta}>{t('stack')}: {view.plan.stack}</span>}
          {view.planFallback ? <span className={css.rowMeta}>{t('planFallback')}</span> : null}
          {view.waves > 1 ? <span className={css.rowMeta}>{t('waves', { count: view.waves })}</span> : null}
        </section>
      )}
      {view.criteria.length === 0 ? null : (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('criteria', { met: view.criteria.filter(c => c.met).length, count: view.criteriaCount })}</h4>
          <ul className={css.list} data-testid="hackdev-criteria">
            {view.criteria.map((criterion, index) => (
              <li key={`${index}:${criterion.criterion}`} className={css.row} data-met={criterion.met}>
                <span className={css.rowDot}><StateDot state={criterion.met ? 'done' : 'error'} /></span>
                <span className={css.rowMain}>
                  <span className={css.rowTitle}>{criterion.criterion}</span>
                  <span className={css.rowMeta}>{[t(criterion.met ? 'criterion.met' : 'criterion.unmet'), criterion.evidence].filter(part => part !== '').join(' · ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.tasks.length === 0 ? null : (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('tasks')}</h4>
          <ul className={css.list} data-testid="hackdev-tasks">
            {view.tasks.map(task => (
              <li key={task.id} className={css.row} data-status={task.status}>
                <span className={css.rowDot}><StateDot state={taskDot(task.status)} /></span>
                <span className={css.rowMain}>
                  <span className={css.rowTitle}>
                    <span className={css.mono}>{task.id}</span> {task.title}
                  </span>
                  <span className={css.rowMeta}>{taskMeta(task, t)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.gates.length === 0 ? null : (
        <section className={css.section}>
          <h4 className={css.sectionTitle}>{t('gates')}</h4>
          {view.gates.map(gate => <GateSection key={gate.gate} gate={gate} t={t} />)}
        </section>
      )}
      <span className={css.footer}>
        {t('footer.memory', { count: view.memoryEntries })} · {view.recorded ? t('footer.recorded') : t('footer.notRecorded')}
      </span>
    </>
  )
}

function statusTag(label: string, tone: TagTone): ReactNode {
  return <Tag tone={tone}>{label}</Tag>
}

/**
 * Render one Hack Dev Code tool call: a disclosure header with run status and
 * counts, and an expanded body of tasks, gate verdicts, issues and approvals
 * taken from the durable `presentationMeta`. Live phases and agents are shown
 * by the workflow-run node the same call records beside it.
 */
export const HackDevCard = memo(function HackDevCard(props: HackDevCardProps) {
  const { phase, block, toolName, useDisclosure, t } = props
  const { expanded, toggle } = useDisclosure()
  const isReview = toolName === 'hackdev_review'
  const icon = isReview ? <IconShieldOutlineRegular /> : <IconUsersOutlineRegular />
  const title = t(isReview ? 'title.review' : 'title.mission')

  const view = useMemo(() => phase === 'result' && !block.isError ? readHackDevMeta(block.meta) : null, [phase, block])

  if (phase !== 'result') {
    const mission = phase === 'start' ? missionFromArgs(block.argsRaw) : null
    return (
      <DisclosureRow
        icon={icon}
        title={title}
        open={expanded && phase === 'start'}
        expandable={phase === 'start'}
        onToggle={toggle}
        running
        expandOnRowClick
        headerAccessory={statusTag(t('status.running'), 'info')}
      >
        <div className={css.card} data-testid="hackdev-running">
          <p className={css.hint}>{t('running.hint')}</p>
          {mission === null ? null : <p className={css.fallback}>{mission}</p>}
        </div>
      </DisclosureRow>
    )
  }

  if (block.isError || view === null) {
    const text = textOf(block.content)
    return (
      <DisclosureRow
        icon={icon}
        title={title}
        open={expanded && text !== ''}
        expandable={text !== ''}
        onToggle={toggle}
        expandOnRowClick
        headerAccessory={block.isError ? statusTag(t('status.failed'), 'danger') : null}
      >
        <div className={css.card} data-testid="hackdev-fallback">
          <h4 className={css.sectionTitle}>{t('fallback.title')}</h4>
          <p className={css.fallback}>{text}</p>
        </div>
      </DisclosureRow>
    )
  }

  const counts = headerCounts(view)
  const summary = view.tasks.length === 0
    ? t('summary.gatesOnly', { gatesPassed: counts.gatesPassed, gates: counts.gates })
    : t('summary', { tasksDone: counts.tasksDone, tasks: counts.tasks, gatesPassed: counts.gatesPassed, gates: counts.gates })
  return (
    <DisclosureRow
      icon={icon}
      title={title}
      open={expanded}
      expandable
      onToggle={toggle}
      expandOnRowClick
      headerAccessory={(
        <span className={css.headline}>
          {view.status === 'complete' ? statusTag(t('status.complete'), 'success') : statusTag(t('status.needsAttention'), 'warning')}
          <span className={css.summaryText}>
            {summary}{counts.attention > 0 ? ` · ${t('summary.attention', { count: counts.attention })}` : ''}
          </span>
        </span>
      )}
    >
      <div className={css.card} data-testid="hackdev-report" data-status={view.status}>
        <Report view={view} t={t} />
      </div>
    </DisclosureRow>
  )
})
