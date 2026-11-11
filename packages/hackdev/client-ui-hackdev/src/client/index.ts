/** Browser entry registering the Hack Dev Code mission and gate-review cards. */

import type { Context as ClientContext } from '@hackdevcode/cordis'
import { registerHackDevUi } from './mount.ts'

export { inject } from './mount.ts'
export type { HackDevCardProps } from './HackDevCard.tsx'
export type { HackDevKey } from './locales.ts'
export { attentionItems, headerCounts, readHackDevMeta } from './model.ts'
export type { HackDevView } from './model.ts'

/**
 * Register the Hack Dev Code dictionaries and keyed Tool views on the Client Context.
 * @param ctx - Client Context with the declared `inject` services available.
 */
export function apply(ctx: ClientContext): void {
  registerHackDevUi(ctx)
}
