/** The Web bundle's Office rows retain independent configuration and Session file authorization. */
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@hackdevcode/cordis'
import Loader from '@hackdevcode/cordis-plugin-loader'
import Include, { applyEntryPatches } from '@hackdevcode/cordis-plugin-include'
import { loadOverlayPatches } from '@hackdevcode/dsh-app-boot'
import WorkspaceFiles, { type WorkspaceFileScope } from '@hackdevcode/dsh-api-workspace-files'
import OfficeKit from '@hackdevcode/dsh-office-kit'
import * as DocumentPreview from '@hackdevcode/dsh-client-ui-sidebar-documentpreview'
import type { IndexInjection, WebServer } from '@hackdevcode/dsh-host-webserver'
import SessionStore, { type SessionId } from '@hackdevcode/dsh-session'
import SessionProjectionRegistry from '@hackdevcode/dsh-session-projection'
import SandboxPolicyService from '@hackdevcode/dsh-sandbox-policy'
import LocalFileSystem from '@hackdevcode/dsh-fs-local'
import { FsError } from '@hackdevcode/dsh-fs'
import TypertRegistry from '@hackdevcode/dsh-typert-registry'
import type { Converter, ConverterOptions } from '@deepseek-ai/libreoffice-kit'
import { expect, it, onTestFinished, vi } from 'vitest'
import { brandString } from '@hackdevcode/dsh-brand'

/** The Peer an index render speaks for; this listener reads no field of it. */
const PAGE_PEER = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]

const kit = vi.hoisted(() => ({ create: vi.fn<(options?: ConverterOptions) => Promise<Converter>>() }))
vi.mock('@deepseek-ai/libreoffice-kit', () => ({ createConverter: kit.create }))

