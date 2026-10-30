/** Explicit patch overlays bypass bundle admission and must not import an absent native provider. */
import { readFile } from 'node:fs/promises'
import { Context } from '@hackdevcode/cordis'
import Loader, { interpolate, type EntryOptions } from '@hackdevcode/cordis-plugin-loader'
import { entryListSchema } from '@hackdevcode/cordis-plugin-include'
import { load } from 'js-yaml'
import { expect, it, vi } from 'vitest'

it.each(['darwin', 'win32', 'linux'])('loads the exported patch directly on %s and imports the native provider only on Darwin', async (platform) => {
  const patch = load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), {
    schema: entryListSchema,
  }) as { insert: EntryOptions[] }[]
  const ctx = new Context()
  await ctx.plugin(Loader)
  if (!ctx.loader.internal) throw new Error('Loader module importer is unavailable')
  const imported = vi.spyOn(ctx.loader.internal, 'import').mockImplementation(async (name: string) => {
    if (platform !== 'darwin' && name === '@hackdevcode/dsh-experimental-cua-macos') {
      throw new Error('native provider is absent from this installation')
    }
    return { name, apply: () => {} }
  })
  try {
    for (const row of patch[0]!.insert) {
      await ctx.loader.create({ ...row, disabled: Boolean(interpolate({ process: { platform } }, row.disabled)) })
    }
    await ctx.loader.await()
    const imports = imported.mock.calls.map(call => call[0])
    expect(imports).toContain('@hackdevcode/dsh-cua')
    expect(imports).toContain('@hackdevcode/dsh-computer-use')
    expect(imports.includes('@hackdevcode/dsh-experimental-cua-macos')).toBe(platform === 'darwin')
  } finally {
    await ctx.fiber.dispose()
    imported.mockRestore()
  }
})
