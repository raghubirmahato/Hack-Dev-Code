# Web server

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxconnection--hostconnectionhandle"></a>

### `ctx.connection` — `HostConnectionHandle`

Host `ctx.connection` members consumed by transport-independent adapters.

```ts cordis-catalog
/**
 * Compose exact Fetch routes and the shared-channel RPC interceptor.
 * @param channel - shared channel mounted by Connection.
 * @returns Fetch handler for trusted, authenticated requests.
 */
createSharedFetchHandler(channel: '/api'): ConnectionFetchHandler

/**
 * Apply Connection's Host/Origin checks and browser authentication to
 * another Web route.
 * @param request - request headers from the HTTP or upgrade request.
 * @returns rejection status, or undefined when the route may accept the request.
 */
requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection

/**
 * Admit an HTTP request against its signed browser or API credential and live Peer.
 * @param request - request headers from the HTTP or upgrade request.
 * @returns the credential's Peer, or the rejection status.
 */
admit(request: ConnectionTrustRequest): PeerAdmission

/**
 * Create an independent in-process Peer, disposed with the Context that read `ctx.connection`.
 * @param options - fixed principal and optional interaction participation (default `answer`).
 * @returns a new Peer distinct from every other Peer.
 */
createPeer(options: { readonly principal: Principal; readonly interactions?: 'answer' | 'none' }): PeerScope

/**
 * Claim a physical socket for an API Peer; browser sockets share their owner Peer.
 * @param request - authenticated upgrade request headers.
 * @returns the Peer and idempotent release, or 409 for duplicate API ownership.
 * The carrier releases on socket termination or failed upgrade; release removes
 * API admission synchronously without cancelling independent HTTP calls.
 */
admitConnection(request: ConnectionTrustRequest): ConnectionAdmission

/**
 * Authenticate one frontend index request, owning a token redirect or 401.
 * The cookie this mints is `Secure` when the mounted Web carrier serves TLS,
 * which only that listener's protocol decides.
 * @param request - root or configured-index HTTP request.
 * @param response - response owned when the result is false.
 * @returns true only when the frontend may serve index.html.
 */
authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean

/**
 * Add the fresh process token to an ordinary Web application URL.
 * @param baseUrl - clean application URL whose authority and mount are preserved.
 * @returns tokenized URL for initial login; a mount proxy strips its prefix before {@link authorizeIndex}.
 */
authenticatedUrl(baseUrl: string): string
```

Types: [Principal](typert.md)

Source: [`packages/client/connection/src/rpc.ts`](../../packages/client/connection/src/rpc.ts)

<a id="ctxwebapp--webapp"></a>

### `ctx.webApp` — `WebApp`

The Web GUI this process serves, provided by the `web-runtime` row.

```ts cordis-catalog
/**
 * The URL this GUI advertises, also used for `DSH_WEB_URL` and the startup URL line.
 * @returns the configured `publicUrl`, otherwise the listener origin.
 */
getAdvertisedUrl(): string
```

Source: [`packages/bundle/web-app/src/index.ts`](../../packages/bundle/web-app/src/index.ts)

<a id="ctxwebserver--webserver"></a>

### `ctx.webServer` — `WebServer`

The browser HTTP carrier service. Activation loads any configured TLS material, then listens immediately; a material or listen failure rejects initialization, and the boot process reports the failed fiber. Route registration order does not affect requests because configured named routes must be distinct, and a request no named route matches is answered 404 until the fallback owner registers.

```ts cordis-catalog
/**
 * The root URL local clients use to reach the bound listener: the protocol,
 * the {@link bindUrlHost} form of the bind address, and the listening port.
 * @returns the origin, for example `http://127.0.0.1:3080`.
 * @throws before `listen` binds a port, or when the bind address has no URL form.
 */
getOrigin(): string

/**
 * Register a named route. Duplicate (kind, path) throws — route patterns are
 * a composition-level contract, so a collision is a misconfiguration.
 * @param route - kind, path, and the owning handler or resource.
 * @returns the disposer removing the route.
 */
register(route: WebRoute | WebResourceRoute): () => void

/**
 * Register an exact-path HTTP upgrade route. Duplicate paths throw because
 * one socket can have only one protocol owner.
 * @param route - pathname and handler owning negotiation plus socket use.
 * @returns the disposer removing the route.
 */
registerUpgrade(route: WebUpgradeRoute): () => void

