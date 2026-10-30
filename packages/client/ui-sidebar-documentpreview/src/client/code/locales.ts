/** Locale-owned code renderer name and CodeBlock controls. */
import type {} from '@hackdevcode/dsh-client-ui-slots'

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Code document implementation name and copy controls. */
    sidebarCodePreview: keyof typeof en
  }
}

/** English dictionary; its keys are the namespace's key source. */
export const en = {
  title: 'Code',
  copy: 'Copy',
  copied: 'Copied',
} satisfies Record<string, string>
