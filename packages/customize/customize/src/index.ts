/**
 * Remote gateway of the Customize settings area. It forwards a settings page's reads and changes to the
 * directory of MCP servers, connectors and skills, and holds no state of its own.
 * @module
 */

import type { Context } from '@hackdevcode/cordis'
// Type-only: the optional directory resolved through `ctx.get`.
import type { McpDirectoryControl } from '@hackdevcode/dsh-mcp-directory'
import { Remote, RemoteError, TypertRemoteService } from '@hackdevcode/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  CustomizeConnectResult,
  CustomizeConnectorChoice,
  CustomizeCustomServer,
  CustomizeServerChange,
  CustomizeSnapshot,
} from './types.ts'

export type * from './types.ts'

/** Remote-only service a settings page calls to manage MCP servers, connectors and skills. */
export class Customize extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'customize')
    // The directory announces its own changes; a client listens to this package's event only.
    ctx.on('mcp-directory/changed', () => { ctx.emit('customize/changed') })
  }

  /**
   * @returns the directory.
   * @throws {RemoteError} `customize/unavailable` when this deployment mounts no directory.
   */
  private directory(): McpDirectoryControl {
    const directory = this.ctx.get('mcpDirectory')
    if (directory === undefined) throw new RemoteError('customize/unavailable', 'The MCP and skill directory is not part of this deployment.', {})
    return directory
  }

  /**
   * Run one directory change, reporting its refusal as a Remote error the page can show.
   * @param change - the change.
   * @returns what the change returned.
   * @throws {RemoteError} `customize/unavailable` without a directory; `customize/failed` with the directory's reason.
   */
  private async run<T>(change: (directory: McpDirectoryControl) => Promise<T>): Promise<T> {
    const directory = this.directory()
    try {
      return await change(directory)
    } catch (error) {
      throw new RemoteError('customize/failed', error instanceof Error ? error.message : String(error), {})
    }
  }

  /**
   * Read the whole page.
   * @returns the servers, connectors and skills as they stand now.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('read')
  async read(): Promise<CustomizeSnapshot> {
    return this.run(async (directory) => {
      const [servers, connectors, skills] = await Promise.all([directory.servers(), directory.connectors(), directory.skills()])
      return { servers, connectors, skills }
    })
  }

  /**
   * Turn a server on or off, optionally storing its keys and folders.
   * @param id - a directory or custom server id.
   * @param change - the new state.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('setServer')
  async setServer(id: string, change: CustomizeServerChange): Promise<void> {
    await this.run(directory => directory.setServer(id, change))
  }

  /**
   * Add or replace one of the person's own servers.
   * @param id - the server id.
   * @param server - the server.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('saveCustom')
  async saveCustom(id: string, server: CustomizeCustomServer): Promise<void> {
    await this.run(directory => directory.saveCustom(id, server))
  }

  /**
   * Remove one of the person's own servers.
   * @param id - the server id.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('removeCustom')
  async removeCustom(id: string): Promise<void> {
    await this.run(directory => directory.removeCustom(id))
  }

  /**
   * Add a connector and start its sign-in.
   * @param connector - the connector.
   * @returns the link the person opens to approve access, when one is needed.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('connect')
  async connect(connector: CustomizeConnectorChoice): Promise<CustomizeConnectResult> {
    const { authorizeUrl } = await this.run(directory => directory.connect(connector))
    return authorizeUrl === undefined ? {} : { authorizeUrl }
  }

  /**
   * Sign out of a connector and remove it.
   * @param id - the connector id.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('disconnect')
  async disconnect(id: string): Promise<void> {
    await this.run(directory => directory.disconnect(id))
  }

  /**
   * Install a directory skill into the user skill folder.
   * @param id - the skill id.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('installSkill')
  async installSkill(id: string): Promise<void> {
    await this.run(directory => directory.installSkill(id))
  }

  /**
   * Remove a skill the directory installed.
   * @param id - the skill id.
   * @throws {RemoteError} `customize/unavailable` or `customize/failed`.
   */
  @Remote('removeSkill')
  async removeSkill(id: string): Promise<void> {
    await this.run(directory => directory.removeSkill(id))
  }
}

export default Customize
