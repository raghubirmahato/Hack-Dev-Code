import { describe, expect, it } from 'vitest'
import { reasoningText } from '../src/client/reasoning-text.ts'

describe('reasoning display text', () => {
  it.each([
    '',
    'Ordinary reasoning',
    '\u666e\u901a\u601d\u8003\u6b63\u6587',
    '\n  Original text  \n',
    '<note>Original text</note>',
  ])('preserves ordinary reasoning %j', (text) => {
    expect(reasoningText(text)).toBe(text)
  })
})
