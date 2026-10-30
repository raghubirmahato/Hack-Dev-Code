/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof en

/** English dictionary (the key-set source of truth). */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
  'panels.more': 'More',
  'brand.name': 'Hack Dev Code',
} satisfies Record<string, string>
