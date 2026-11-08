import { describe, expect, it } from 'vitest'
import { withoutInlineThinking } from '../src/stream.ts'

describe('reasoning written into the answer', () => {
  it('removes a leading think section and keeps the answer', () => {
    expect(withoutInlineThinking('<think>\nThe user wants a list.\n</think>\n\nHere is the list.')).toBe('Here is the list.')
    expect(withoutInlineThinking('  <think>only thoughts</think>')).toBe('')
  })

  it('leaves text without a leading think section unchanged', () => {
    expect(withoutInlineThinking('Use <think> tags to mark reasoning.')).toBe('Use <think> tags to mark reasoning.')
    expect(withoutInlineThinking('<think>unfinished')).toBe('<think>unfinished')
  })
})
