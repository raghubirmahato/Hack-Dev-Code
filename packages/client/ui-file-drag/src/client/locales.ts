/** English file drag failure copy. */
export const en = { failed: 'Drag failed. Try again.' } satisfies Record<string, string>

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File transfer failure feedback. */
    fileDrag: keyof typeof en
  }
}