/**
 * Claim the fallback seat: the handler or resource answering every request
 * no named route matches (the SPA dist server in the shipped Web
 * composition). One owner only — a second registration throws, because two
 * fallbacks cannot compose.
 * @param fallback - a handler owning the full response lifecycle of
 * unmatched requests, or `{ resource }` answering them.
 * @returns the disposer releasing the seat.
 */
registerFallback(fallback: WebRoute['handler'] | Pick<WebResourceRoute, 'resource'>): () => void

/**
 * Read the response an HTTP request for the same URL would receive, as the
 * resource computes it for `peer`, without an HTTP exchange. The request
 * path picks the responder by the HTTP match order — exact, longest prefix,
 * then the fallback — and only a resource answers. This method checks no
 * cookie, Host, or Origin: the caller admits the reader before reading.
 * @param request - the read; its URL path selects the responder.
 * @param peer - the Peer the read speaks for, passed to the resource.
 * @returns the resource's response, without a body for HEAD as over HTTP;
 * 405 with `Allow: GET, HEAD` for any other method, checked before matching,
 * where over HTTP a handler route or an unmatched path answers such a
 * method itself; 404 when the path matches a handler route, or reaches the
 * fallback seat while it is unclaimed or holds a handler. A resource that
 * throws rejects the read, where an HTTP request would receive 400.
 */
async readResource(request: Request, peer: PeerScope): Promise<Response>

/**
 * Register a raw-HTML index transform, the escape hatch for markup no
 * {@link IndexInjection} row expresses: {@link renderIndex} applies taps in
 * registration order after rendering the structured rows.
 * @param transform - pure html-to-html function.
 * @returns the disposer removing the transform.
 */
tapIndex(transform: (html: string) => string): () => void

/**
 * Run an index.html body through the registered taps in registration order
 * — called by the fallback owner on every index response it renders.
 * @param html - the raw index.html body.
 * @returns the transformed body.
 */
applyIndexTaps(html: string): string

/**
 * Gather the structured injection table for one Peer: one
 * `webserver/index-inject` emit, every subscriber pushes its current rows.
 * Fresh per call, so subscribers read live state (module graph, theme
 * preference, the Peer's access) at emit time.
 * @param peer - the Peer the page speaks for.
 * @returns rows in subscriber activation order.
 */
collectIndexInjections(peer: PeerScope): IndexInjection[]

/**
 * Render one index.html body for one Peer: the structured injection table
 * first, then the raw `tapIndex` transforms over the result.
 * @param html - the raw index.html body.
 * @param peer - the Peer the page speaks for.
 * @returns the transformed body.
 */
renderIndex(html: string, peer: PeerScope): string
```

Source: [`packages/host/webserver/src/index.ts`](../../packages/host/webserver/src/index.ts)

<a id="connection-events"></a>

### `connection/*` events

<a id="connectionrequest--waterfall"></a>

#### `connection/request` — waterfall

Admit or wrap an authenticated shared API request, including body transfer. Existing requests continue when a listener refuses subsequent requests.

```ts cordis-catalog
/**
 * Admit or wrap an authenticated shared API request, including body transfer.
 * Existing requests continue when a listener refuses subsequent requests.
 * @param request - Authenticated incoming HTTP request.
 * @param response - Response owned until the delegated bridge settles.
 * @param next - Delegate to the next listener or the shared API bridge.
 * @mode waterfall
 */
'connection/request'(request: IncomingMessage, response: ServerResponse, next: () => Promise<void>): Promise<void>
```

Source: [`packages/client/connection/src/index.ts`](../../packages/client/connection/src/index.ts)

<a id="webserver-events"></a>

### `webserver/*` events

<a id="webserverindex-inject--emit"></a>

#### `webserver/index-inject` — emit

Collect the structured index injection table for the page `peer` speaks for. Emitted on every index render and every worker boot-payload request; listeners push their current rows, so a row's data is read fresh at emit time.

```ts cordis-catalog
/**
 * Collect the structured index injection table for the page `peer` speaks
 * for. Emitted on every index render and every worker boot-payload
 * request; listeners push their current rows, so a row's data is read
 * fresh at emit time.
 * @param table - Mutable row table; listeners append in activation order.
 * @param peer - The Peer the rendered page speaks for.
 * @mode emit
 */
'webserver/index-inject'(table: IndexInjection[], peer: PeerScope): void
```

Source: [`packages/host/webserver/src/index.ts`](../../packages/host/webserver/src/index.ts)
<!-- END GENERATED cordis-surface -->
