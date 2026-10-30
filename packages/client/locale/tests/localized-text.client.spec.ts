import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { LocaleRuntime } from '../src/client/index.ts'

function make() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return { ctx, locale: new LocaleRuntime(ctx) }
}

describe('package text resolution', () => {
  it('keeps strings verbatim without common lookup or interpolation', () => {
    const { ctx, locale } = make()
    ctx.effect(() => locale.addLanguage({ id: 'xx', label: 'Test language', fallback: 'en' }), 'test: test language')
    ctx.effect(() => locale.register('common', 'xx', { retry: 'Retry' }), 'test: common dictionary')
    locale.setLocale('xx')

    expect(locale.resolveText('retry')).toBe('retry')
    expect(locale.resolveText('Hello, {name}')).toBe('Hello, {name}')
    expect(locale.resolveText('')).toBe('')
    expect(locale.resolveText({ en: 'retry' })).toBe('retry')
  })

  it('resolves each field in the current locale without registering map languages', () => {
    const { ctx, locale } = make()
    const title = { en: 'Tools', xx: 'Tools from the test language' }
    ctx.effect(() => locale.addLanguage({ id: 'xx', label: 'Test language', fallback: 'en' }), 'test: test language')
    locale.setLocale('xx')
    const snapshot = locale.getSnapshot()

    expect(locale.resolveText(title)).toBe('Tools from the test language')
    expect(locale.resolveText({ en: 'English description' })).toBe('English description')
    expect(locale.resolveText({ en: 'Fallback', xx: '' })).toBe('')
    expect(locale.getSnapshot()).toBe(snapshot)
    expect(snapshot.locales.map(item => item.id)).toEqual(['en', 'xx'])

    locale.setLocale('en')
    expect(locale.resolveText(title)).toBe('Tools')
  })

  it('walks registered regional fallbacks using lowercase map keys', () => {
    const { ctx, locale } = make()
    ctx.effect(() => locale.addLanguage({ id: 'xx', label: 'Test language', fallback: 'en' }), 'test: test language')
    ctx.effect(() => locale.addLanguage({ id: 'xx-yy', label: 'Test language (YY)', fallback: 'xx' }), 'test: regional test language')
    locale.setLocale('XX-YY')

    expect(locale.resolveText({ en: 'Tools', xx: 'Test tools', 'xx-yy': 'Regional test tools' })).toBe('Regional test tools')
    expect(locale.resolveText({ en: 'Tools', xx: 'Test tools' })).toBe('Test tools')
    expect(locale.resolveText({ en: 'Tools' })).toBe('Tools')
  })

  it('uses English across an unloaded fallback and follows its replacement', () => {
    const { ctx, locale } = make()
    const removeTestLanguage = locale.addLanguage({ id: 'xx', label: 'Test language', fallback: 'en' })
    ctx.effect(() => removeTestLanguage, 'test: test language')
    ctx.effect(() => locale.addLanguage({ id: 'xx-yy', label: 'Test language (YY)', fallback: 'xx' }), 'test: regional test language')
    locale.setLocale('xx-yy')
    const text = { en: 'Tools', xx: 'Test tools' }

    expect(locale.resolveText(text)).toBe('Test tools')
    removeTestLanguage()
    expect(locale.resolveText(text)).toBe('Tools')
    ctx.effect(() => locale.addLanguage({ id: 'xx', label: 'Test language', fallback: 'en' }), 'test: replacement test language')
    expect(locale.resolveText(text)).toBe('Test tools')
  })
})
