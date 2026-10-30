// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { stubConfigForm, type StubConfigForm } from '@hackdevcode/dsh-client-test-runtime'
import type { LocaleSettings, LocaleSnapshot } from '@hackdevcode/dsh-client-locale/client'
import { en } from '../src/locales/settings.ts'
import { FALLBACK_LOCALE, LocaleRuntime } from '@hackdevcode/dsh-client-locale/client'

/** External language a language-pack plugin would contribute; English is its label. */
const TEST_LANGUAGE = { id: 'xx', label: 'Test language', fallback: 'en' } as const

const make = (host?: StubConfigForm<LocaleSettings>): {
  ctx: Context
  svc: LocaleRuntime
  events: LocaleSnapshot[]
} => {
  const ctx = new Context()
  const events: LocaleSnapshot[] = []
  ctx.on('locale/change', (snapshot) => { events.push(snapshot) })
  return { ctx, svc: new LocaleRuntime(ctx, host?.scope), events }
}

/**
 * A runtime with an external test language registered. The baseline browser
 * prefers it, so it opens provisionally in `xx`; the events the registration
 * itself published are cleared so each spec starts from zero.
 */
const makeExternal = (host?: StubConfigForm<LocaleSettings>): ReturnType<typeof make> => {
  const made = make(host)
  made.svc.addLanguage(TEST_LANGUAGE)
  made.events.length = 0
  return made
}

/**
 * Pin the browser environment a fresh service reads its initial locale from.
 * This package's own specs stub the globals directly instead of using
 * `usePinnedBrowserLanguages` (dsh-client-test-runtime): they need the shapes
 * that helper deliberately cannot express — a missing `languages` list, a
 * list decoupled from `language`, and a non-browser run with no `window`.
 */
const stubLanguages = (...tags: string[]): void => {
  vi.stubGlobal('navigator', { languages: tags, language: tags[0] ?? '' })
}

