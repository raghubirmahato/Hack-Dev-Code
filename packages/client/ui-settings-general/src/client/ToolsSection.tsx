/** The Tools section: opens the workspace pages that used to be listed in the sidebar. */
import type { PropsLocale, PropsRuntime } from '@hackdevcode/dsh-client-ui-slots'
import css from './ToolsSection.module.css'

/** One workspace page offered by a feature (Plugins, Automation tasks, ...). */
export interface ToolEntry {
  /** Panel id passed back to {@link ToolsSectionInjected.openTool}. */
  id: string
  /** Localized label. */
  label: string
}

/** Injected share of the Tools section. */
export interface ToolsSectionInjected {
  /** Registered workspace pages, in display order. */
  listTools: () => readonly ToolEntry[]
  /** Switch the main area to a workspace page. */
  openTool: (id: string) => void
}

/** Full component props: section owner share, localized copy and the injected share. */
export type ToolsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings'> & ToolsSectionInjected

/** Number of pages shown as primary rows; the rest are listed under More. */
const PRIMARY_TOOLS = 2

/**
 * Render the Tools section: primary pages first, then any additional pages under More.
 * Opening a page closes Settings so the page is visible.
 * @param props - section props.
 * @returns the section element tree.
 */
export function ToolsSection({ t, close, listTools, openTool }: ToolsSectionProps) {
  const tools = listTools()
  const open = (id: string): void => {
    close()
    openTool(id)
  }
  return (
    <div className={css.section}>
      <p className={css.intro}>{t('tools.description')}</p>
      <ul className={css.list}>
        {tools.slice(0, PRIMARY_TOOLS).map(tool => (
          <li key={tool.id}>
            <button type="button" className={css.row} onClick={() => { open(tool.id) }}>
              <span className={css.rowLabel}>{tool.label}</span>
              <span className={css.rowAction}>{t('tools.open')}</span>
            </button>
          </li>
        ))}
      </ul>
      <h3 className={css.moreTitle}>{t('tools.more.title')}</h3>
      {tools.length <= PRIMARY_TOOLS
        ? <p className={css.empty}>{t('tools.more.empty')}</p>
        : (
          <ul className={css.list}>
            {tools.slice(PRIMARY_TOOLS).map(tool => (
              <li key={tool.id}>
                <button type="button" className={css.row} onClick={() => { open(tool.id) }}>
                  <span className={css.rowLabel}>{tool.label}</span>
                  <span className={css.rowAction}>{t('tools.open')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
