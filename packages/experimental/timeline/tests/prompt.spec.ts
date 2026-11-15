import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { parseSummary } from '../src/prompt.ts'

describe('compact plain-language report output', () => {
  const response = (progress: string[]) => JSON.stringify({ progress, uncertainties: [], userActions: [] })
  it('accepts short English and Chinese output and preserves empty optional groups', () => {
    expect(
      parseSummary(
        response([
          'Opening another plan now keeps the selected task.',
          'Next, check that older plans still open.',
        ]),
        'en',
      ).progress,
    ).toHaveLength(2)
    expect(
      parseSummary(response(['\u5207\u6362\u8ba1\u5212\u540e\uff0c\u6240\u9009\u4efb\u52a1\u4ecd\u4f1a\u4fdd\u7559\u3002', '\u4e0b\u4e00\u6b65\u68c0\u67e5\u65e7\u8ba1\u5212\u80fd\u5426\u6b63\u5e38\u6253\u5f00\u3002']), 'zh-CN')
        .uncertainties,
    ).toEqual([])
  })
  it('rejects long sentences, code and more than four progress entries', () => {
    expect(() => parseSummary(response(['Ready.', 'x'.repeat(321)]), 'en')).toThrow()
    expect(() => parseSummary(response(['Changed `activeTreeId`.']), 'en')).toThrow()
    expect(() => parseSummary(response(['The guide is ready.\nCheck it now.']), 'en')).toThrow()
    expect(() => parseSummary(response(['\u4e00'.repeat(161)]), 'zh-CN')).toThrow()
    expect(() => parseSummary(response(['One.', 'Two.', 'Three.', 'Four.', 'Five.']), 'en')).toThrow()
    expect(() => parseSummary(response(['x'.repeat(321)]), 'en')).toThrow()
  })
  it('rejects an oversized malformed report without expanding its repair diagnostics per entry', () => {
    try {
      parseSummary(
        JSON.stringify({ progress: Array(20000).fill(null), uncertainties: [], userActions: [] }),
        'en',
      )
    } catch (error: unknown) {
      if (!(error instanceof ZodError)) throw error
      expect(error.issues.length).toBeLessThanOrEqual(4)
      expect(error.message.length).toBeLessThan(4096)
      return
    }
    throw new Error('An oversized malformed report must fail validation')
  })
  it('keeps bounded useful sentences without a format retry for a small word-count overrun', () => {
    const progress = [
      'The restart check passed.',
      'The saved plan and all its completed tasks were still present when the user opened the same session after a restart.',
    ]
    expect(progress[1]?.split(' ').length).toBeGreaterThan(20)
    expect(parseSummary(response(progress), 'en').progress).toEqual(progress)
    expect(parseSummary(response(['\u4e00'.repeat(51)]), 'zh-CN').progress).toHaveLength(1)
    expect(parseSummary(response(['x'.repeat(101)]), 'en').progress).toHaveLength(1)
    expect(parseSummary(response(['The guide is ready. Check it now.']), 'en').progress).toHaveLength(1)
    expect(parseSummary(response(['\u6307\u5357\u5df2\u5b8c\u6210\u3002\u8bf7\u67e5\u770b\u3002']), 'zh-CN').progress).toHaveLength(1)
  })
  it('keeps a short preview and accepts supporting evidence, limits and a decided next step', () => {
    const progress = [
      'The planner keeps saved changes after restart.',
      'A restart check preserved the edited plan and completed work.',
      'Recovery after an interrupted save still needs a check.',
      'Next, test that interruption before the release.',
    ]
    expect(parseSummary(response(progress), 'en').progress).toEqual(progress)
  })
  it('keeps concise output rules in the added languages, including unspaced Japanese sentences', () => {
    for (const [language, text] of [
      ['ja', '\u5225\u306e\u8a08\u753b\u3092\u958b\u3044\u3066\u3082\u3001\u9078\u629e\u3057\u305f\u30bf\u30b9\u30af\u304c\u4fdd\u6301\u3055\u308c\u307e\u3059\u3002'],
      ['es', 'El plan conserva la tarea seleccionada.'],
      ['fr', 'Le plan conserve la tâche sélectionnée.'],
      ['de', 'Der Plan behält die ausgewählte Aufgabe.'],
      ['ru', '\u041f\u043b\u0430\u043d \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u0442 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u0443\u044e \u0437\u0430\u0434\u0430\u0447\u0443.'],
      ['pt', 'O plano mantém a tarefa selecionada.'],
    ] as const)
      expect(parseSummary(response([text]), language).progress).toEqual([text])
    expect(() => parseSummary(response(['\u3042'.repeat(161)]), 'ja')).toThrow()
    expect(parseSummary(response(['\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002\u6b21\u3092\u78ba\u8a8d\u3057\u307e\u3059\u3002']), 'ja').progress).toHaveLength(1)
    expect(() =>
      parseSummary(response([Array.from({ length: 41 }, () => 'palavra').join(' ')]), 'pt'),
    ).toThrow()
  })
})
