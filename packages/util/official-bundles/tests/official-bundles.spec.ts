/** Shipped profile templates, and the offline catalog that does not depend on installed provider packages or registry requests. */

import { describe, expect, it } from 'vitest'
import { OFFICIAL_ON_DEMAND_CATALOG, ON_DEMAND_BUNDLES, PROFILE_TEMPLATES } from '../src/index.ts'

describe('Official on-demand catalog', () => {
  it('offers exactly the two native subagent integrations with offline English metadata', () => {
    expect(ON_DEMAND_BUNDLES).toEqual(['@hackdevcode/dsh-subagent-claude-code', '@hackdevcode/dsh-subagent-codex'])
    expect(OFFICIAL_ON_DEMAND_CATALOG.map(entry => entry.packageName)).toEqual(ON_DEMAND_BUNDLES)
    for (const entry of OFFICIAL_ON_DEMAND_CATALOG) {
      expect(entry.meta.icon).toMatch(/^data:image\/svg\+xml;base64,/)
      for (const text of [entry.meta.title, entry.meta.description]) {
        if (typeof text === 'string') throw new Error('Official metadata requires a localized map')
        expect(text.en).toMatch(/\S/)
        expect(Object.keys(text)).toEqual(['en'])
      }
      expect(entry).not.toHaveProperty('version')
    }
  })
})

describe('Shipped profile templates', () => {
  it('stack each mode bundle on base except the standalone minimal SDK', () => {
    expect(PROFILE_TEMPLATES).toEqual({
      acp: { bundles: ['@hackdevcode/dsh-base', '@hackdevcode/dsh-acp-app'] },
      web: { bundles: ['@hackdevcode/dsh-base', '@hackdevcode/dsh-web-app'] },
      headless: { bundles: ['@hackdevcode/dsh-base', '@hackdevcode/dsh-headless'] },
      sdk: { bundles: ['@hackdevcode/dsh-base', '@hackdevcode/dsh-sdk-app'] },
      'sdk-minimal': { bundles: ['@hackdevcode/dsh-sdk-minimal'] },
    })
  })
})
