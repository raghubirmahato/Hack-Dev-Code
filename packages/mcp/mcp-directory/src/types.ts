/**
 * What a settings page reads from and asks of the directory: servers, connectors and skills.
 * @module
 */

/** One of the person's own MCP servers: a command to start, or an address to reach. */
export interface CustomServer {
  /** Run the server. */
  enabled: boolean
  /** The name shown for it; its id when unset. */
  title?: string | undefined
  /** The program a local server starts with. */
  command?: string | undefined
  /** Arguments for the command. */
  args?: readonly string[] | undefined
  /** Environment values for the command. */
  env?: Readonly<Record<string, string>> | undefined
  /** The address of a remote server; when set, the command is not used. */
  url?: string | undefined
  /** HTTP headers sent to a remote server. */
  headers?: Readonly<Record<string, string>> | undefined
}

/** A change to one server. */
export interface ServerChange {
  /** Turn the server on or off. */
  enabled: boolean
  /** Values for the keys a directory server needs; each is kept in the credential store, never in the profile. */
  keys?: Readonly<Record<string, string>> | undefined
  /** Folders for a server that opens folders. */
  roots?: readonly string[] | undefined
}

/** One server as a settings page shows it. */
export interface ServerStatus {
  id: string
  title: string
  description: string
  homepage: string
  /** True for a server the person added, false for a directory server. */
  custom: boolean
  enabled: boolean
  /** Why a server that is on is not running, such as a missing key; empty otherwise. */
  note: string
  /** The keys a directory server needs and whether each has a value. */
  requires: { name: string; description: string; set: boolean }[]
  /** True when the server takes folders. */
  opensFolders: boolean
  roots: string[]
  /** The command line of a local server; empty for a remote one. */
  command: string
  /** The address of a remote server; empty for a local one. */
  url: string
}

/** A connector to add or sign in to again. */
export interface ConnectorChoice {
  /** A catalog id, or a new id for the person's own connector. */
  id: string
  /** The MCP address; required for the person's own connector. */
  url?: string | undefined
  /** The name shown for the person's own connector. */
  title?: string | undefined
}

/** One connector as a settings page shows it. */
export interface ConnectorStatus {
  id: string
  title: string
  description: string
  homepage: string
  url: string
  /** True for a connector the person added by address. */
  custom: boolean
  /** True once the person added it. */
  added: boolean
  /** True once a sign-in finished. */
  signedIn: boolean
}

/** One directory skill as a settings page shows it. */
export interface SkillStatus {
  id: string
  title: string
  description: string
  license: string
  /**
   * `directory`: installed from the directory; `other`: a folder of that name exists that the directory did not install;
   * `no`: not installed.
   */
  state: 'directory' | 'other' | 'no'
}

/** The directory's changes for a settings page. The person makes these directly, so none asks for approval. */
export interface McpDirectoryControl {
  /**
   * List the directory servers and the person's own.
   * @returns the directory servers and the person's own.
   */
  servers(): Promise<ServerStatus[]>
  /**
   * Turn a server on or off.
   * @param id - a directory or custom server id.
   * @param change - the new state.
   */
  setServer(id: string, change: ServerChange): Promise<void>
  /**
   * Add or replace one of the person's own servers.
   * @param id - the server id.
   * @param server - the server.
   */
  saveCustom(id: string, server: CustomServer): Promise<void>
  /**
   * Remove one of the person's own servers.
   * @param id - the server id.
   */
  removeCustom(id: string): Promise<void>
  /**
   * List the catalog connectors and the person's own.
   * @returns the catalog connectors and the person's own.
   */
  connectors(): Promise<ConnectorStatus[]>
  /**
   * Add a connector and start its sign-in.
   * @param connector - the connector.
   * @returns the link the person opens to approve access, or nothing when the stored sign-in still works.
   */
  connect(connector: ConnectorChoice): Promise<{ authorizeUrl?: string }>
  /**
   * Sign out of a connector and remove it.
   * @param id - the connector id.
   */
  disconnect(id: string): Promise<void>
  /**
   * List the directory skills.
   * @returns the directory skills.
   */
  skills(): Promise<SkillStatus[]>
  /**
   * Install a directory skill.
   * @param id - the skill id.
   */
  installSkill(id: string): Promise<void>
  /**
   * Remove a skill the directory installed.
   * @param id - the skill id.
   */
  removeSkill(id: string): Promise<void>
}
