/** English labels checked against the bottom-panel dictionary. */
export const en = {
  title: 'NodeJS inspector',
  toggle: 'Toggle NodeJS inspector',
  close: 'Collapse',
  resize: 'Resize NodeJS inspector panel',
  frameTitle: 'NodeJS inspector',
} satisfies Record<string, string>

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shared Inspector frontend copy. */
    inspectorPanel: keyof typeof en
  }
}
