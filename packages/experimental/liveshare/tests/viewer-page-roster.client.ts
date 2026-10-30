/**
 * Test-only client roster of the assembled viewer page.
 *
 * A served viewer page is the owner's own Web shell with the owner's client plugins; this roster is the
 * subset the viewer page specs need: the wire plugin, the Gateway, remote access, the Session/Workspace controllers,
 * the presentation plugins, and the Liveshare `./client` face, which mounts the viewer surfaces when the
 * carrier names a share. Every row is the package's own `/client` face registered as a module-table
 * factory. It must be imported only after {@link prepareViewerRemoteFaces} answered the generated
 * `/remote` faces these plugins import.
 *
 * @module @hackdevcode/dsh-experimental-liveshare/tests/viewer-page-roster
 */

import * as apiGateway from '@hackdevcode/dsh-api-gateway/client'
import * as apiRemoteAccess from '@hackdevcode/dsh-api-remote-access/client'
import * as apiRemotes from '@hackdevcode/dsh-api-remotes/client'
import * as apiSessionController from '@hackdevcode/dsh-api-session-controller/client'
import * as apiWorkspaceController from '@hackdevcode/dsh-api-workspace-controller/client'
import * as clientConnection from '@hackdevcode/dsh-client-connection/client'
import * as clientFileUpload from '@hackdevcode/dsh-client-file-upload/client'
import * as clientLocale from '@hackdevcode/dsh-client-locale/client'
import * as clientModules from '@hackdevcode/dsh-client-modules/client'
import * as clientResources from '@hackdevcode/dsh-client-resources/client'
import * as clientShortcuts from '@hackdevcode/dsh-client-shortcuts/client'
import * as uiAttachment from '@hackdevcode/dsh-client-ui-attachment/client'
import * as uiChat from '@hackdevcode/dsh-client-ui-chat/client'
import * as uiConversation from '@hackdevcode/dsh-client-ui-conversation/client'
import * as uiDeliverables from '@hackdevcode/dsh-client-ui-deliverables/client'
import * as uiFileDrag from '@hackdevcode/dsh-client-ui-file-drag/client'
import * as uiLayout from '@hackdevcode/dsh-client-ui-layout/client'
import * as uiRenderer from '@hackdevcode/dsh-client-ui-renderer/client'
import * as uiSession from '@hackdevcode/dsh-client-ui-session/client'
import * as uiSettings from '@hackdevcode/dsh-client-ui-settings/client'
import * as uiSidebar from '@hackdevcode/dsh-client-ui-sidebar/client'
import * as uiSidebarRight from '@hackdevcode/dsh-client-ui-sidebar-right/client'
import * as uiTheme from '@hackdevcode/dsh-client-ui-theme/client'
import * as uiTool from '@hackdevcode/dsh-client-ui-tool/client'
import * as uiTrajectory from '@hackdevcode/dsh-client-ui-trajectory/client'
import * as uiWorkspace from '@hackdevcode/dsh-client-ui-workspace/client'
import * as typertRegistry from '@hackdevcode/dsh-typert-registry/client'
import * as liveshare from '../src/client/index.ts'

/** One module-table row: the entry id the Loader creates, and that plugin's client exports. */
export interface ViewerPageRosterRow {
  readonly id: string
  readonly exports: Readonly<Record<string, unknown>>
}

/** Entry id of the module-system bootstrap whose exports the facade hands to the module system. */
export const VIEWER_PAGE_BOOTSTRAP_ID = '@hackdevcode/dsh-client-modules'

/** The viewer page roster; Cordis composes these entries by service injection, so order is irrelevant. */
export const VIEWER_PAGE_ROSTER: readonly ViewerPageRosterRow[] = [
  { id: '@hackdevcode/dsh-typert-registry', exports: typertRegistry },
  { id: '@hackdevcode/dsh-experimental-liveshare', exports: liveshare },
  { id: VIEWER_PAGE_BOOTSTRAP_ID, exports: clientModules },
  { id: '@hackdevcode/dsh-client-connection', exports: clientConnection },
  { id: '@hackdevcode/dsh-api-gateway', exports: apiGateway },
  { id: '@hackdevcode/dsh-api-remote-access', exports: apiRemoteAccess },
  { id: '@hackdevcode/dsh-api-remotes', exports: apiRemotes },
  { id: '@hackdevcode/dsh-api-session-controller', exports: apiSessionController },
  { id: '@hackdevcode/dsh-api-workspace-controller', exports: apiWorkspaceController },
  { id: '@hackdevcode/dsh-client-file-upload', exports: clientFileUpload },
  { id: '@hackdevcode/dsh-client-locale', exports: clientLocale },
  { id: '@hackdevcode/dsh-client-resources', exports: clientResources },
  { id: '@hackdevcode/dsh-client-shortcuts', exports: clientShortcuts },
  { id: '@hackdevcode/dsh-client-ui-renderer', exports: uiRenderer },
  { id: '@hackdevcode/dsh-client-ui-theme', exports: uiTheme },
  { id: '@hackdevcode/dsh-client-ui-settings', exports: uiSettings },
  { id: '@hackdevcode/dsh-client-ui-layout', exports: uiLayout },
  { id: '@hackdevcode/dsh-client-ui-session', exports: uiSession },
  { id: '@hackdevcode/dsh-client-ui-sidebar', exports: uiSidebar },
  { id: '@hackdevcode/dsh-client-ui-conversation', exports: uiConversation },
  { id: '@hackdevcode/dsh-client-ui-chat', exports: uiChat },
  { id: '@hackdevcode/dsh-client-ui-tool', exports: uiTool },
  { id: '@hackdevcode/dsh-client-ui-attachment', exports: uiAttachment },
  { id: '@hackdevcode/dsh-client-ui-file-drag', exports: uiFileDrag },
  { id: '@hackdevcode/dsh-client-ui-sidebar-right', exports: uiSidebarRight },
  { id: '@hackdevcode/dsh-client-ui-trajectory', exports: uiTrajectory },
  { id: '@hackdevcode/dsh-client-ui-deliverables', exports: uiDeliverables },
  { id: '@hackdevcode/dsh-client-ui-workspace', exports: uiWorkspace },
]
