/** Publishes public configuration for the account notification client plugin. */
import type { Context } from '@hackdevcode/cordis'
import type {} from '@hackdevcode/dsh-host-webserver'
import { Config, NOTIFICATIONS_CONFIG_GLOBAL } from './config.ts'
export { Config } from './config.ts'

/** @param ctx - Host page bootstrap collector. @param config - validated notification configuration. */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: NOTIFICATIONS_CONFIG_GLOBAL, value: config })
  })
}
