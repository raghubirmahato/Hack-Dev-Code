// @vitest-environment jsdom
/**
 * `<html lang>` tracks the active locale.
 *
 * The served markup declares one language, but the resolved locale may differ
 * (a stored Host preference adopted after activation, or a language pack that
 * registers later), and it changes again whenever the user switches. Assistive
 * technology and browser features read this attribute, so a stale value
 * misreports the document language rather than merely looking untidy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { SlotRegistry } from '@hackdevcode/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@hackdevcode/dsh-client-ui-settings/client'
import { TestRemote } from '@hackdevcode/dsh-client-test-runtime'
import { apply, inject } from '@hackdevcode/dsh-client-locale/client'
import type { LocaleRuntime } from '@hackdevcode/dsh-client-locale/client'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '../src/locale-settings.ts'

/** External language a language-pack plugin would contribute; English is its label. */
const TEST_LANGUAGE = { id: 'xx', label: 'Test language', fallback: 'en' } as const

/** Boot the plugin over a stub Host settings document. */
async function bench(preference?: string) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  let stored = preference
  let revision = 0
  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE,
    schema: LocaleSettingsSchema.toJSON(),
    value: stored === undefined ? {} : { preference: stored },
    autoGenerate: true, applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describeRpc = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { value: string }[]) => {
    stored = ops[0]!.value
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  // The settings transport and the forwarded-event port the plugin injects.
  new TestRemote(ctx, { settings: { describe: describeRpc, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, locale: ctx.get('locale') as LocaleRuntime }
}

const langOf = (): string => document.documentElement.lang

describe('document language', () => {
  beforeEach(() => {
    // The served markup declares a stale language; the plugin must not depend
    // on that value already being correct.
    document.documentElement.lang = 'xx'
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
  })

  afterEach(() => {
    // navigator properties are installed with defineProperty above, so they
    // are removed the same way; nothing here goes through vi.stubGlobal.
    const own = navigator as unknown as Record<string, unknown>
    delete own.languages
    delete own.language
  })

  it('states the resolved locale at activation, not the value the markup shipped', async () => {
    // Only English is registered, so activation says en even though the markup
    // named a language the page no longer ships.
    const { locale } = await bench()
    expect(locale.getLocale().active).toBe('en')
    expect(langOf()).toBe('en')
  })

  it('follows a locale switch in both directions with BCP 47 tags', async () => {
    const { locale } = await bench()
    expect(langOf()).toBe('en')
    locale.addLanguage(TEST_LANGUAGE)
    locale.setLocale('xx')
    expect(langOf()).toBe('xx')
    locale.setLocale('en')
    expect(langOf()).toBe('en')
    locale.setLocale('xx')
    expect(langOf()).toBe('xx')
  })

  it('adopts a stored Host preference whose language registers after activation', async () => {
    // The preference stays pending while its definition is unavailable, then
    // takes effect — including the document language — when it registers.
    const { locale } = await bench('xx')
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('en') })
    locale.addLanguage(TEST_LANGUAGE)
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('xx') })
    await vi.waitFor(() => { expect(langOf()).toBe('xx') })
  })

  it('uses an external locale definition for the document language', async () => {
    const { locale } = await bench()
    locale.addLanguage({ id: 'xx-yy', label: 'Test language (YY)', fallback: 'en' })
    locale.setLocale('xx-yy')
    expect(langOf()).toBe('xx-yy')
  })

  it('does not rewrite the document language for catalog changes with the same active locale', async () => {
    const { locale } = await bench()
    const observer = new MutationObserver(() => {})
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    try {
      const remove = locale.addLanguage(TEST_LANGUAGE)
      expect(observer.takeRecords()).toHaveLength(0)
      locale.setLocale('xx')
      expect(langOf()).toBe('xx')
      expect(observer.takeRecords()).toHaveLength(1)
      // Removing the active definition changes the active locale, so the
      // document follows that change too.
      remove()
      expect(langOf()).toBe('en')
      expect(observer.takeRecords()).toHaveLength(1)
    } finally {
      observer.disconnect()
    }
  })
})
