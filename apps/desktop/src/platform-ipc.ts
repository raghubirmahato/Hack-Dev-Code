/** Shared names for the desktop Platform bridge. */
/** Private desktop channels; the Platform renderer receives bootstrap and locale updates. */
export const PLATFORM_IPC = {
  bootstrap: 'dsh-platform:bootstrap',
  localeChanged: 'dsh-platform:locale-changed',
  open: 'dsh-platform:open',
  bounds: 'dsh-platform:bounds',
  close: 'dsh-platform:close',
} as const

/** Platform document language; Desktop always presents Platform pages in English. */
export type PlatformLocale = 'en_US'
