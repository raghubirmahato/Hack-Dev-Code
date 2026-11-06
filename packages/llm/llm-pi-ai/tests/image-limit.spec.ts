/** A provider's per-request image limit sheds the oldest images and resends instead of failing the step. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context, Service } from '@hackdevcode/cordis'
import { AttachmentId, AttachmentStore, ImageVariantId } from '@hackdevcode/dsh-attachment'
import type {
  ImageAttachmentLimits, ImageAttachmentRef, ImageRequestTarget, RequestImageAttachment, SaveImageAttachment, StoredImageAttachment,
} from '@hackdevcode/dsh-attachment'
import LlmRuntime, { createUserMessage } from '@hackdevcode/dsh-llm'
import * as LlmPiAi from '@hackdevcode/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

const HOST_IMAGE_PATH = '/host/.dsh/attachments/objects/aa/object'
const MODEL_IMAGE_PATH = '/model/.dsh/attachments/objects/aa/object'
const ref: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
}

class MappedFileSystem extends Service {
  constructor(ctx: Context) { super(ctx, 'fs') }
  processPathFromHostPath(hostPath: string): string | undefined { return hostPath === HOST_IMAGE_PATH ? MODEL_IMAGE_PATH : undefined }
}

class Store extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1, maxImagePixels: 1, maxImageDimension: 2000, mediaTypes: ['image/png'],
  }
  validateImage(_input: SaveImageAttachment): Promise<void> { return Promise.reject(new Error('not used')) }
  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> { return Promise.reject(new Error('not used')) }
  readImage(value: ImageAttachmentRef): Promise<StoredImageAttachment> { return Promise.resolve({ ref: value, data: Uint8Array.of(1) }) }
  override imageHostPath(_ref: ImageAttachmentRef): string { return HOST_IMAGE_PATH }
  override readImageRequest(value: ImageAttachmentRef, _policy: ImageRequestTarget): Promise<RequestImageAttachment> {
    return Promise.resolve({
      variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`), attachment: value, data: Uint8Array.of(1), mediaType: value.mediaType,
      bytes: 1, width: value.width, height: value.height, depth: 'uchar', space: 'srgb', hasAlpha: true,
    })
  }
}

it('drops the oldest images and sends the request again after an image-limit refusal', async () => {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const server = await mockServer([
    { status: 400, body: JSON.stringify({ error: { message: 'Too many images in request: the limit is 1' } }) },
    { status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) },
  ])
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } } })
  await ctx.plugin(Store)
  await ctx.plugin(MappedFileSystem)
  const message = () => createUserMessage({ content: [{ type: 'image', attachment: ref }], source: { kind: 'user' } })

  await assemble(ctx, { provider: 'openai', model: 'gpt-4.1', messages: [message(), message()] })

  expect(server.requests).toHaveLength(2)
  const count = (request: unknown): number => JSON.stringify(request).split(MODEL_IMAGE_PATH).length - 1
  expect(count(server.requests[0])).toBeGreaterThan(count(server.requests[1]))
  expect(JSON.stringify(server.requests[1])).toContain('An earlier image was omitted')
})
