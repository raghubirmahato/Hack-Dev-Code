/**
 * Default bounds for Cua Driver window snapshots.
 * @module @hackdevcode/dsh-experimental-computer-use-cua-driver-native/snapshot
 */

/** Accessibility nodes one window snapshot walks unless the model asks for more; the driver default is 5 000. */
const SNAPSHOT_MAX_ELEMENTS = 400
/** Long edge of a window snapshot's screenshot unless the model asks otherwise. */
const SNAPSHOT_MAX_DIMENSION = 1280

/**
 * Bound window snapshots by default. Every snapshot stays in the conversation, so a full 5 000-node tree with a
 * full-size screenshot on each step multiplies the cost of every later request; the model can still ask for more.
 * @param name - upstream tool name.
 * @param args - the model's arguments.
 * @returns the arguments sent to the driver.
 */
export function withSnapshotDefaults(name: string, args: unknown): unknown {
  if (name !== 'get_window_state' || typeof args !== 'object' || args === null || Array.isArray(args)) return args
  const record = args as Record<string, unknown>
  return {
    ...record,
    ...record['max_elements'] === undefined && record['query'] === undefined ? { max_elements: SNAPSHOT_MAX_ELEMENTS } : {},
    ...record['max_dimension'] === undefined ? { max_dimension: SNAPSHOT_MAX_DIMENSION } : {},
  }
}

/**
 * Put a snapshot's id in the text the model reads. The driver returns `snapshot_id` and each element's
 * `element_token` only in structured content, while the model sees the text rendering; without the id it cannot
 * address elements and guesses one, which the driver rejects as stale.
 * @param name - upstream tool name.
 * @param result - the driver's raw MCP result.
 * @returns the result with the id prepended to its first text block.
 */
export function withSnapshotIdentity(name: string, result: unknown): unknown {
  if (name !== 'get_window_state' || typeof result !== 'object' || result === null) return result
  const record = result as { content?: unknown; structuredContent?: { snapshot_id?: unknown } }
  const id = record.structuredContent?.snapshot_id
  if (typeof id !== 'string' || !Array.isArray(record.content)) return result
  const note = `snapshot_id=${id}. Address an element with element_token "${id}:<element_index>" (for example "${id}:5"), `
    + `or with snapshot_id "${id}" plus element_index. A newer snapshot of this window replaces these.\n`
  const content = record.content as { type?: unknown; text?: unknown }[]
  const first = content.findIndex(block => block.type === 'text' && typeof block.text === 'string')
  if (first < 0) return { ...record, content: [{ type: 'text', text: note }, ...content] }
  return { ...record, content: content.map((block, index) => index === first ? { ...block, text: note + String(block.text) } : block) }
}

