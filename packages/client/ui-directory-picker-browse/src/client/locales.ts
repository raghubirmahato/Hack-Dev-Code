/**
 * `directory-browser` namespace dictionary: the in-app Select Workspace
 * Directory dialog's copy. English is the key-set source of truth.
 */

import type { TranslateNS } from '@hackdevcode/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'directory-browser'

/** English dictionary (the key-set source of truth). */
export const en = {
  'browser.title': 'Select Workspace Directory',
  'browser.home': 'Home',
  'browser.newFolder': 'New folder',
  'browser.folderName': 'Folder name',
  'browser.createIn': 'New folder in "{name}"',
  'browser.untitledFolder': 'Untitled folder',
  'browser.create': 'Create',
  'browser.cancel': 'Cancel',
  'browser.open': 'Open',
  'browser.editPath': 'Edit path',
  'browser.loading': 'Loading…',
  'browser.truncated': 'Too many folders to list; only the beginning is shown.',
  'browser.showHidden': 'Show hidden files',
} satisfies Record<string, string>

/** Localized dialog copy keyed to this namespace. */
export type DirectoryBrowserTranslate = TranslateNS<typeof NS>

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The in-app directory-picker dialog's copy. */
    'directory-browser': keyof typeof en
  }
}