it('loads the shipped Office rows with separately patched settings and authorized PDF output', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-office-')))
  const outputDirectory = await mkdtemp(join(tmpdir(), 'dsh-web-office-outputs-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally {
      vi.restoreAllMocks()
      await rm(directory, { recursive: true, force: true })
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })
  const configPath = join(directory, 'cordis.yml')
  const expectedRows = {
    'office-kit': '@hackdevcode/dsh-office-kit',
    'ui-sidebar-documentpreview': '@hackdevcode/dsh-client-ui-sidebar-documentpreview',
  }
  const rows = loadOverlayPatches('web-office-test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id !== undefined && Object.hasOwn(expectedRows, row.id))
  expect(rows.map(row => [row.id, row.name])).toEqual(Object.entries(expectedRows))
  const providerConfig = { maxInputBytes: 4096, maxConcurrentConversions: 1, fontFallbacks: [['Missing Serif', 'Available Serif']], outputDirectory }
  const clientConfig = DocumentPreview.Config({ office: { maxCachedEntries: 3, maxCachedBytes: 8192 } })
  const configured = applyEntryPatches(rows, [
    { id: 'office-kit', config: providerConfig },
    { id: 'ui-sidebar-documentpreview', config: clientConfig },
  ], (message) => { throw new Error(message) })
  expect(configured.find(row => row.id === 'ui-sidebar-documentpreview')!.config).toEqual(clientConfig)
  await writeFile(configPath, JSON.stringify([
    { name: '@hackdevcode/dsh-session' },
    { name: '@hackdevcode/dsh-session-projection' },
    { name: '@hackdevcode/dsh-sandbox-policy', config: { workspaceRoot: directory } },
    { name: '@hackdevcode/dsh-fs-local', config: { cwd: directory } },
    { name: '@hackdevcode/dsh-typert-registry' },
    { name: '@hackdevcode/dsh-api-workspace-files', config: { maxFileBytes: 1 } },
    ...configured,
  ]))
  const pdf = Buffer.from('%PDF-1.7\nLoader preview\n%%EOF\n')
  const render = vi.fn<Converter['render']>().mockImplementation(async ({ inputPath, outputPath }) => {
    expect(await readFile(inputPath)).toEqual(Buffer.from('authorized OOXML'))
    await writeFile(outputPath, pdf)
    return { backend: 'native', missingFonts: ['Missing Serif'] }
  })
  kit.create.mockReset().mockResolvedValue({
    backend: 'native', render, dispose: async () => {},
    renderImages: vi.fn<Converter['renderImages']>().mockRejectedValue(new Error('Unexpected Converter.renderImages call')),
    convert: vi.fn<Converter['convert']>().mockRejectedValue(new Error('Unexpected Converter.convert call')),
    recalculate: vi.fn<Converter['recalculate']>().mockRejectedValue(new Error('Unexpected Converter.recalculate call')),
  })
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // Loader's native imports must share the test's source-plane Service classes.
  const modules = new Map<string, unknown>([
    ['@hackdevcode/dsh-session', SessionStore],
    ['@hackdevcode/dsh-session-projection', SessionProjectionRegistry],
    ['@hackdevcode/dsh-sandbox-policy', SandboxPolicyService],
    ['@hackdevcode/dsh-fs-local', LocalFileSystem],
    ['@hackdevcode/dsh-typert-registry', TypertRegistry],
    ['@hackdevcode/dsh-api-workspace-files', WorkspaceFiles],
    ['@hackdevcode/dsh-office-kit', OfficeKit],
    ['@hackdevcode/dsh-client-ui-sidebar-documentpreview', DocumentPreview],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const entries = new Map([...ctx.loader.entries()].map(entry => [entry.options.id, entry]))
  for (const row of configured) await entries.get(row.id)!.fiber!.await()
  expect(ctx.officeKit.outputDirectory).toBe(outputDirectory)
  const injections: IndexInjection[] = []
  ctx.emit('webserver/index-inject', injections, PAGE_PEER)
  expect(injections).toEqual([
    { kind: 'global', name: '__DSH_DOCUMENT_PREVIEW_CONFIG__', value: clientConfig },
  ])

  const id = brandString<SessionId>('office-loader')
  const session = ctx.sessions.create(id, { meta: { cwd: directory } })
  const lookup = ctx.typert.lookups.get('workspaceFileScope')!
  const scope = await lookup.resolve(id) as WorkspaceFileScope | undefined
  if (scope === undefined) throw new Error('Expected the Session workspace scope')
  expect(await lookup.resolve(brandString<SessionId>('missing'))).toBeUndefined()
  const sourcePath = join(directory, 'report.docx')
  await writeFile(sourcePath, 'authorized OOXML')
  const signal = new AbortController().signal
  const version = (await ctx.workspaceFiles.stat(scope, 'report.docx', signal)).version
  const before = session.seq
  const result = await ctx.officeKit.render(scope, 'report.docx', 'foreground', signal)
  expect(result).toEqual({ absolutePath: sourcePath, version, offset: 0, eof: true, bytes: pdf.length,
    data: Uint8Array.from(pdf), missingFonts: ['Missing Serif'], generation: ctx.officeKit.generation })
  const readAgain = vi.spyOn(ctx.fs, 'readBytes')
  expect(await ctx.officeKit.render(scope, 'report.docx', 'foreground', signal)).toEqual(result)
  expect(readAgain).not.toHaveBeenCalled()
  expect(await readFile(sourcePath, 'utf8')).toBe('authorized OOXML')
  expect(session.seq).toBe(before)
  expect(ctx.get('agents')).toBeUndefined()
  const { maxConcurrentConversions: _count, outputDirectory: _outputs, ...kitOptions } = providerConfig
  expect(kit.create).toHaveBeenCalledWith(expect.objectContaining(kitOptions))
  await expect(ctx.officeKit.render(scope, 'missing.docx', 'foreground', signal))
    .rejects.toMatchObject({ code: 'workspace-file/not-found' })
  const refusal = new FsError('read refused', 'FS_SANDBOX_DENIED')
  vi.spyOn(ctx.fs, 'stat').mockRejectedValueOnce(refusal)
  await expect(ctx.officeKit.render(scope, 'report.docx', 'foreground', signal)).rejects.toBe(refusal)
  if (process.platform !== 'win32') {
    await symlink(sourcePath, join(directory, 'link.docx'))
    await expect(ctx.officeKit.render(scope, 'link.docx', 'foreground', signal))
      .rejects.toMatchObject({ code: 'workspace-file/not-regular-file' })
  }
  expect(render).toHaveBeenCalledOnce()
})
