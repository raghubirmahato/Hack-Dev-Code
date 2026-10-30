/** The package names the plugin manager protects, hides, orders, or marks experimental. */

/**
 * Plugin packages the plugin manager refuses to disable or remove, because management itself needs them; a bundle that
 * contains one is read-only as well. Removing a name drops only this `management-required` refusal; the manager's own
 * entry, installation-carried bundles, and unaddressable rows stay protected by their own rules.
 */
export const PROTECTED_PLUGINS: ReadonlySet<string> = new Set([
  '@hackdevcode/dsh-plugin-manager', '@hackdevcode/cordis-plugin-loader',
  '@hackdevcode/cordis-plugin-include', '@hackdevcode/dsh-api-gateway',
  '@hackdevcode/dsh-host-webserver', '@hackdevcode/dsh-client-modules',
  '@hackdevcode/dsh-client-ui-settings-plugin-inventory', '@hackdevcode/dsh-client-ui-plugin-manager',
  '@hackdevcode/dsh-host-plugin-inventory', '@hackdevcode/dsh-typert-registry',
  '@hackdevcode/dsh-api-remotes', '@hackdevcode/dsh-api-remote-access',
  '@hackdevcode/cordis-plugin-timer', '@hackdevcode/dsh-client-connection',
  '@hackdevcode/dsh-host-frontend-static', '@hackdevcode/dsh-tools',
  '@hackdevcode/dsh-hmr',
])

/**
 * Built-in profile bundles and persistent terminals, which have no plugin manager page.
 * Their Host availability and activation stay intact.
 */
export const HIDDEN_BUNDLES: ReadonlySet<string> = new Set([
  '@hackdevcode/dsh-base',
  '@hackdevcode/dsh-web-app',
  '@hackdevcode/dsh-headless',
  '@hackdevcode/dsh-sdk-app',
  '@hackdevcode/dsh-acp-app',
  '@hackdevcode/dsh-sdk-minimal',
  '@hackdevcode/dsh-experimental-terminal-bundle',
])

/**
 * The optional bundles the plugin manager's main and More lists rank first, in this order. {@link MORE_BUNDLES}, not
 * this list, decides whether a bundle appears on the main list.
 */
export const EXTENSION_BUNDLES: readonly string[] = [
  '@hackdevcode/dsh-experimental-agent-team-profile',
  '@hackdevcode/dsh-experimental-voice-input-bundle',
  '@hackdevcode/dsh-experimental-plugin-market-bundle',
  '@hackdevcode/dsh-experimental-auto-review',
]

/**
 * The optional bundles the plugin manager's main list leaves out until the profile enables them; its More list,
 * which includes every eligible bundle, ranks them last in this order.
 */
export const MORE_BUNDLES: readonly string[] = [
  '@hackdevcode/dsh-personalized-recommendations',
  '@hackdevcode/dsh-experimental-inspector-profile',
  '@hackdevcode/dsh-cua-bundle',
  '@hackdevcode/dsh-experimental-tool-worktree',
  '@hackdevcode/dsh-experimental-cot-translation-bundle',
  '@hackdevcode/dsh-experimental-session-search',
  '@hackdevcode/dsh-experimental-session-titles-bundle',
  '@hackdevcode/dsh-experimental-badge-skill-bundle',
  '@hackdevcode/dsh-experimental-ralph-bundle',
  '@hackdevcode/dsh-subagent-codex',
  '@hackdevcode/dsh-subagent-claude-code',
]

/** Official bundles the plugin manager marks with the Experimental badge. */
export const EXPERIMENTAL_BUNDLES: ReadonlySet<string> = new Set([
  '@hackdevcode/dsh-personalized-recommendations',
  '@hackdevcode/dsh-cua-bundle',
  '@hackdevcode/dsh-experimental-agent-team-profile',
  '@hackdevcode/dsh-experimental-voice-input-bundle',
  '@hackdevcode/dsh-experimental-auto-review',
  '@hackdevcode/dsh-experimental-inspector-profile',
  '@hackdevcode/dsh-experimental-forge-bundle',
  '@hackdevcode/dsh-experimental-tool-worktree',
  '@hackdevcode/dsh-experimental-cot-translation-bundle',
  '@hackdevcode/dsh-experimental-session-search',
  '@hackdevcode/dsh-experimental-session-titles-bundle',
  '@hackdevcode/dsh-experimental-badge-skill-bundle',
  '@hackdevcode/dsh-experimental-ralph-bundle',
  '@hackdevcode/dsh-experimental-plugin-market-bundle',
  '@hackdevcode/dsh-experimental-liveshare',
])
