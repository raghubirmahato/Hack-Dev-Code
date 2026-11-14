import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { CdpRelay, chromeUserDataDir, readChromeEndpoint, textOf } from '../src/relay.ts'

/** A fake Chrome browser endpoint: answers every command with its own id and records what it received. */
async function fakeChrome() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => { server.once('listening', resolve) })
  const received: Array<{ id?: number; method?: string; params?: Record<string, unknown> }> = []
  let connections = 0
  let socket: WebSocket | undefined
  server.on('connection', (connection) => {
    connections++
    socket = connection
    connection.on('message', (data: RawData) => {
      const message = JSON.parse(textOf(data)) as { id?: number; method?: string; params?: Record<string, unknown> }
      received.push(message)
      if (message.method === 'Target.attachToTarget') {
        connection.send(JSON.stringify({ id: message.id, result: { sessionId: `S${String(message.id)}` } }))
      } else if (message.method === 'Target.createBrowserContext') {
        connection.send(JSON.stringify({ id: message.id, result: { browserContextId: 'CTX' } }))
      } else {
        connection.send(JSON.stringify({ id: message.id, result: { echo: message.method } }))
      }
    })
  })
  const address = server.address() as { port: number }
  return {
    url: `ws://127.0.0.1:${String(address.port)}/devtools/browser/fake`,
    received,
    connections: () => connections,
    event: (message: object) => { socket?.send(JSON.stringify(message)) },
    drop: () => { socket?.close() },
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

/** Open a client to the relay and send/receive CDP messages. */
async function client(url: string) {
  const socket = new WebSocket(url)
  const inbox: Array<Record<string, unknown>> = []
  socket.on('message', (data: RawData) => { inbox.push(JSON.parse(textOf(data)) as Record<string, unknown>) })
  await new Promise<void>((resolve, reject) => { socket.once('open', () => { resolve() }); socket.once('error', reject) })
  const until = async (test: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !test(); i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(test()).toBe(true)
  }
  return {
    socket,
    inbox,
    until,
    send: (message: object) => { socket.send(JSON.stringify(message)) },
    close: () => new Promise<void>((resolve) => { socket.once('close', () => { resolve() }); socket.close() }),
  }
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('Chrome relay', () => {
  it('connects to Chrome once and serves one Session after another on that connection', async () => {
    const chrome = await fakeChrome()
    cleanups.push(chrome.close)
    const relay = new CdpRelay(async () => chrome.url)
    const url = await relay.start()
    cleanups.push(() => relay.close())

    const first = await client(url)
    first.send({ id: 1, method: 'Target.getTargets' })
    first.send({ id: 2, method: 'Target.attachToTarget', params: { targetId: 'T1', flatten: true } })
    await first.until(() => first.inbox.length === 2)
    expect(first.inbox).toEqual([{ id: 1, result: { echo: 'Target.getTargets' } }, { id: 2, result: { sessionId: 'S2' } }])
    chrome.event({ method: 'Target.attachedToTarget', params: { sessionId: 'AUTO' } })
    await first.until(() => first.inbox.length === 3)
    await first.close()

    // The Session's targets are detached and automatic attachment is turned off; the Chrome connection stays.
    const cleanupMethods = (): Array<string | undefined> => chrome.received.slice(2).map(message => message.method)
    await first.until(() => cleanupMethods().length >= 4)
    expect(cleanupMethods()).toEqual(['Target.setAutoAttach', 'Target.setDiscoverTargets', 'Target.detachFromTarget', 'Target.detachFromTarget'])
    expect(chrome.received.slice(4).map(message => message.params?.['sessionId'])).toEqual(['S2', 'AUTO'])

    // The next Session reuses the connection: Chrome is not asked again, and its ids start over without clashing.
    const second = await client(url)
    second.send({ id: 1, method: 'Browser.getVersion' })
    await second.until(() => second.inbox.length === 1)
    expect(second.inbox[0]).toEqual({ id: 1, result: { echo: 'Browser.getVersion' } })
    expect(chrome.connections()).toBe(1)
    expect(relay.connections).toBe(1)
    await second.close()
  })

  it('reconnects after Chrome closes the connection, and reports a Chrome that is not reachable', async () => {
    const chrome = await fakeChrome()
    cleanups.push(chrome.close)
    const relay = new CdpRelay(async () => chrome.url)
    const url = await relay.start()
    cleanups.push(() => relay.close())
    const first = await client(url)
    first.send({ id: 1, method: 'Browser.getVersion' })
    await first.until(() => first.inbox.length === 1)
    const closed = new Promise<void>((resolve) => { first.socket.once('close', () => { resolve() }) })
    chrome.drop()
    await closed
    const second = await client(url)
    second.send({ id: 7, method: 'Browser.getVersion' })
    await second.until(() => second.inbox.length === 1)
    expect(chrome.connections()).toBe(2)
    await second.close()

    const unreachable = new CdpRelay(async () => { throw new Error('Chrome is not running with remote debugging allowed') })
    const lonely = await unreachable.start()
    cleanups.push(() => unreachable.close())
    const refused = await client(lonely)
    const reason = await new Promise<string>((resolve) => { refused.socket.once('close', (_code, why) => { resolve(why.toString()) }) })
    expect(reason).toContain('remote debugging')
  })

  it('reads Chrome\'s published endpoint and knows where each channel keeps it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-chrome-port-'))
    cleanups.push(() => { rmSync(directory, { recursive: true, force: true }) })
    await expect(readChromeEndpoint(directory)).rejects.toThrow('chrome://inspect/#remote-debugging')
    writeFileSync(join(directory, 'DevToolsActivePort'), '9333\n/devtools/browser/abc\n')
    expect(await readChromeEndpoint(directory)).toBe('ws://127.0.0.1:9333/devtools/browser/abc')
    writeFileSync(join(directory, 'DevToolsActivePort'), 'nonsense')
    await expect(readChromeEndpoint(directory)).rejects.toThrow('invalid')
    expect(chromeUserDataDir('stable', 'win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\H')).toBe(join('C:\\L', 'Google', 'Chrome', 'User Data'))
    expect(chromeUserDataDir('canary', 'win32', {}, 'C:\\H')).toBe(join('C:\\H', 'AppData', 'Local', 'Google', 'Chrome SxS', 'User Data'))
    expect(chromeUserDataDir('beta', 'darwin', {}, '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'Google', 'Chrome Beta'))
    expect(chromeUserDataDir('stable', 'linux', {}, '/home/a')).toBe(join('/home/a', '.config', 'google-chrome'))
    expect(chromeUserDataDir('dev', 'linux', { XDG_CONFIG_HOME: '/x' }, '/home/a')).toBe(join('/x', 'google-chrome-unstable'))
  })
})

describe('Chrome relay when Chrome is gone', () => {
  it('reports a port file left by a Chrome that has quit', async () => {
    const relay = new CdpRelay(async () => 'ws://127.0.0.1:1/devtools/browser/stale')
    const url = await relay.start()
    try {
      const socket = new WebSocket(url)
      const reason = await new Promise<string>((resolve) => { socket.once('close', (_code, why) => { resolve(why.toString()) }) })
      expect(reason).toContain('Chrome is not running or remote debugging is off')
      expect(relay.connections).toBe(0)
    } finally {
      await relay.close()
    }
  })
})

describe('Chrome relay protections', () => {
  it('refuses a client without the token and any web page, and cleans up private contexts and orphan attaches', async () => {
    const chrome = await fakeChrome()
    cleanups.push(chrome.close)
    const relay = new CdpRelay(async () => chrome.url)
    const url = await relay.start()
    cleanups.push(() => relay.close())
    const refused = async (target: string, headers?: Record<string, string>): Promise<boolean> => {
      const socket = new WebSocket(target, headers === undefined ? {} : { headers })
      return new Promise<boolean>((resolve) => {
        socket.once('open', () => { socket.close(); resolve(false) })
        socket.once('error', () => { resolve(true) })
      })
    }
    expect(await refused(url.replace(/[0-9a-f]{48}$/u, 'guess'))).toBe(true)
    expect(await refused(url, { Origin: 'https://evil.example' })).toBe(true)
    expect(chrome.connections()).toBe(0)

    const session = await client(url)
    session.send({ id: 1, method: 'Target.createBrowserContext' })
    await session.until(() => session.inbox.length === 1)
    await session.close()
    await session.until(() => chrome.received.some(message => message.method === 'Target.disposeBrowserContext'))

    // An attach that arrives with nobody connected is resumed and released at once.
    const before = chrome.received.length
    chrome.event({ method: 'Target.attachedToTarget', params: { sessionId: 'LATE', waitingForDebugger: true } })
    await session.until(() => chrome.received.length >= before + 2)
    expect(chrome.received.slice(before).map(message => message.method)).toEqual(['Runtime.runIfWaitingForDebugger', 'Target.detachFromTarget'])
  })
})
