/** Profile entry id used by the Timeline settings form. */
export const TIMELINE_CONFIG_ID = 'timeline-experimental'
/** Reports and the sidebar never operate below minute resolution. */
export const MINUTE_MS = 60000
/** Maximum number of characters in one editable prompt. */
export const PROMPT_LIMIT = 32768
/** The settings defaults are also used while the client loads its configuration. */
export const defaultReportCadence = { intervalMs: 15 * MINUTE_MS, rollupFactors: [4, 4] } as const
/** Display window in milliseconds. Session logs retain their original records. */
export const HISTORY_MS = 7 * 24 * 60 * MINUTE_MS
/** Maximum active discussions in one Session. */
export const MAX_ANNOTATIONS = 512
/** Languages that Timeline can request from the model. */
export const outputLanguages = ['en', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const
/** Language options including the current app language. */
export const languages = ['ui', ...outputLanguages] as const
/** A fixed output language or the app preference. */
export type Language = (typeof languages)[number]
/** One language supported for Timeline model output. */
export type OutputLanguage = (typeof outputLanguages)[number]
/** Native names also identify the required language in model instructions. */
export const languageText: Record<OutputLanguage, { label: string; noActivity: string; priority: string }> = {
  en: {
    label: 'English',
    noActivity: 'No activity.',
    priority: 'Timeline priority changed',
  },
  'zh-CN': {
    label: '\u7b80\u4f53\u4e2d\u6587',
    noActivity: '\u65e0\u6d3b\u52a8\u3002',
    priority: '\u65f6\u95f4\u7ebf\u4f18\u5148\u7ea7\u5df2\u66f4\u6539',
  },
  ja: {
    label: '\u65e5\u672c\u8a9e',
    noActivity: '\u6d3b\u52d5\u306f\u3042\u308a\u307e\u305b\u3093\u3002',
    priority: '\u30bf\u30b9\u30af\u306e\u512a\u5148\u5ea6\u304c\u5909\u66f4\u3055\u308c\u307e\u3057\u305f',
  },
  es: {
    label: 'Español',
    noActivity: 'Sin actividad.',
    priority: 'Cambió la prioridad de las tareas',
  },
  fr: {
    label: 'Français',
    noActivity: 'Aucune activité.',
    priority: 'La priorité des tâches a changé',
  },
  de: {
    label: 'Deutsch',
    noActivity: 'Keine Aktivität.',
    priority: 'Aufgabenpriorität geändert',
  },
  ru: {
    label: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439',
    noActivity: '\u041d\u0435\u0442 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u0438.',
    priority: '\u041f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442 \u0437\u0430\u0434\u0430\u0447 \u0438\u0437\u043c\u0435\u043d\u0451\u043d',
  },
  pt: {
    label: 'Português (Brasil)',
    noActivity: 'Sem atividade.',
    priority: 'A prioridade das tarefas mudou',
  },
}
/** Supported counts of displayed decimal places. */
export const progressPrecisions = [0, 1, 2, 3] as const
/** Number of displayed decimal places. */
export type ProgressPrecision = (typeof progressPrecisions)[number]

/**
 * Resolve Harness language tags; unsupported language packs use English output.
 * @param locale - the active app locale or its client service.
 * @returns a supported model language, falling back to English.
 */
export function appLanguage(locale: string): OutputLanguage {
  const primary = locale.toLowerCase().split('-')[0]
  if (primary === 'zh') return 'zh-CN'
  return outputLanguages.find(language => language === primary) ?? 'en'
}

/**
 * Resolve the configured language against the app preference.
 * @param language - configured Timeline language.
 * @param uiLanguage - current app language when following the app.
 * @returns the resolved model output language.
 */
export function outputLanguage(language: Language, uiLanguage: OutputLanguage): OutputLanguage {
  return language === 'ui' ? uiLanguage : language
}

/**
 * Language applies only to saved task-tree content, not the agent's other work.
 * @param language - configured Timeline language.
 * @param uiLanguage - current app language when following the app.
 * @returns the language rule for task content only.
 */
export function taskLanguageInstruction(language: Language, uiLanguage: OutputLanguage = 'en'): string {
  return `For Timeline task-tree content only, write titles, descriptions, progress notes, results, and discussion replies in ${languageText[outputLanguage(language, uiLanguage)].label}. Follow the user's language instructions for all other work and conversation.`
}

/**
 * Fixed policy used only in independent report queries.
 * @param language - configured Timeline language.
 * @param uiLanguage - current app language when following the app.
 * @returns the language rule for report content.
 */
export function languageInstruction(language: Language, uiLanguage: OutputLanguage = 'en'): string {
  return `All titles, descriptions, user-facing texts must be written in ${languageText[outputLanguage(language, uiLanguage)].label}.`
}

/**
 * Round a timestamp down to a whole minute.
 * @param time - wall clock timestamp in milliseconds.
 * @returns the start time of the enclosing minute.
 */
export function minuteAt(time: number): number {
  return Math.floor(time / MINUTE_MS) * MINUTE_MS
}
