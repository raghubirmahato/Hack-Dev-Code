/** Render the verified publication plan for GitHub's native deployment reviewers. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { DesktopRetainedSource } from './desktop-release-store.ts'
import type { DesktopUploadPlan } from './desktop-upload-plan.ts'

function text(value: string): string {
  return value.replace(/[&<>"'|`\r\n\\*_\[\]()!~:]/gu, character => `&#${character.charCodeAt(0)};`)
}

function code(value: string): string { return `<code>${text(value)}</code>` }
function row(label: string, value: string): string { return `| ${label} | ${value} |` }
function link(url: string, label = url): string { return `<a href="${text(url)}">${text(label)}</a>` }

/**
 * Render approval details after package, destination and signature verification succeeds.
 * @param source Verified retained packaging identity; a test plan requires its validated release ID.
 * @param plan Validated upload plan; YAML contents are the bytes that will be uploaded.
 * @param approval Digest bound to the approved manifest and upload plan.
 * File SHA-256 hex supports `shasum -a 256` on downloads; upload reconciliation separately uses SHA-512 base64.
 * @returns GitHub-flavored Markdown with final URLs and upload-byte fingerprints, without credentials or local paths.
 */
export async function desktopPublicationSummary(
  source: DesktopRetainedSource, plan: DesktopUploadPlan, approval: string,
): Promise<string> {
  const origin = new URL(plan.publicUrl).origin
  const url = (key: string) => `${origin}/${key.split('/').map(encodeURIComponent).join('/')}`
  const files = []
  for (const file of plan.artifacts) {
    const hash = createHash('sha256')
    let size = 0
    const bytes = file.contents === undefined ? createReadStream(file.path) : [Buffer.from(file.contents)]
    for await (const chunk of bytes) { size += chunk.length; hash.update(chunk) }
    files.push(row(link(url(file.key), file.filename), `${size} bytes | ${code(hash.digest('hex'))}`))
  }
  const installerExtension = plan.target === 'win-x64' ? '.exe' : '.dmg'
  const installers = plan.artifacts.filter(file => !file.channelMetadata && file.filename.endsWith(installerExtension))
  const feeds = plan.artifacts.filter(file => file.channelMetadata)
  const runUrl = `https://github.com/${source.repository}/actions/runs/${source.runId}/attempts/${source.attempt}`
  const environment = plan.environment === 'test' ? 'desktop-test' : 'desktop-production'
  const tag = plan.environment === 'production' ? code(`desktop-v${plan.version}`) : 'Not created (test environment)'
  return [
    '', '## Confirm before publishing', '',
    `After checking the details below, click **Review deployments**, select ${code(environment)}, and click **Approve and deploy**. Click **Reject** if anything is wrong.`, '',
    '| Item | Publication details |', '| --- | --- |',
    row('Publication environment', code(plan.environment)),
    row('Version', code(plan.version)),
    row('Update channel', code(source.channel)),
    row('Platform', code(plan.target)),
    ...(plan.environment === 'test' ? [row('Test release ID', `${code(source.testReleaseId!)}<br>Random prefix for the test download path that makes the URL harder to guess; consecutive upgrade tests must reuse the same value.`)] : []),
    row('Download URL preview', `${installers.map(file => link(url(file.key))).join('<br>')}<br>Target URLs after publication; downloads are not guaranteed before approval.`),
    row('Update YAML', `${feeds.map(file => link(url(file.key))).join('<br>')}<br>This publication updates the file; before approval it may not exist yet or may still point at an older release.`),
    row('Packaging source', `${link(runUrl, `View packaging run #${source.runId} · attempt ${source.attempt}`)}<br>Source: ${code(`${source.sourceRef} @ ${source.commit}`)}<br>Packaging machine: ${code(source.runnerName)}`),
    row('Signature and notarization', plan.target === 'win-x64' ? 'EXE signature verified' : 'DMG verified<br>App inside the ZIP verified'),
    row('Git tag', tag), '', '### After approval', '',
    '1. Re-validate the artifacts and publication targets; stop if they differ from this approval summary.',
    '2. Upload missing files and skip existing files whose contents match; stop if any content conflicts.',
    '3. Update the update YAML above and save the publication record.',
    ...(plan.environment === 'production' ? ['4. Create the Git tag above for the packaged commit; if creating the tag fails, record "published, tag pending".'] : []), '',
    ...(plan.environment === 'test' ? ['**This publication targets test only and does not modify production.**', ''] : []),
    '<details>', '<summary>Technical details and file list</summary>', '',
    `COS bucket: ${code(plan.bucket)}`, '',
    ...(plan.environment === 'test' ? [
      'The release ID comes from the original packaging artifact manifest. Packaging prefers the `test_release_id` form field; when it is blank, packaging uses `DOWNLOAD_TEST_RELEASE_ID` from the machine\'s `presets/test.env`. Publication does not choose it again.', '',
    ] : []),
    `Approval summary SHA-256: ${code(approval)}`, '',
    `Total: ${plan.artifacts.length} files. Size and SHA-256 describe the bytes that are actually uploaded, including the updated YAML content.`, '',
    '| File | Size | SHA-256 |', '| --- | --- | --- |', ...files, '', '</details>', '',
    'If the repository is public, the download URLs in this summary and the release ID of a test publication are public too. A random prefix does not replace access control.', '',
  ].join('\n')
}
