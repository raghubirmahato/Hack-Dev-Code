/** `secretMask` dictionaries for the per-credential reveal control. */

import type {} from '@hackdevcode/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'secretMask'

/** The secretMask namespace key union. */
export type SecretMaskKey = keyof typeof en

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Accessible names of the control that reveals one masked credential. */
    secretMask: SecretMaskKey
  }
}

/** English dictionary (the key-set source of truth). */
export const en = {
  'secret.reveal': 'Show secret',
  'secret.hide': 'Hide secret',
} satisfies Record<string, string>
