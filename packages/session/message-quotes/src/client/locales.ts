/** Copy owned by the Quote interaction plugin. */

/** Quote plugin dictionary namespace. */
export const NS = 'messageQuotes'

/** English dictionary and key source. */
export const en = {
  'quote.add': 'Quote text',
} satisfies Record<string, string>

/** Supported Quote interaction copy keys. */
export type MessageQuotesKey = keyof typeof en
