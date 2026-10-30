/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'

/** English Session export strings and key source. */
export const en = {
  'header.more': 'More actions',
  'menu.copyMarkdown': 'Copy Session as Markdown',
  'menu.download': 'Download session log',
  'menu.feedback': 'Feedback',
  'toast.copied': 'Session copied as Markdown.',
  'toast.preparationFailed': 'Could not read the Session for copying. Try again.',
  'toast.clipboardFailed': 'Could not write to the clipboard. Check clipboard permission and try again.',
  'dialog.preparingTitle': 'Exporting Session',
  'dialog.preparingDescription': 'Preparing a ZIP containing this Session, its sub-Sessions, and attachments.',
  'dialog.successTitle': 'Session download started',
  'dialog.successDescription': 'The browser is downloading the Session ZIP.',
  'dialog.errorTitle': 'Session export failed',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the Session export.',
} satisfies Record<string, string>

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof en