describe('LocaleRuntime', () => {
  beforeEach(() => {
    // A browser asking for the test language is the baseline these specs
    // assert their `xx` state on.
    stubLanguages('xx-XX')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('checks additional dictionaries against the declared namespace and requires the English baseline', () => {
    const { svc } = make()
    svc.addLanguage(TEST_LANGUAGE)
    const dispose = svc.register('settings.locale', { en })
    svc.setLocale('en')
    expect(svc.bind('settings.locale')('language.title')).toBe('Language')
    dispose()
    expect(svc.bind('settings.locale')('language.title')).toBe('language.title')
    if (false) {
      // @ts-expect-error the English baseline dictionary is required
      svc.register('settings.locale', {})
    }
  })

  it('translates through the active-locale -> en -> key chain', () => {
    const { svc } = makeExternal()
    svc.register('ns', 'xx', { hello: 'Hello from the test language' })
    svc.register('ns', 'en', { hello: 'Hello', onlyEn: 'English only' })
    const t = svc.bind('ns')
    expect(svc.getLocale().active).toBe('xx')
    expect(t('hello')).toBe('Hello from the test language')
    // The active locale misses this key; the en fallback supplies it.
    expect(t('onlyEn')).toBe('English only')
    svc.setLocale('en')
    expect(t('hello')).toBe('Hello')
    expect(t('missing.key')).toBe('missing.key')
  })

  it('falls through to the common vocabulary after the namespace misses (production keys)', () => {
    const { svc } = makeExternal()
    // The shipped common pair is registered by apply; the bench registers it
    // directly to pin the production chain: ns -> common -> en -> key.
    svc.register('common', 'xx', { retry: 'Retry' })
    svc.register('common', 'en', { retry: 'Retry' })
    svc.register('ns', 'en', { own: 'Own' })
    const t = svc.bind('ns')
    expect(t('retry')).toBe('Retry')
    // `xx` is active and `ns` has no xx dictionary at all: the en fallback answers.
    expect(t('own')).toBe('Own')
    svc.setLocale('en')
    expect(t('retry')).toBe('Retry')
    expect(t('own')).toBe('Own')
    // common itself must not recurse: a miss inside common echoes the key.
    // (Wide-string ns hits the untyped bind overload — the typed one rejects
    // unknown keys at compile time, which is the point of the typed registry contract.)
    expect(svc.bind('common' as string)('nope')).toBe('nope')
  })

  it('interpolates {name} params and leaves unknown placeholders intact', () => {
    const { svc } = make()
    svc.register('ns', 'en', { greet: 'Hello, {name}! Visit {n}', partial: '{known} and {unknown}' })
    const t = svc.bind('ns')
    expect(t('greet', { name: 'World', n: 2 })).toBe('Hello, World! Visit 2')
    expect(t('partial', { known: 'A' })).toBe('A and {unknown}')
  })

  it('bind returns a stable per-namespace function identity', () => {
    const { svc } = make()
    expect(svc.bind('a')).toBe(svc.bind('a'))
    expect(svc.bind('a')).not.toBe(svc.bind('b'))
  })

  it('rejects duplicate (ns, locale) and disposer only removes its own dict', () => {
    const { svc } = makeExternal()
    const dispose = svc.register('ns', 'xx', { k: 'v1' })
    expect(() => svc.register('ns', 'XX', { k: 'v2' })).toThrow('already has locale')
    dispose()
    const t = svc.bind('ns')
    expect(t('k')).toBe('k')
    svc.register('ns', 'xx', { k: 'v2' })
    expect(t('k')).toBe('v2')
    dispose()
    expect(t('k')).toBe('v2')
  })

  it('serves the LocaleFace: snapshot revision moves on switch and registration, subscribers fire, unsubscribe stops them', () => {
    const { svc } = makeExternal()
    const seen: number[] = []
    const off = svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
    expect(svc.getSnapshot()).toBe(svc.getLocale())
    const r0 = svc.getSnapshot().revision
    svc.register('ns', 'xx', { k: 'v' })
    expect(svc.getSnapshot().revision).toBe(r0 + 1)
    svc.setLocale('en')
    expect(seen).toEqual([r0 + 1, r0 + 2])
    off()
    svc.setLocale('xx')
    expect(seen).toHaveLength(2)
  })

  it('isolates a throwing subscriber: the rest still see the new revision', () => {
    const { svc } = makeExternal()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: number[] = []
      const r0 = svc.getSnapshot().revision
      svc.subscribe(() => { throw new Error('boom') })
      svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
      svc.setLocale('en')
      expect(seen).toEqual([r0 + 1])
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('register disposer republishes (mounted outlets drop the dead dictionary)', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'xx', { k: 'v' })
    const before = svc.getSnapshot().revision
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
    // Second run hits the idempotent arm: nothing removed, no republish.
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
  })

  it('setLocale writes through the scope and republishes only on a real change', () => {
    const host = stubConfigForm<LocaleSettings>()
    const { svc, events } = makeExternal(host)
    const r0 = svc.getLocale().revision
    svc.setLocale('en')
    expect(svc.getLocale().active).toBe('en')
    expect(host.set).toHaveBeenCalledWith('preference', 'en')
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(svc.getLocale())
    expect(events[0]!.revision).toBe(r0 + 1)
    // Re-selecting the active locale publishes nothing (no subscriber churn)
    // but still writes: the active value may be a provisional browser-derived
    // resolution nothing has stored, and picking it is an explicit choice that
    // must outlive this browser.
    svc.setLocale('en')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledTimes(2)
    expect(host.set).toHaveBeenLastCalledWith('preference', 'en')
  })

  it('persists an explicit pick of the provisional locale, so a shared DSH home agrees', () => {
    // A browser naming no shipped language opens at FALLBACK_LOCALE with
    // nothing stored. Choosing that same language in the menu must become
    // durable, or a different browser sharing the home still opens elsewhere.
    stubLanguages('zz-ZZ')
    const host = stubConfigForm<LocaleSettings>()
    const { svc } = make(host)
    expect(svc.getLocale().active).toBe('en')
    expect(host.set).not.toHaveBeenCalled()
    svc.setLocale('en')
    expect(host.set).toHaveBeenCalledWith('preference', 'en')
  })

  it('setLocale without a host scope stays process-local', () => {
    const { svc, events } = makeExternal()
    svc.setLocale('en')
    expect(svc.getLocale().active).toBe('en')
    expect(events).toHaveLength(1)
  })

  it('throws on unknown locale ids', () => {
    const { svc } = make()
    expect(() => { svc.setLocale('zz') }).toThrow('not registered')
  })

  it('registers an external locale for selection, translation, persistence, and reversible disposal', () => {
    stubLanguages('en-US')
    const host = stubConfigForm<LocaleSettings>()
    const { svc, events } = make(host)
    svc.register('ns', 'en', { hello: 'Hello' })
    svc.register('ns', 'XX', { hello: 'Hello from the test language' })
    const dispose = svc.addLanguage({ id: 'xx', label: 'Test language', fallback: 'EN' })
    expect(svc.getLocale().locales).toContainEqual({ id: 'xx', label: 'Test language', fallback: 'en' })

    svc.setLocale('XX')
    expect(svc.getLocale().active).toBe('xx')
    expect(svc.bind('ns')('hello')).toBe('Hello from the test language')
    expect(host.set).toHaveBeenCalledWith('preference', 'xx')

    dispose()
    expect(svc.getLocale().active).toBe('en')
    expect(svc.getLocale().locales.map(locale => locale.id)).toEqual(['en'])
    expect(svc.bind('ns')('hello')).toBe('Hello')
    const revision = svc.getLocale().revision
    dispose()
    expect(svc.getLocale().revision).toBe(revision)
    expect(events.map(snapshot => snapshot.active)).toEqual(['xx', 'en'])
  })

  it('uses fallback copy until a language dictionary registers later', () => {
    const { svc } = make()
    svc.register('ns', 'en', { hello: 'Hello' })
    svc.addLanguage(TEST_LANGUAGE)
    svc.setLocale('xx')
    expect(svc.bind('ns')('hello')).toBe('Hello')

    const revision = svc.getLocale().revision
    svc.register('ns', 'xx', { hello: 'Hello from the test language' })
    expect(svc.getLocale().revision).toBe(revision + 1)
    expect(svc.bind('ns')('hello')).toBe('Hello from the test language')
  })

  it('rejects duplicate and malformed locale definitions', () => {
    const { svc } = make()
    expect(() => svc.addLanguage({ id: 'EN', label: 'Other English', fallback: 'en' }))
      .toThrow('already registered')
    expect(() => svc.addLanguage({ id: 'bad locale', label: 'Bad', fallback: 'en' }))
      .toThrow('not a BCP 47-style tag')
    expect(() => svc.addLanguage({ id: '123', label: 'Numeric', fallback: 'en' }))
      .toThrow('not a BCP 47-style tag')
    expect(() => svc.addLanguage({ id: 'xx', label: '   ', fallback: 'en' }))
      .toThrow('label must not be empty')
    expect(() => svc.addLanguage({ id: 'xx', label: 'Test language', fallback: 'bad tag' }))
      .toThrow('locale fallback')
    expect(() => svc.addLanguage({ id: 'xx', label: 'Test language', fallback: 'zz' }))
      .toThrow('not registered')
  })

  it('rejects malformed locale ids before dictionary registration', () => {
    const { svc } = make()
    expect(() => svc.register('ns', 'bad locale', { hello: 'Bad' }))
      .toThrow('not a BCP 47-style tag')
    expect(() => svc.register('ns', '123', { hello: 'Numeric' }))
      .toThrow('not a BCP 47-style tag')
    expect(svc.bind('ns')('hello')).toBe('hello')
  })

  it('walks each language fallback recursively for every dictionary key', () => {
    const { svc } = make()
    svc.register('ns', 'en', { base: 'English', shared: 'English shared' })
    svc.register('ns', 'xx', { shared: 'Test shared' })
    svc.register('ns', 'xx-yy', { local: 'Regional test local' })
    svc.register('common', 'en', { commonBase: 'Common English' })
    svc.register('common', 'xx', { commonShared: 'Common test shared' })
    svc.addLanguage(TEST_LANGUAGE)
    svc.addLanguage({ id: 'xx-yy', label: 'Test language (YY)', fallback: 'xx' })
    svc.setLocale('xx-yy')
    const t = svc.bind('ns')
    expect(t('local')).toBe('Regional test local')
    expect(t('shared')).toBe('Test shared')
    expect(t('base')).toBe('English')
    expect(t('commonShared')).toBe('Common test shared')
    expect(t('commonBase')).toBe('Common English')
  })

  it('rejects a fallback cycle exposed by re-registering an unloaded language', () => {
    const { svc } = make()
    svc.register('ns', 'en', { base: 'English' })
    const removeTestLanguage = svc.addLanguage(TEST_LANGUAGE)
    svc.addLanguage({ id: 'xx-yy', label: 'Test language (YY)', fallback: 'xx' })
    svc.setLocale('xx-yy')
    removeTestLanguage()
    expect(svc.bind('ns')('base')).toBe('English')
    expect(() => svc.addLanguage({ id: 'zz', label: 'Another test language', fallback: 'xx-yy' }))
      .toThrow('locale fallback "xx" is not registered')
    expect(() => svc.addLanguage({ id: 'xx', label: 'Test language', fallback: 'xx-yy' }))
      .toThrow('fallback cycle')
    expect(svc.getLocale().locales.map(locale => locale.id)).toEqual(['en', 'xx-yy'])
  })

  it('adopts a saved external locale when its definition registers later', () => {
    stubLanguages('en-US')
    const host = stubConfigForm<LocaleSettings>()
    const { svc, events } = make(host)
    host.publish({ status: 'ready', value: { preference: 'xx' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('en')

    svc.addLanguage(TEST_LANGUAGE)
    expect(svc.getLocale().active).toBe('xx')
    expect(events.map(snapshot => snapshot.active)).toEqual(['xx'])
    expect(host.set).not.toHaveBeenCalled()
  })

  it('adopts a Host preference over the browser language without writing it back', () => {
    const host = stubConfigForm<LocaleSettings>()
    const { svc, events } = makeExternal(host)
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('en')
    expect(events).toHaveLength(1)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { preference: 'en' }, revision: 2 })
    expect(events).toHaveLength(1)
  })

  it('an absent Host preference returns to the browser-derived locale', () => {
    const host = stubConfigForm<LocaleSettings>()
    const { svc } = makeExternal(host)
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('en')
    host.publish({ value: {}, revision: 2 })
    expect(svc.getLocale().active).toBe('xx')
  })

  it('adopts a section already standing at construction and releases its subscription on dispose', async () => {
    const host = stubConfigForm<LocaleSettings>()
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    const { ctx, svc } = make(host)
    expect(svc.getLocale().active).toBe('en')
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('opens provisionally in the browser language, matching regional variants on their primary subtag', () => {
    // The bare primary subtag matches a registered language.
    stubLanguages('xx-XX')
    expect(makeExternal().svc.getLocale().active).toBe('xx')
    // A regional definition matches its browser tag exactly before the wider one.
    stubLanguages('XX-YY')
    const regional = make()
    regional.svc.addLanguage({ id: 'xx-yy', label: 'Test language (YY)', fallback: 'en' })
    expect(regional.svc.getLocale().active).toBe('xx-yy')
    // An unshipped language walks the list to the first one this app ships.
    stubLanguages('zz-ZZ', 'en-US')
    expect(make().svc.getLocale().active).toBe('en')
    // Only `language` populated: an empty ordered list, and a host that
    // exposes no `languages` property at all.
    vi.stubGlobal('navigator', { languages: [], language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    vi.stubGlobal('navigator', { language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    // No shipped language anywhere in the browser's preferences: en is the
    // product default rather than an arbitrary near-match.
    stubLanguages('zz-ZZ')
    expect(make().svc.getLocale().active).toBe('en')
  })

  it('re-evaluates browser languages as external definitions register and unload', () => {
    stubLanguages('xx-XX', 'en-US')
    const { svc } = make()
    expect(svc.getLocale().active).toBe('en')
    const dispose = svc.addLanguage(TEST_LANGUAGE)
    expect(svc.getLocale().active).toBe('xx')
    dispose()
    expect(svc.getLocale().active).toBe('en')
  })

  it('runs outside a browser (node boots): the default decides and the machine language does not', () => {
    vi.stubGlobal('window', undefined)
    // Node exposes its own global navigator; without a window it must not
    // reach the resolution at all.
    stubLanguages('xx-XX')
    const { svc } = makeExternal()
    expect(svc.getLocale().active).toBe('en')
    svc.setLocale('xx')
    expect(svc.getLocale().active).toBe('xx')
  })

  it('lets an explicit in-process preference replace the browser-derived value', () => {
    stubLanguages('en-US')
    const { svc } = makeExternal()
    svc.setLocale('xx')
    expect(svc.getLocale().active).toBe('xx')
  })

  it('serves English as both the opening locale and the dictionary fallback', () => {
    // One constant covers both jobs: the locale the UI opens in with no usable
    // browser signal, and the dictionary backing a key the active locale
    // misses.
    expect(FALLBACK_LOCALE).toBe('en')
    vi.stubGlobal('window', undefined)
    const { svc } = makeExternal()
    // A key present only in en resolves for an xx reader through the fallback.
    svc.register('ns', 'xx', {})
    svc.register('ns', 'en', { onlyEn: 'English only' })
    svc.setLocale('xx')
    expect(svc.getLocale().active).toBe('xx')
    expect(svc.bind('ns')('onlyEn')).toBe('English only')
    // The reverse does not resolve: an xx-only key is unreachable from en, so
    // the key itself surfaces (fail loud) rather than silently rendering xx.
    svc.register('ns2', 'xx', { onlyXx: 'Test language only' })
    svc.register('ns2', 'en', {})
    svc.setLocale('en')
    expect(svc.bind('ns2')('onlyXx')).toBe('onlyXx')
  })

  it('starts with exactly the one shipped locale', () => {
    const { svc } = make()
    expect(svc.getLocale().locales).toEqual([
      { id: 'en', label: 'English' },
    ])
  })
})
