# Attachment

The services and events this area of Hack Dev Code adds to the Cordis context, generated from the source by `pnpm run gen-cordis-catalog`. The packages themselves are described in their own READMEs under `packages/`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxattachments--attachmentstore-abstract-seam"></a>

### `ctx.attachments` — `AttachmentStore` (abstract seam)

Immutable binary attachment service. Implementations validate bytes before publishing a reference.

```ts cordis-catalog
/**
 * Validate one image without persisting it.
 * Batch callers validate every member before saving any member.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns completion after the encoded raster has been fully decoded.
 */
abstract validateImage(input: SaveImageAttachment): Promise<void>

/**
 * Validate and durably commit one ordered image batch.
 * @param inputs - encoded images in owning-message order.
 * @returns durable normalized attachment references in the same order after every member succeeds.
 */
async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>

/**
 * Admit one Host prompt and replace each encoded image with its durable reference.
 * Text, durable file references, and already stored images pass through unchanged.
 * Every image part counts toward `maxImagesPerMessage` and `maxMessageImageBytes`;
 * a stored image counts the bytes of the upload that stored it. Refused content
 * starts no writes. A prompt without encoded images performs no storage operation.
 * @param content - prompt parts in message order after upload receipt resolution.
 * @returns admitted prompt parts in the same order as `content`.
 * @throws AttachmentError when the image batch is refused.
 */
async admitPromptContent( content: readonly AttachmentAdmissionPart[], ): Promise<AdmittedPromptContentPart[]>

/**
 * Decode and durably commit one canonical base64 file upload.
 * @param input - canonical base64 bytes and optional display name.
 * @returns the durable content-addressed file reference.
 * @throws AttachmentError when the encoding or storage operation is refused.
 */
admitEncodedFile(input: EncodedFileAttachment): Promise<FileAttachmentRef>

/**
 * Identify a failure emitted by this attachment capability by its stable code.
 * @param error - value caught from an attachment operation.
 * @returns whether the value is an attachment failure.
 */
isAttachmentError(error: unknown): error is AttachmentError

/**
 * Validate and durably commit one image before its owning session event is appended.
 * The returned reference describes the persisted normalized image. When
 * normalization reduces the raster, its `originalDimensions` records the
 * orientation-applied input dimensions.
 * @param input - encoded bytes, declared media type, and optional display name.
 * @returns the durable content-addressed normalized image reference.
 */
abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

/**
 * Read one image and verify its ID, format, byte length, and dimensions against the supplied reference.
 * @param ref - supplied image reference; name and originalDimensions are preserved without file verification.
 * @param signal - optional cancellation for backend read and verification work.
 * @returns the verified bytes and normalized attachment reference.
 * @throws the signal reason when aborted, or a storage error when verification fails.
 */
abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

/**
 * Locate the provider-owned normalized object in the harness host filesystem.
 * @param ref - durable normalized attachment reference.
 * @returns an absolute host path, or undefined when this backend is not host-file-backed.
 * @throws an AttachmentError when the durable reference is invalid.
 */
imageHostPath(ref: ImageAttachmentRef): string | undefined

/**
 * Durably commit one file byte-for-byte before its owning session event is
 * appended. Files carry no admission limits: any byte content and length is
 * accepted, and the stored object is the exact submitted bytes. Backends
 * without verbatim file storage keep this default rejection.
 * @param input - exact bytes and optional display name.
 * @returns the durable content-addressed file reference.
 */
saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef>

/**
 * Durably commit one file byte-for-byte from bounded chunks. Providers must
 * apply backpressure and must not collect the complete file in memory.
 * Backends without streamed verbatim storage keep this default rejection.
 * @param input - ordered exact bytes, optional cancellation, and display name.
 * @returns the durable content-addressed file reference.
 */
saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef>

/**
 * Read and verify one verbatim stored file as bounded chunks. Providers must
 * not collect the complete file in memory. Backends without verbatim file
 * reads keep this default rejection.
 * @param ref - durable file reference from the session log.
 * @param signal - optional cancellation for backend reads and verification work.
 * @returns exact file bytes in order; integrity failures reject the iteration.
 */
async *readFileStream( ref: FileAttachmentRef, signal?: AbortSignal, ): AsyncIterable<Uint8Array>

/**
 * Locate the verbatim stored file object in the harness host filesystem.
 * @param ref - durable file reference.
 * @returns an absolute host path, or undefined when this backend is not host-file-backed.
 * @throws an AttachmentError when the durable reference is invalid.
 */
fileHostPath(ref: FileAttachmentRef): string | undefined

/**
 * Generate or read one deterministic model-request version from the stored normalized image.
 * @param ref - durable provider-independent normalized attachment reference.
 * @param target - route-chosen dimensions and byte target; an unmet byte target yields the smallest ladder output.
 * @param signal - optional cancellation.
 * @returns request bytes and the cache/upload identity covering every transform input.
 */
readImageRequest( ref: ImageAttachmentRef, target: ImageRequestTarget, signal?: AbortSignal, ): Promise<RequestImageAttachment>
```

