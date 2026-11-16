/** Official Hack Dev Code occupants: the profile-gated sidebar brand slots. */
import type { Context as ClientContext } from '@hackdevcode/cordis'
import type {} from '@hackdevcode/dsh-client-ui-renderer/client'
import type {} from '@hackdevcode/dsh-client-ui-sidebar/client'
import type {} from '@hackdevcode/dsh-client-ui-conversation/client'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill official sidebar artwork.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
    }))
}
