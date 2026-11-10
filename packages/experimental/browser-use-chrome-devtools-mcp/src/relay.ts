/**
 * A local Chrome DevTools Protocol relay that keeps one connection to the person's own Chrome for the life of the
 * provider. Chrome 144 and later ask the person to allow every new remote-debugging connection made through
 * chrome://inspect/#remote-debugging; without the relay, each Session's MCP server opens its own connection and Chrome
 * asks again for every Session and subagent. With it, Chrome asks once, and each Session's server connects to the
 * relay instead.
 *
 * One client is served at a time (connected browsers are exclusive to one Session). Message ids are remapped so a new
 * client never receives an answer meant for the one before it, and when a client leaves, the relay detaches the
 * targets and private browser contexts it created and turns automatic attachment off, so no new tab waits for a debugger
 * that is gone and no private window outlives its Session.
 *
 * Only Hack Dev Code's own MCP servers may connect: the endpoint carries a random token, and a connection that carries
 * an Origin header (a web page) is refused, as Chrome's own endpoint refuses foreign origins.
 * @module @hackdevcode/dsh-experimental-browser-use-chrome-devtools-mcp/relay
 */

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'

/** Chrome release channels chrome-devtools-mcp accepts. */
export type ChromeChannel = 'stable' | 'beta' | 'dev' | 'canary'

/**
 * Chrome's default user data directory for a channel, where Chrome writes DevToolsActivePort when remote debugging is
 * allowed.
 * @param channel - release channel (default stable).
 * @param platform - Node platform name.
 * @param env - environment holding LOCALAPPDATA on Windows.
 * @param home - the person's home directory.
 * @returns the directory.
 */
export function chromeUserDataDir(
  channel: ChromeChannel = 'stable',
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
    const folder = { stable: 'Chrome', beta: 'Chrome Beta', dev: 'Chrome Dev', canary: 'Chrome SxS' }[channel]
    return join(local, 'Google', folder, 'User Data')
  }
  if (platform === 'darwin') {
    const folder = { stable: 'Chrome', beta: 'Chrome Beta', dev: 'Chrome Dev', canary: 'Chrome Canary' }[channel]
    return join(home, 'Library', 'Application Support', 'Google', folder)
  }
  const config = env['XDG_CONFIG_HOME'] ?? join(home, '.config')
  const folder = { stable: 'google-chrome', beta: 'google-chrome-beta', dev: 'google-chrome-unstable', canary: 'google-chrome-canary' }[channel]
  return join(config, folder)
}

/**
 * The browser WebSocket endpoint Chrome publishes in DevToolsActivePort.
 * @param userDataDir - Chrome's user data directory.
 * @returns `ws://127.0.0.1:<port>/devtools/browser/<id>`.
 * @throws a model-readable error when Chrome is not running or remote debugging is off.
 */
export async function readChromeEndpoint(userDataDir: string): Promise<string> {
  let text: string
  try {
    text = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')
  } catch (error) {
    throw new Error('Chrome is not running with remote debugging allowed; open chrome://inspect/#remote-debugging in Chrome and turn it on',
      { cause: error })
  }
  const [rawPort, path] = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535 || path?.startsWith('/') !== true) {
    throw new Error(`Chrome's DevToolsActivePort is invalid: ${JSON.stringify(text)}`)
  }
  return `ws://127.0.0.1:${String(port)}${path}`
}

/**
 * The UTF-8 text of one WebSocket message, whichever buffer form it arrived in.
 * @param data - the message.
 * @returns its text.
 */
export function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8')
}

/** One CDP message, as far as the relay reads it. */
interface CdpMessage {
  id?: number
  method?: string
  sessionId?: string
  params?: { sessionId?: string; waitingForDebugger?: boolean }
  result?: { sessionId?: string; browserContextId?: string }
}

/** First id the relay uses for its own cleanup commands; client ids are remapped below it. */
const RELAY_IDS = 1_000_000_000

