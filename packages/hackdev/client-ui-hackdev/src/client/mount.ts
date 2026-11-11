/** Source-safe Hack Dev Code browser registration. */

import type { Context as ClientContext } from '@hackdevcode/cordis'
import type {} from '@hackdevcode/dsh-client-locale/client'
import type {} from '@hackdevcode/dsh-client-ui-renderer/client'
import type {} from '@hackdevcode/dsh-client-ui-tool/client'
import { HackDevCard } from './HackDevCard.tsx'
import { en, NS, type HackDevKey } from './locales.ts'

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Hack Dev Code mission and gate-review card copy. */
    hackdev: HackDevKey
  }
}

/** Required browser services for slots and localized copy. */
export const inject = ['slots', 'locale']

/** Wire tool names whose calls render as the Hack Dev Code card. */
export const HACKDEV_TOOL_NAMES = ['hackdev', 'hackdev_review'] as const

/**
 * Register the card dictionaries and the keyed Tool views for both Hack Dev Code tools.
 * The card reads only the durable `tool/result` meta; this registration performs no RPC.
 * @param ctx - Client Context carrying the injected slot and locale services.
 */
export function registerHackDevUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'client-ui-hackdev: dictionaries')
  for (const key of HACKDEV_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, HackDevCard))
  }
}
