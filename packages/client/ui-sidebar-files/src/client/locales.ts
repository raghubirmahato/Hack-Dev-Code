/**
 * `sidebarFiles` namespace dictionaries, and the namespace's declaration.
 *
 * The failure lines name what the tree could not list, one code each, because a
 * directory that is gone, one outside the workspace, and a path that is not a
 * directory each suggest a different next step.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarFiles'>` or `PropsLocale<'sidebarFiles'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@hackdevcode/dsh-client-ui-slots'

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-tree type name, guide entry, row states, and failure lines. */
    sidebarFiles: SidebarFilesKey
  }
}

/** Files dictionary key union. */
export type SidebarFilesKey = keyof typeof en

/** English dictionary (the key-set source of truth). */
export const en = {
  'shortcut.noSession': 'Select a session first',
  'type.label': 'Files',
  'guide.title': 'Workspace files',
  'guide.description': 'Browse files in this session\'s workspace',
  loading: 'Reading…',
  empty: 'Empty directory',
  emptyHidden: 'Hidden entries are not shown',
  truncated: 'Too many entries, showing only some of them.',
  noWorkspace: 'This session has no workspace directory.',
  reload: 'Reload',
  autoRefresh: 'Auto refresh',
  'autoRefresh.enable': 'Enable auto refresh',
  'autoRefresh.disable': 'Disable auto refresh',
  'entry.other': 'Not a file or a directory, so it cannot be opened.',
  'entry.noViewer': 'No viewer can open this file.',
  'navigator.show': 'Show file tree',
  'navigator.hide': 'Hide file tree',
  'navigator.resize': 'Resize file tree',
  'error.notFound': 'That directory is gone. It may have been moved or deleted.',
  'error.outsideWorkspace': 'That directory is outside the workspace, so the sidebar will not read it.',
  'error.notDirectory': 'That is not a directory.',
  'error.unavailable': 'Read failed: {message}',
  'search.placeholder': 'Search files',
  'search.settings': 'Search settings',
  'search.clear': 'Clear search',
  'search.showHidden': 'Show hidden entries',
  'search.results': 'Results: {count}',
  'search.empty': 'No matches',
  'search.emptyHint.hidden': 'Hidden entries are not shown.',
  'search.emptyHint.excluded': 'Excluded files and directories are not shown.',
  'search.emptyHint.both': 'Hidden entries and excluded files and directories are not shown.',
  'search.emptyHint.ignored': 'Files and directories ignored by ignore files such as .gitignore are not shown.',
  'search.emptyHint.hiddenIgnored': 'Hidden entries, and files and directories ignored by ignore files such as .gitignore, are not shown.',
  'search.emptyHint.excludedIgnored': 'Excluded files and directories, and those ignored by ignore files such as .gitignore, are not shown.',
  'search.emptyHint.all': 'Hidden entries, excluded files and directories, and those ignored by ignore files such as .gitignore, are not shown.',
  'search.emptyHint.label': 'Why there are no matches',
  'search.truncated': 'Showing only the first {count} results. Narrow the search to see the rest.',
  'search.incomplete': 'The search passed its file limit, or some directories could not be read, so results may be incomplete.',
  'search.failed': 'Search failed: {message}',
  'search.retry': 'Retry',
  'settings.title': 'Excluded files and directories',
  'settings.description': 'Only affects search results, not the file tree.',
  'settings.respectGitignore': 'Respect ignore files (.gitignore, etc.)',
  'settings.add': 'Add file or directory',
  'settings.close': 'Close',
  'settings.restore': 'Restore default list',
  'settings.remove': 'Remove {path}',
  'settings.toggle': 'Exclude {path}',
  'settings.invalid.empty': 'Enter a name or relative path.',
  'settings.invalid.nul': 'The path cannot contain a NUL character.',
  'settings.invalid.absolute': 'Use a path relative to the workspace.',
  'settings.invalid.parent': 'The path cannot contain . or .. segments.',
  'settings.invalid.glob': 'The path cannot contain wildcards * ? [ ] { } !.',
} satisfies Record<string, string>