/** Holds one upstream Chrome connection and serves one local client at a time. */
export class CdpRelay {
  private server: WebSocketServer | undefined
  private upstream: WebSocket | undefined
  private opening: Promise<WebSocket> | undefined
  private client: WebSocket | undefined
  private nextId = 1
  private nextRelayId = RELAY_IDS
  /** Upstream id to the client that sent it and its own id. */
  private readonly pending = new Map<number, { client: WebSocket; id: number; method?: string }>()
  /** Target sessions the current client attached, detached when it leaves. */
  private readonly sessions = new Set<string>()
  /** Private browser contexts the current client created, disposed when it leaves. */
  private readonly contexts = new Set<string>()
  /** The secret path segment a client must present. */
  private readonly token = randomBytes(24).toString('hex')
  /** How many times Chrome was connected to; the person is asked once per connection. */
  connections = 0

  /**
   * @param endpoint - resolves Chrome's browser WebSocket endpoint when the first client arrives.
   * @param connect - opens the upstream socket; replaceable in tests.
   */
  constructor(
    private readonly endpoint: () => Promise<string>,
    private readonly connect: (url: string) => WebSocket = url =>
      new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 }),
  ) {}

  /**
   * Listen on a loopback port.
   * @returns the endpoint clients connect to.
   */
  async start(): Promise<string> {
    const path = `/devtools/browser/${this.token}`
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
      // Only a client that knows the token, and no web page (browsers always send Origin), may drive the person's Chrome.
      verifyClient: ({ req }: { req: IncomingMessage }) => req.url === path && req.headers.origin === undefined,
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    server.on('connection', (socket) => { this.accept(socket) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('the Chrome relay did not get a port')
    return `ws://127.0.0.1:${String(address.port)}${path}`
  }

  /** Close the relay, its client and the Chrome connection. */
  async close(): Promise<void> {
    this.client?.close()
    this.client = undefined
    this.upstream?.close()
    this.upstream = undefined
    const server = this.server
    this.server = undefined
    if (server !== undefined) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }

  private accept(socket: WebSocket): void {
    // Connected browsers are exclusive to one Session, so a new client replaces a stale one.
    if (this.client !== undefined && this.client !== socket) this.release(this.client)
    this.client = socket
    const queued: string[] = []
    let ready = false
    socket.on('message', (data: RawData) => {
      const text = textOf(data)
      if (ready) this.forward(socket, text)
      else queued.push(text)
    })
    socket.on('close', () => { if (this.client === socket) this.release(socket) })
    socket.on('error', () => { socket.close() })
    this.open().then(() => {
      ready = true
      for (const text of queued.splice(0)) this.forward(socket, text)
    }, (error: unknown) => {
      socket.close(1011, String(error instanceof Error ? error.message : error).slice(0, 120))
    })
  }

  /** The upstream connection, opened once and reused until Chrome closes it. */
  private open(): Promise<WebSocket> {
    if (this.upstream?.readyState === WebSocket.OPEN) return Promise.resolve(this.upstream)
    this.opening ??= (async () => {
      // The endpoint is read again on every connection: Chrome publishes a new port each time it starts.
      const url = await this.endpoint()
      const socket = this.connect(url)
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => { resolve() })
        // A port file left by a Chrome that has quit points at nothing: say what to do rather than how it failed.
        socket.once('error', (error) => {
          reject(new Error('Chrome is not running or remote debugging is off; open Chrome and allow it at chrome://inspect/#remote-debugging',
            { cause: error }))
        })
        socket.once('close', (code) => { reject(new Error(`Chrome declined the connection (${String(code)}); click Allow in Chrome's prompt`)) })
      })
      this.connections++
      socket.on('message', (data: RawData) => { this.deliver(textOf(data)) })
      socket.on('close', () => {
        if (this.upstream !== socket) return
        // Chrome quit or revoked the connection: the next client connects (and asks) again.
        this.upstream = undefined
        this.pending.clear()
        this.sessions.clear()
        this.contexts.clear()
        this.client?.close(1011, 'Chrome closed the connection')
        this.client = undefined
      })
      socket.on('error', () => { socket.close() })
      this.upstream = socket
      return socket
    })().finally(() => { this.opening = undefined })
    return this.opening
  }

  private forward(client: WebSocket, text: string): void {
    const upstream = this.upstream
    if (upstream?.readyState !== WebSocket.OPEN || this.client !== client) return
    let message: CdpMessage
    try { message = JSON.parse(text) as CdpMessage } catch { return }
    if (typeof message.id === 'number') {
      const id = this.nextId++
      if (this.nextId >= RELAY_IDS) this.nextId = 1
      this.pending.set(id, { client, id: message.id, ...message.method === undefined ? {} : { method: message.method } })
      message.id = id
    }
    upstream.send(JSON.stringify(message))
  }

  private deliver(text: string): void {
    let message: CdpMessage
    try { message = JSON.parse(text) as CdpMessage } catch { return }
    if (typeof message.id === 'number') {
      if (message.id >= RELAY_IDS) return
      const owner = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (owner === undefined || owner.client !== this.client || owner.client.readyState !== WebSocket.OPEN) return
      if (typeof message.result?.sessionId === 'string') this.sessions.add(message.result.sessionId)
      if (owner.method === 'Target.createBrowserContext' && typeof message.result?.browserContextId === 'string') {
        this.contexts.add(message.result.browserContextId)
      }
      message.id = owner.id
      owner.client.send(JSON.stringify(message))
      return
    }
    if (message.method === 'Target.attachedToTarget' && typeof message.params?.sessionId === 'string') {
      // An attach that crossed a client's departure belongs to nobody: let the tab run and let it go.
      if (this.client === undefined) {
        this.free(message.params.sessionId, message.params.waitingForDebugger === true)
        return
      }
      this.sessions.add(message.params.sessionId)
    }
    if (message.method === 'Target.detachedFromTarget' && typeof message.params?.sessionId === 'string') this.sessions.delete(message.params.sessionId)
    if (this.client?.readyState === WebSocket.OPEN) this.client.send(text)
  }

  /** Forget a client and undo what it set up in Chrome, keeping the Chrome connection itself. */
  private release(client: WebSocket): void {
    if (this.client === client) this.client = undefined
    for (const [id, owner] of this.pending) if (owner.client === client) this.pending.delete(id)
    client.close()
    const upstream = this.upstream
    if (upstream?.readyState !== WebSocket.OPEN) {
      this.sessions.clear()
      this.contexts.clear()
      return
    }
    // New tabs must not wait for a debugger that left, and no events should flow to nobody.
    this.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })
    this.send('Target.setDiscoverTargets', { discover: false })
    for (const sessionId of this.sessions) this.send('Target.detachFromTarget', { sessionId })
    // A direct connection's private contexts close with it; the relay's connection stays, so it closes them itself.
    for (const browserContextId of this.contexts) this.send('Target.disposeBrowserContext', { browserContextId })
    this.sessions.clear()
    this.contexts.clear()
  }

  /** Resume a target that waits for a debugger, then detach from it. */
  private free(sessionId: string, waiting: boolean): void {
    if (waiting) this.send('Runtime.runIfWaitingForDebugger', {}, sessionId)
    this.send('Target.detachFromTarget', { sessionId })
  }

  /** Send the relay's own command; its answer is dropped. */
  private send(method: string, params: Record<string, unknown>, sessionId?: string): void {
    if (this.upstream?.readyState !== WebSocket.OPEN) return
    this.upstream.send(JSON.stringify({ id: this.nextRelayId++, method, params, ...sessionId === undefined ? {} : { sessionId } }))
  }
}
