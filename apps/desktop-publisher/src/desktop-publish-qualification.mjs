/** Explain why retained debugging packages cannot enter either publication environment. */

/**
 * Return rebuilding instructions for debugging packages.
 * @param {string} qualification Recorded package qualification.
 * @returns {string | undefined} Diagnostic, or undefined for a non-debugging qualification.
 */
export function desktopPublishQualificationError(qualification) {
  const remedy = qualification === 'unsigned'
    ? 'The package is unsigned. Re-run Windows packaging with signing=signed.'
    : qualification === 'unnotarized'
      ? 'The package skipped notarization (unnotarized). Re-run macOS packaging without skipping notarization, and complete notarization and stapling.'
      : undefined
  return remedy && `desktop publish: ${remedy} The artifact is for internal debugging only: it cannot be published to test or production and cannot be used for automatic updates. Publish with a new run ID / attempt after packaging succeeds; re-running the current publication job does not help.`
}
