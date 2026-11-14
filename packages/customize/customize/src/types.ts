/**
 * Wire types of the Customize settings area: MCP servers, connectors, website sessions and skills.
 * @module
 */

import type {} from '@hackdevcode/cordis'
import type {} from '@hackdevcode/dsh-typert-protocol'

declare module '@hackdevcode/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** This deployment mounts no MCP and skill directory. */
    'customize/unavailable': Record<string, never>
    /** The directory refused the change; the message carries its reason. */
    'customize/failed': Record<string, never>
  }
}

/** One of the person's own MCP servers: a command to start, or an address to reach. */
export interface CustomizeCustomServer {
  /** Run the server. */
  enabled: boolean
  /** The name shown for it; its id when unset. */
  title?: string
  /** The program a local server starts with. */
  command?: string
  /** Arguments for the command. */
  args?: string[]
  /** Environment values for the command. */
  env?: Record<string, string>
  /** The address of a remote server; when set, the command is not used. */
  url?: string
  /** HTTP headers sent to a remote server. */
  headers?: Record<string, string>
}

/** A change to one server. */
export interface CustomizeServerChange {
  /** Turn the server on or off. */
  enabled: boolean
  /** Values for the keys a directory server needs; each is kept in the credential store, never in the profile. */
  keys?: Record<string, string>
  /** Folders for a server that opens folders. */
  roots?: string[]
}

/** A key a directory server needs. */
export interface CustomizeServerKey {
  name: string
  description: string
  /** True once a value is stored; the value itself never leaves the host. */
  set: boolean
}

/** One server as the settings page shows it. */
export interface CustomizeServer {
  id: string
  title: string
  description: string
  homepage: string
  /** True for a server the person added, false for a directory server. */
  custom: boolean
  enabled: boolean
  /** Why a server that is on is not running, such as a missing key; empty otherwise. */
  note: string
  requires: CustomizeServerKey[]
  /** True when the server takes folders. */
  opensFolders: boolean
  roots: string[]
  /** The command line of a local server; empty for a remote one. */
  command: string
  /** The address of a remote server; empty for a local one. */
  url: string
}

/** A connector to add or sign in to again. */
export interface CustomizeConnectorChoice {
  /** A catalog id, or a new id for the person's own connector. */
  id: string
  /** The MCP address; required for the person's own connector. */
  url?: string
  /** The name shown for the person's own connector. */
  title?: string
}

/** One connector as the settings page shows it. */
export interface CustomizeConnector {
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

/** The result of starting a connector sign-in. */
export interface CustomizeConnectResult {
  /** The link the person opens to approve access; absent when the stored sign-in still works. */
  authorizeUrl?: string
}

/** One directory skill as the settings page shows it. */
export interface CustomizeSkill {
  id: string
  title: string
  description: string
  license: string
  /**
   * `builtin`: ships inside Hack Dev Code and is always available; `directory`: installed from the directory;
   * `other`: a folder of that name exists that the directory did not install; `no`: not installed.
   */
  state: 'builtin' | 'directory' | 'other' | 'no'
}

/** A website to sign in to. */
export interface CustomizeSiteChoice {
  /** The website's link; `https://` is assumed when the scheme is left out. */
  url: string
  /** The name shown for it; its host when unset. */
  title?: string
}

/** One website session as the settings page shows it. */
export interface CustomizeSite {
  id: string
  title: string
  /** The page the sign-in window opens at. */
  url: string
  host: string
  enabled: boolean
  /** Why a session that is on cannot be used, such as no browser being installed; empty otherwise. */
  note: string
  /** True once an agent recorded how to do something on this website. */
  playbook: boolean
}

/** The result of adding a website session. */
export interface CustomizeSiteResult {
  /** The id the session is stored under; its tools load with the group `mcp-<id>`. */
  id: string
}

/** Everything the Customize page shows, read in one call. */
export interface CustomizeSnapshot {
  servers: CustomizeServer[]
  connectors: CustomizeConnector[]
  /** Websites the person signed in to. */
  sites: CustomizeSite[]
  skills: CustomizeSkill[]
}

declare module '@hackdevcode/cordis' {
  interface Events {
    /**
     * A server, connector or skill changed; read the page again.
     * @mode emit
     */
    'customize/changed'(): void
  }
}
