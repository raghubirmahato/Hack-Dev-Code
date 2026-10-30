/** GitHub-compatible Markdown heading anchors. */

/**
 * Compute the anchor GitHub generates for a heading.
 * @param heading - Heading text without the leading `#` marks.
 * @returns lowercase text with punctuation removed and spaces turned into hyphens.
 */
export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/gu, '-')
}