Source: [`packages/attachment/attachment/src/index.ts`](../../packages/attachment/attachment/src/index.ts)

<a id="ctxfileuploads--fileuploads"></a>

### `ctx.fileUploads` — `FileUploads`

Host service owning upload storage and receipts keyed by each receiving Agent's exact Session.

```ts cordis-catalog
/**
 * Register the ordinary-Session resolver used when a raw upload addresses a cold Session.
 * @param resolve - resolver that returns the exact live Agent or throws a Remote error.
 * @returns disposer removing this resolver.
 */
registerAgentResolver(resolve: AgentResolver): () => void

/**
 * Persist one encoded upload and stage it under the Agent receiver selected by Typert.
 * @param agent - receiving Agent resolved from the Remote Agent scope.
 * @param request - canonical base64 bytes and optional display name.
 * @param signal - caller cancellation before storage begins.
 * @returns the staged receipt and durable file reference.
 */
@Remote('upload') async upload(agent: Agent, request: EncodedFileUploadRequest, signal: AbortSignal): Promise<FileUploadValue>

/**
 * Persist raw chunks for one Session without aggregating the upload.
 * @param request - Session identity, ordered bytes, cancellation, and optional display name.
 * @returns the staged receipt and durable file reference.
 */
async uploadStream(request: { readonly sessionId: SessionId readonly data: AsyncIterable<Uint8Array> readonly signal?: AbortSignal readonly name?: string }): Promise<FileUploadValue>

/**
 * Persist one prompt image for a Session: read at most the smaller of the
 * deployment's per-image and per-message byte limits, then validate,
 * normalize, and store the image the way prompt admission does, so a later
 * prompt cites it by receipt.
 * Cancellation before storage begins stores nothing; a cancelled upload
 * never receives a receipt, although an image whose storage already began
 * stays in the content-addressed store.
 * @param request - Session identity, ordered bytes, the declared media type that this deployment
 * must accept, cancellation, and optional display name.
 * @returns the staged receipt and durable normalized image reference.
 */
async uploadImageStream(request: { readonly sessionId: SessionId readonly data: AsyncIterable<Uint8Array> readonly mediaType: string readonly signal?: AbortSignal readonly name?: string }): Promise<ImageUploadValue>

/**
 * Resolve one staged receipt for the receiving Agent's exact Session.
 * @param agent - receiving Agent.
 * @param receiptId - opaque receipt minted for one completed upload.
 * @returns the staged file or image, or `undefined` for an unknown or foreign receipt.
 */
resolve(agent: Agent, receiptId: FileUploadReceiptId): StagedAttachment | undefined

/**
 * Bind receipts while one prompt enters an Agent inbox.
 * Disposal restores every prior binding unless the caller commits successful delivery.
 * @param agent - receiving Agent.
 * @param receiptIds - distinct staged receipts referenced by the prompt.
 * @param requestId - prompt identity later observed in queue or history.
 * @returns binding kept after commit until queue or history observation retires its receipts.
 */
bindPrompt( agent: Agent, receiptIds: readonly FileUploadReceiptId[], requestId: string, ): PromptFileBinding

/**
 * Retire every receipt accepted by one removed queue occurrence.
 * @param agent - receiving Agent.
 * @param requestId - prompt identity carried by the queue occurrence.
 */
retirePrompt(agent: Agent, requestId: string): void
```

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/client/file-upload/src/index.ts`](../../packages/client/file-upload/src/index.ts)
<!-- END GENERATED cordis-surface -->
