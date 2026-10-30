import { Context } from '@hackdevcode/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  Config, apply,
} from '@hackdevcode/dsh-client-locale'


describe('locale host', () => {
  it('registers an open locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({})
    await configuration.update({ preference: 'en' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: 'en' })
    await configuration.update({ preference: 'xx-YY' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({ preference: 'xx-YY' })
    await expect(configuration.update({ preference: 'bad locale' })).rejects.toThrow()
    await expect(configuration.update({ preference: '123' })).rejects.toThrow()
    await fiber.dispose()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
