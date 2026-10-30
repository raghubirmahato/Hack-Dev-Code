/** Platform client identity headers derived from one call's metadata. */
import { expect, it } from 'vitest'
import { platformClientHeaders } from '../src/index.ts'

it.each([
  ['darwin', 'desktop-mac'], ['win32', 'desktop-win'], [null, 'web'],
] as const)('maps %s to %s and leaves the bundle ID empty', (platform, expected) => {
  expect(platformClientHeaders(platform, { version: '1.2.3', locale: 'en-GB', timezoneOffsetSeconds: 32_400 })).toEqual({
    'x-client-bundle-id': '', 'x-client-platform': expected, 'x-client-version': '1.2.3',
    'x-client-locale': 'en_US', 'x-client-timezone-offset': '32400',
  })
})

it('sends the English Platform locale for every UI language', () => {
  const locale = (value: string): string | undefined =>
    platformClientHeaders(null, { version: 'v', locale: value, timezoneOffsetSeconds: 0 })['x-client-locale']
  for (const value of ['xx', 'xx-XX', 'XX_xx', 'en', 'en-US', 'zz-ZZ', 'English', '']) expect(locale(value)).toBe('en_US')
})
