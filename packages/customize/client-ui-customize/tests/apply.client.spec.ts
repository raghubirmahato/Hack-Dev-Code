// @vitest-environment jsdom
import { Context, Service } from '@hackdevcode/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@hackdevcode/dsh-client-locale/client'
import { SlotRegistry } from '@hackdevcode/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@hackdevcode/dsh-client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { CustomizeSection } from '../src/client/CustomizeSection.tsx'
import type { CustomizeSectionInjected } from '../src/client/CustomizeSection.tsx'
import { apply as hostApply } from '../src/index.ts'

const emit = (ctx: Context, name: string) => { (ctx as unknown as { emit(event: string): void }).emit(name) }
const SNAPSHOT = { servers: [], connectors: [], skills: [] }
const ok = <T>(value: T) => ({ ok: true as const, value })

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listeners = new Map<string, () => void>()
  const stop = vi.fn()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $on(name: string, listener: () => void): () => void {
      listeners.set(name, listener)
      return stop
    }
  }
  new RemoteService(ctx)
  const remote = {
    read: vi.fn(async () => ok(SNAPSHOT)),
    setServer: vi.fn(async () => ok(undefined)),
    saveCustom: vi.fn(async () => ok(undefined)),
    removeCustom: vi.fn(async () => ok(undefined)),
    connect: vi.fn(async () => ok({ authorizeUrl: 'https://example.com/authorize' })),
    disconnect: vi.fn(async () => ok(undefined)),
    addSite: vi.fn(async () => ok({ id: 'forum' })),
    openSite: vi.fn(async () => ok(undefined)),
    removeSite: vi.fn(async () => ok(undefined)),
    installSkill: vi.fn(async () => ok(undefined)),
    removeSkill: vi.fn(async () => ok(undefined)),
  }
  ctx.provide('remote.customize', remote)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const section = slots.entries('settings.section')[0]!
  const face = (section.inject as unknown as () => CustomizeSectionInjected)()
  return { ctx, fiber, slots, listeners, stop, remote, section, face }
}

describe('client-ui-customize browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services the section uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.customize'])
  })

  it('registers a localized Settings section between Tools and Models', async () => {
    const b = await bench()
    expect(b.section.component).toBe(CustomizeSection)
    expect(b.section.options).toMatchObject({ id: 'customize', order: 12 })
    expect(b.section.locale).toBe(NS)
    expect(resolveSlotLabel(b.section.options.label)).toBe('Customize')
    expect(b.remote.read).not.toHaveBeenCalled()
  })

  it('forwards every action to the Remote and hands back its value', async () => {
    const b = await bench()
    await expect(b.face.read()).resolves.toBe(SNAPSHOT)
    await b.face.setServer('files', { enabled: true })
    await b.face.saveCustom('mine', { enabled: true, title: 'Mine', command: 'node', args: [] })
    await b.face.removeCustom('mine')
    await expect(b.face.connect({ id: 'docs' })).resolves.toBe('https://example.com/authorize')
    await b.face.disconnect('docs')
    await b.face.installSkill('review')
    await b.face.removeSkill('review')
    expect(b.remote.setServer).toHaveBeenCalledWith('files', { enabled: true })
    expect(b.remote.saveCustom).toHaveBeenCalledWith('mine', { enabled: true, title: 'Mine', command: 'node', args: [] })
    expect(b.remote.removeCustom).toHaveBeenCalledWith('mine')
    expect(b.remote.connect).toHaveBeenCalledWith({ id: 'docs' })
    expect(b.remote.disconnect).toHaveBeenCalledWith('docs')
    expect(await b.face.addSite({ url: 'forum.example.com' })).toBe('forum')
    await b.face.openSite('forum')
    await b.face.removeSite('forum')
    expect(b.remote.addSite).toHaveBeenCalledWith({ url: 'forum.example.com' })
    expect(b.remote.openSite).toHaveBeenCalledWith('forum')
    expect(b.remote.removeSite).toHaveBeenCalledWith('forum')
    expect(b.remote.installSkill).toHaveBeenCalledWith('review')
    expect(b.remote.removeSkill).toHaveBeenCalledWith('review')
  })

  it('turns a refused call into an error carrying the Host reason', async () => {
    const b = await bench()
    b.remote.read.mockResolvedValueOnce({ ok: false, error: { code: 'customize/failed', message: 'The directory could not be read.' } } as never)
    await expect(b.face.read()).rejects.toThrow('The directory could not be read.')
  })

  it('opens links in a new window without an opener', async () => {
    const b = await bench()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    onTestFinished(() => { open.mockRestore() })
    b.face.openLink('https://example.com/docs')
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
  })

  it('counts Host announcements and reconnects, and stops listening when disposed', async () => {
    const b = await bench()
    const revision = b.face.hooks.revision
    expect(revision.getSnapshot()).toBe(0)
    b.listeners.get('customize/changed')!()
    expect(revision.getSnapshot()).toBe(1)
    emit(b.ctx, 'connection/reset')
    expect(revision.getSnapshot()).toBe(2)

    await b.fiber.dispose()
    expect(b.stop).toHaveBeenCalledOnce()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    emit(b.ctx, 'connection/reset')
    expect(revision.getSnapshot()).toBe(2)
  })
})
