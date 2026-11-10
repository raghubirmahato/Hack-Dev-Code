/**
 * OAuth sign-in for connectors: remote MCP servers that authorize with OAuth 2.1, PKCE and dynamic client
 * registration. The MCP SDK runs the protocol; this module keeps what it produces (the registered client and the
 * tokens) in a grant store and carries one sign-in attempt from the authorization link to the browser callback.
 * @module
 */

import { randomBytes } from 'node:crypto'
import { auth as sdkAuth } from '@modelcontextprotocol/client'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthClientProvider, OAuthTokens } from '@modelcontextprotocol/client'

/** What one connector's sign-in left behind. */
export interface ConnectorGrant {
  /** The callback address the client was registered with; a client registered for another address is not reused. */
  redirectUrl: string
  /** The client the authorization server registered for this app. */
  client?: OAuthClientInformationMixed | undefined
  /** The access and refresh tokens. */
  tokens?: OAuthTokens | undefined
}

/** Where grants are kept; the plugin backs it with the credential store. */
export interface GrantStore {
  /**
   * Read one connector's grant.
   * @param id - the connector id.
   * @returns the grant, or `undefined` when the connector never signed in.
   */
  read(id: string): Promise<ConnectorGrant | undefined>
  /**
   * Replace one connector's grant.
   * @param id - the connector id.
   * @param change - receives the current grant and returns its replacement.
   */
  write(id: string, change: (current: ConnectorGrant | undefined) => ConnectorGrant): Promise<void>
  /**
   * Delete one connector's grant.
   * @param id - the connector id.
   */
  remove(id: string): Promise<void>
}

/** What one step of the authorization flow needs. */
export interface AuthStep {
  /** The connector's MCP address. */
  serverUrl: string
  /** The code the browser returned; absent when the flow is only starting. */
  authorizationCode?: string
}

/** Runs one step of the authorization flow; the MCP SDK's `auth` in production. */
export type AuthRunner = (
  provider: OAuthClientProvider, options: AuthStep,
) => Promise<'AUTHORIZED' | 'REDIRECT'>

interface Attempt {
  readonly state: string
  readonly serverUrl: string
  verifier?: string
  authorizeUrl?: string
}

/** Sign-ins for connectors: starts and finishes authorization, and hands a connection its stored tokens. */
export class ConnectorAuth {
  private readonly attempts = new Map<string, Attempt>()

  /**
   * @param store - where grants are kept.
   * @param redirectUrl - the browser callback address, or `undefined` while no Web server can receive it.
   * @param changed - called after a connector's tokens were saved or removed.
   * @param run - the authorization flow.
   */
  constructor(
    private readonly store: GrantStore,
    private readonly redirectUrl: () => string | undefined,
    private readonly changed: (id: string) => void,
    private readonly run: AuthRunner = sdkAuth,
  ) {}

  /**
   * The sign-in a connection to one connector authenticates with.
   * @param id - the connector id.
   * @returns the provider the MCP transport reads tokens from and refreshes them through.
   */
  provider(id: string): OAuthClientProvider {
    const redirect = (): string => {
      const url = this.redirectUrl()
      if (url === undefined) throw new Error('signing in needs the Web UI, which is not running')
      return url
    }
    const attempts = this.attempts
    const store = this.store
    const changed = this.changed
    return {
      get redirectUrl(): string { return redirect() },
      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: 'Hack Dev Code', redirect_uris: [redirect()], grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'], token_endpoint_auth_method: 'none',
        }
      },
      state: () => attempts.get(id)?.state ?? '',
      async clientInformation() {
        const grant = await store.read(id)
        return grant?.redirectUrl === redirect() ? grant.client : undefined
      },
      async saveClientInformation(client) {
        await store.write(id, () => ({ redirectUrl: redirect(), client }))
      },
      async tokens() {
        return (await store.read(id))?.tokens
      },
      async saveTokens(tokens) {
        await store.write(id, current => ({ redirectUrl: current?.redirectUrl ?? redirect(), client: current?.client, tokens }))
        changed(id)
      },
      redirectToAuthorization(url) {
        const attempt = attempts.get(id)
        if (attempt !== undefined) attempt.authorizeUrl = url.href
      },
      saveCodeVerifier(verifier) {
        const attempt = attempts.get(id)
        if (attempt !== undefined) attempt.verifier = verifier
      },
      codeVerifier() {
        const verifier = attempts.get(id)?.verifier
        if (verifier === undefined) throw new Error('this sign-in was not started here; start it again')
        return verifier
      },
    }
  }

  /**
   * Start signing in to a connector.
   * @param id - the connector id.
   * @param serverUrl - the connector's MCP address.
   * @returns the link the person opens to approve access, or nothing when stored tokens already work.
   */
  async begin(id: string, serverUrl: string): Promise<{ authorizeUrl?: string }> {
    const attempt: Attempt = { state: randomBytes(24).toString('base64url'), serverUrl }
    this.attempts.set(id, attempt)
    const result = await this.run(this.provider(id), { serverUrl })
    if (result === 'AUTHORIZED') {
      this.attempts.delete(id)
      return {}
    }
    if (attempt.authorizeUrl === undefined) throw new Error('the server did not give an authorization link')
    return { authorizeUrl: attempt.authorizeUrl }
  }

  /**
   * Finish a sign-in from the browser callback.
   * @param state - the `state` the callback carried.
   * @param code - the authorization code the callback carried.
   * @returns the id of the connector that is now signed in.
   */
  async finish(state: string, code: string): Promise<string> {
    const found = [...this.attempts].find(([, attempt]) => attempt.state === state)
    if (found === undefined) throw new Error('this sign-in link is no longer valid; start again')
    const [id, attempt] = found
    const result = await this.run(this.provider(id), { serverUrl: attempt.serverUrl, authorizationCode: code })
    this.attempts.delete(id)
    if (result !== 'AUTHORIZED') throw new Error('the server did not accept the authorization code')
    return id
  }

  /**
   * Whether a connector has tokens.
   * @param id - the connector id.
   * @returns true once a sign-in finished and was not removed.
   */
  async signedIn(id: string): Promise<boolean> {
    return (await this.store.read(id))?.tokens !== undefined
  }

  /**
   * Sign out of a connector: drop its attempt, registered client and tokens.
   * @param id - the connector id.
   */
  async forget(id: string): Promise<void> {
    this.attempts.delete(id)
    await this.store.remove(id)
    this.changed(id)
  }
}
