# MCP

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcpauth--mcpauth"></a>

### `ctx.mcpAuth` — `McpAuth`

The optional `mcpAuth` service: whoever keeps OAuth sign-ins for remote MCP servers publishes it, and a Streamable HTTP connection asks it for the server's sign-in before it connects.

```ts cordis-catalog
/**
 * The stored sign-in for one server.
 * @param serverName - the connection's `serverName`.
 * @returns the provider the transport authenticates with, or `undefined` when the server has no sign-in.
 */
provider(serverName: string): OAuthClientProvider | undefined
```

Source: [`packages/mcp/mcp-client/src/index.ts`](../../packages/mcp/mcp-client/src/index.ts)

<a id="ctxmcpdirectory--mcpdirectorycontrol"></a>

### `ctx.mcpDirectory` — `McpDirectoryControl`

The directory's changes for a settings page. The person makes these directly, so none asks for approval.

```ts cordis-catalog
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
 * List the website sessions the person added.
 * @returns the sessions.
 */
sites(): Promise<SiteStatus[]>

/**
 * Add a website session and open its sign-in window on this machine.
 * @param site - the website.
 * @returns the id the session is stored under.
 */
addSite(site: SiteChoice): Promise<{ id: string }>

/**
 * Open a session's sign-in window again, to sign in afresh or to check the account.
 * @param id - the session id.
 */
openSite(id: string): Promise<void>

/**
 * Remove a website session with its browser profile and playbook.
 * @param id - the session id.
 */
removeSite(id: string): Promise<void>

/**
 * List the built-in and directory skills.
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
```

Source: [`packages/mcp/mcp-directory/src/types.ts`](../../packages/mcp/mcp-directory/src/types.ts)

<a id="ctxmcpresources--mcpresourceruntime"></a>

### `ctx.mcpResources` — `McpResourceRuntime`

Scoped resource access plus three tools shared by configured MCP servers.

```ts cordis-catalog
/**
 * Register one server and expose resource tools while that scope has providers.
 * @param server - configured server name, unique in this scope.
 * @param provider - connection-owned resource operations.
 * @returns the effect disposer for this exact registration.
 */
register(server: string, provider: McpResourceProvider): () => void
```

Source: [`packages/mcp/mcp-resources/src/index.ts`](../../packages/mcp/mcp-resources/src/index.ts)

<a id="customize-events"></a>

### `customize/*` events

<a id="customizechanged--emit"></a>

#### `customize/changed` — emit

A server, connector or skill changed; read the page again.

```ts cordis-catalog
/**
 * A server, connector or skill changed; read the page again.
 * @mode emit
 */
'customize/changed'(): void
```

Source: [`packages/customize/customize/src/types.ts`](../../packages/customize/customize/src/types.ts)

<a id="mcp-directory-events"></a>

### `mcp-directory/*` events

<a id="mcp-directorychanged--emit"></a>

#### `mcp-directory/changed` — emit

A server, connector or skill was turned on, off, added, removed, signed in to or signed out of.

```ts cordis-catalog
/** A server, connector or skill was turned on, off, added, removed, signed in to or signed out of.
 * @mode emit
 */
'mcp-directory/changed'(): void
```

Source: [`packages/mcp/mcp-directory/src/index.ts`](../../packages/mcp/mcp-directory/src/index.ts)
<!-- END GENERATED cordis-surface -->
