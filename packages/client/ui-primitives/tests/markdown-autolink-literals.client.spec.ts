import type { Paragraph, Root } from 'mdast'
import { describe, expect, it } from 'vitest'
import { parseGfm, parseGfmWithMath } from '../src/markdown/parse.ts'

/** Each phrasing child as a link destination, its literal text, or its type. */
function phrasing(root: Root): unknown[] {
  return (root.children[0] as Paragraph).children.map(node =>
    node.type === 'link' ? { link: node.url } : node.type === 'text' ? node.value : node.type)
}

describe.each([parseGfm, parseGfmWithMath])('autolink literals in %o', (parse) => {
  it('end before non-ASCII punctuation', () => {
    expect(phrasing(parse('\u5de5\u4f5c\u53f0\u8fd8\u5728 http://127.0.0.1:8790/\u3002\u5efa\u8bae\u5148\u5f69\u6392\uff1b\u5982\u679c\u8d85\u8fc7 18 \u5206\u949f'))).toEqual(
      ['\u5de5\u4f5c\u53f0\u8fd8\u5728 ', { link: 'http://127.0.0.1:8790/' }, '\u3002\u5efa\u8bae\u5148\u5f69\u6392\uff1b\u5982\u679c\u8d85\u8fc7 18 \u5206\u949f'])
    expect(phrasing(parse('\u89c1 https://example.com\uff0c\u7136\u540e'))).toEqual(['\u89c1 ', { link: 'https://example.com' }, '\uff0c\u7136\u540e'])
    expect(phrasing(parse('\uff08https://example.com/a?b=1\uff09'))).toEqual(['\uff08', { link: 'https://example.com/a?b=1' }, '\uff09'])
    expect(phrasing(parse('\u89c1 www.example.com/a.\u3002'))).toEqual(['\u89c1 ', { link: 'http://www.example.com/a' }, '.\u3002'])
    expect(phrasing(parse('https://a.com/x\u3001https://b.com/y\u3002'))).toEqual(
      [{ link: 'https://a.com/x' }, '\u3001', { link: 'https://b.com/y' }, '\u3002'])
    expect(phrasing(parse('\uff08www.example.com/a\uff09\u540e'))).toEqual(['\uff08', { link: 'http://www.example.com/a' }, '\uff09\u540e'])
    expect(phrasing(parse('😀\u53c2\u89c1\uff08https://example.com/a_(b)\uff09\uff0c\u518d\u770b'))).toEqual(
      ['😀\u53c2\u89c1\uff08', { link: 'https://example.com/a_(b)' }, '\uff09\uff0c\u518d\u770b'])
    const qq = 'https://qm.qq.com/cgi-bin/qm/qr?k=Abc%2BDef%2Fghi%3D%3D&authKey=tok%252Fvalue%253D&noverify=0'
    expect(phrasing(parse(`\u52a0\u5165\u7fa4\u804a\uff1a${qq}\uff0c\u6b22\u8fce\u3002`))).toEqual(['\u52a0\u5165\u7fa4\u804a\uff1a', { link: qq }, '\uff0c\u6b22\u8fce\u3002'])
    // After an unbalanced `[`, the literal comes from the text transform instead of the tokenizer.
    // Its case-insensitive Unicode regex must keep ASCII `s` and `k`, which fold with `ſ` and `K`.
    expect(phrasing(parse('[x https://example.com/docs/Kit?s=K\u3002\u540e'))).toEqual(
      ['[x ', { link: 'https://example.com/docs/Kit?s=K' }, '\u3002\u540e'])
    for (const prefix of ['', '[x ']) {
      expect(phrasing(parse(`${prefix}https://example.com/a😀\u4e0b\u4e00\u53e5`))).toEqual(
        [prefix, { link: 'https://example.com/a' }, '😀\u4e0b\u4e00\u53e5'].filter(part => part !== ''))
      expect(phrasing(parse(`${prefix}https://example.com/a\u3000\u4e0b\u4e00\u53e5`))).toEqual(
        [prefix, { link: 'https://example.com/a' }, '\u3000\u4e0b\u4e00\u53e5'].filter(part => part !== ''))
      expect(phrasing(parse(`${prefix}https://example.com/a𝒳b ok`))).toEqual(
        [prefix, { link: 'https://example.com/a𝒳b' }, ' ok'].filter(part => part !== ''))
    }
    // Unencoded non-ASCII punctuation inside a URL also ends it.
    expect(phrasing(parse('https://zh.wikipedia.org/wiki/\u4e2d\u6587\uff08\u6d88\u6b67\u4e49\uff09'))).toEqual(
      [{ link: 'https://zh.wikipedia.org/wiki/\u4e2d\u6587' }, '\uff08\u6d88\u6b67\u4e49\uff09'])
  })

  it('leave following inline Markdown to the inline grammar', () => {
    expect(phrasing(parse('https://example.com/a\uff0c**\u4e0b\u4e00\u53e5**'))).toEqual([{ link: 'https://example.com/a' }, '\uff0c', 'strong'])
    expect((parse('\u9884\u89c8\u5728 **https://example.com/a**\uff08PR #1\uff09').children[0] as Paragraph).children).toMatchObject([
      { value: '\u9884\u89c8\u5728 ' },
      { type: 'strong', children: [{ type: 'link', url: 'https://example.com/a' }] },
      { value: '\uff08PR #1\uff09' },
    ])
  })

  it('keep letters, ASCII punctuation, and authored links', () => {
    expect(phrasing(parse('https://zh.wikipedia.org/wiki/\u4e2d\u6587_(\u6d88\u6b67\u4e49)?q=a,b ok'))).toEqual(
      [{ link: 'https://zh.wikipedia.org/wiki/\u4e2d\u6587_(\u6d88\u6b67\u4e49)?q=a,b' }, ' ok'])
    expect(phrasing(parse('<https://example.com/\u3002a>'))).toEqual([{ link: 'https://example.com/\u3002a' }])
    expect(phrasing(parse('[link](https://example.com/\u3002a)'))).toEqual([{ link: 'https://example.com/\u3002a' }])
  })
})
