/** Customize section registered into Web Settings: skills, connectors and MCP servers. */

import type {} from '@hackdevcode/dsh-client-locale/client'
import type { Context as ClientContext } from '@hackdevcode/cordis'
import type {} from '@hackdevcode/dsh-api-remotes/client'
import type {} from '@hackdevcode/dsh-client-ui-settings/client'
import type {} from '@hackdevcode/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@hackdevcode/dsh-client-store'
import { CustomizeSection, type CustomizeSectionInjected } from './CustomizeSection.tsx'
import { en, type CustomizeLocaleKey } from './locales.ts'

export type { CustomizeSectionInjected, CustomizeSectionProps } from './CustomizeSection.tsx'
export type { CustomizeLocaleKey } from './locales.ts'

declare module '@hackdevcode/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Customize settings copy. */
    'settings.customize': CustomizeLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.customize'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.customize']

/** A Remote result, as the generated face returns it. */
type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/**
 * Unwrap one Remote result.
 * @param result - the result.
 * @returns its value.
 * @throws {Error} with the Host's reason when the call was refused.
 */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Contribute the Customize section to Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'client-ui-customize: dictionaries')

  const t = ctx.locale.bind(NS)
  const remote = ctx.remote.customize
  const revision = createSnapshotStore(0)
  const bump = () => { revision.set(revision.getSnapshot() + 1) }
  ctx.effect(() => {
    const disposers = [ctx.remote.$on('customize/changed', bump), ctx.on('connection/reset', bump)]
    return () => { for (const dispose of disposers) dispose() }
  }, 'client-ui-customize: change announcements')

  const face: CustomizeSectionInjected = {
    read: async () => unwrap(await remote.read()),
    setServer: async (id, change) => { unwrap(await remote.setServer(id, change)) },
    saveCustom: async (id, server) => { unwrap(await remote.saveCustom(id, server)) },
    removeCustom: async (id) => { unwrap(await remote.removeCustom(id)) },
    connect: async choice => unwrap(await remote.connect(choice)).authorizeUrl,
    disconnect: async (id) => { unwrap(await remote.disconnect(id)) },
    addSite: async site => unwrap(await remote.addSite(site)).id,
    openSite: async (id) => { unwrap(await remote.openSite(id)) },
    removeSite: async (id) => { unwrap(await remote.removeSite(id)) },
    installSkill: async (id) => { unwrap(await remote.installSkill(id)) },
    removeSkill: async (id) => { unwrap(await remote.removeSkill(id)) },
    openLink: (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
    hooks: { revision },
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'customize',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: () => face,
  }, CustomizeSection))
}
