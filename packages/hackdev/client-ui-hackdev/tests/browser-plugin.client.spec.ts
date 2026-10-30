import { Context } from '@hackdevcode/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@hackdevcode/dsh-client-locale/client'
import { SlotRegistry } from '@hackdevcode/dsh-client-ui-renderer/client'
import { HackDevCard } from '../src/client/HackDevCard.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entries = () => ctx.slots.entries('tool.call.toolview').filter(entry => entry.component === HackDevCard)
  return { ctx, fiber, entries }
}

describe('ui-hackdev browser plugin', () => {
  it('registers a disposable card for both hackdev tools and its dictionaries', async () => {
    const b = await bench()
    expect(inject).toEqual(['slots', 'locale'])
    expect(b.entries().map(entry => entry.options.key).sort()).toEqual(['hackdev', 'hackdev_review'])
    expect(b.entries().every(entry => entry.locale === 'hackdev')).toBe(true)

    const t = b.ctx.locale.bind('hackdev')
    expect(t('title.mission')).toBe('Hack Dev Code mission')
    expect(t('title.review')).toBe('Hack Dev Code gate review')

    await b.fiber.dispose()
    expect(b.entries()).toEqual([])
    expect(t('title.mission')).toBe('title.mission')
  })

  it('keeps the node half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
