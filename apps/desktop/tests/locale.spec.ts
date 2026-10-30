import { describe, expect, it } from 'vitest'
import { en, formatDesktopMessage, resolveDesktopLocale, resolveDesktopStartupLocale } from '../src/locale.ts'

describe('desktop locale dictionaries', () => {
  it('resolves every requested language to the English dictionary', () => {
    expect(resolveDesktopLocale('en-US')).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopLocale('JA-jp')).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopLocale('zh-Hans-CN')).toEqual({ id: 'en', messages: en })
    expect(resolveDesktopLocale('it-IT').messages).toEqual(en)
  })

  it('formats named values without consuming unknown placeholders', () => {
    expect(formatDesktopMessage('{name}@{version} {missing}', { name: 'plugin', version: '1.2.3' }))
      .toBe('plugin@1.2.3 {missing}')
  })

  it('uses English for the saved preference and every system language', () => {
    expect(resolveDesktopStartupLocale('ja', ['en-US']).id).toBe('en')
    expect(resolveDesktopStartupLocale('EN', ['ja-JP']).id).toBe('en')
    expect(resolveDesktopStartupLocale(null, ['zh-CN', 'ja-JP', 'en-US']).id).toBe('en')
    expect(resolveDesktopStartupLocale(null, ['en-US']).messages).toEqual(en)
    expect(resolveDesktopStartupLocale(null, []).id).toBe('en')
  })
})
