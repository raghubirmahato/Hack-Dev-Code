/**
 * Browser half of the browse directory-picker backend: fills ui-workspace's
 * three directory-flow holes with the in-app Select Workspace Directory dialog
 * (figma `Harness` 813-23126 family), driving the node half's
 * `directoryPicker/list`/`directoryPicker/createDirectory` primitives.
 * Mounting this package therefore composes both sides of the browse
 * interaction with one cordis.yml row; no client code branches on a
 * capability kind. The dialog's copy is locale-registered here — the flow
 * package owns its own strings.
 */
import type { Context as ClientContext } from '@hackdevcode/cordis'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@hackdevcode/dsh-client-ui-workspace/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@hackdevcode/dsh-client-ui-renderer/client'
// Type-only: pulls the locale service merge (ctx.locale).
import type {} from '@hackdevcode/dsh-client-locale/client'
import type { BrowseFlowInjected } from './flow.ts'
import { BrowseDirectoryFlow } from './flow.ts'
import { en, NS } from './locales.ts'

/** Required services (cordis fiber inject): the slot registry, workspace UI service, and locale. */
export const inject = ['slots', 'uiWorkspace', 'locale']

/**
 * Client plugin body: register the dialog's dictionaries and the browse flow
 * into all three directory-flow holes through `slots.inject()` because the
 * ui-workspace declarations may activate later or be replaced.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'directory-picker-browse: dialog dictionaries')

  const injected = (): BrowseFlowInjected => ({
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
    createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
    t: ctx.locale.bind(NS),
  })
  // Every declaration lifetime must be live before the set installs; the
  // generator makes the three registrations one transactional effect. The
  // nesting order is arbitrary; no hole has precedence.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', () =>
      ctx.slots.inject('workspace.picker.directoryFlow', function* () {
        yield ctx.slots.register({
          name: 'conversation.hero.workspace.directoryFlow', inject: injected,
        }, BrowseDirectoryFlow)
        yield ctx.slots.register({
          name: 'sidebar.workspaces.directoryFlow', inject: injected,
        }, BrowseDirectoryFlow)
        yield ctx.slots.register({
          name: 'workspace.picker.directoryFlow', inject: injected,
        }, BrowseDirectoryFlow)
      })))
}
