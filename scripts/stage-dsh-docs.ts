/** Stage the published documentation inside the published `@hackdevcode/dsh` package. */

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { rcompare } from 'semver'

/** Repository root, resolved from this script rather than the invoking directory. */
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Directory whose contents are published, and the package directory that receives them. */
const DOCS_DIRECTORY = join(REPOSITORY_ROOT, 'docs')
const STAGED_DIRECTORY = join(REPOSITORY_ROOT, 'apps', 'cli', 'docs')

/** Generated migration records and maintainer notes no reader of an installed package needs. */
const EXCLUDED_DIRECTORIES = ['persistence-changes', 'i18n', 'postmortem'] as const

/** Maintainer-only files at any depth. */
const EXCLUDED_FILES = ['AGENTS.md'] as const

/** Translation alignment records left over from upstream; Hack Dev Code ships English only. */
const EXCLUDED_SUFFIX = '.i18n.yaml'

/** Upgrade guides reach an installed reader through this directory. */
const UPGRADE_GUIDE_DIRECTORY = 'upgrade-guide'

/** Generated index of the staged upgrade guides; the repository tree has none. */
const UPGRADE_GUIDE_INDEX = `${UPGRADE_GUIDE_DIRECTORY}/README.md`

/**
 * Replace a package's `docs` directory with the documentation a reader needs.
 *
 * The copy follows the working tree, so a pack publishes the `docs/` contents
 * the checkout holds rather than the committed tree. Runs from the `prepack`
 * lifecycle of `@hackdevcode/dsh`, so packing the package and packing the
 * release set both publish the same files.
 * @param source - Documentation root to copy; defaults to the repository `docs`.
 * @param destination - Package directory to replace; defaults to `apps/cli/docs`.
 * @returns Resolves after the destination holds the filtered copy and the upgrade guide index.
 */
export async function stageDshDocs(source: string = DOCS_DIRECTORY, destination: string = STAGED_DIRECTORY): Promise<void> {
  await rm(destination, { recursive: true, force: true })
  const files = await stagedFiles(source)
  for (const file of files) {
    const target = join(destination, file)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(source, file), target)
  }
  await mkdir(join(destination, UPGRADE_GUIDE_DIRECTORY), { recursive: true })
  await writeFile(join(destination, UPGRADE_GUIDE_INDEX), await upgradeGuideIndex(source, files))
}

/** One upgrade guide as the generated index lists it. */
interface IndexedGuide {
  readonly item: string
  readonly title: string
  readonly summary: string
}

/**
 * Render the index of every staged upgrade guide, grouped by the release it upgrades from.
 * @param source - Documentation root holding the guides.
 * @param files - Staged source-relative paths.
 * @returns the index Markdown; without staged guides it holds only the preamble.
 * @throws When a guide lacks a frontmatter `description` or a level-one title.
 */
async function upgradeGuideIndex(source: string, files: readonly string[]): Promise<string> {
  const versions = new Map<string, IndexedGuide[]>()
  for (const file of files) {
    const match = /^upgrade-guide\/v(?<version>[^/]+)\/(?<item>[^/]+)\/guide\.md$/u.exec(file)?.groups
    if (match?.version === undefined || match.item === undefined) continue
    const { version, item } = match
    const heading = await guideHeading(join(source, file))
    const guides = versions.get(version) ?? []
    guides.push({ item, title: heading.title, summary: heading.description })
    versions.set(version, guides)
  }
  const cell = (text: string): string => text.replace(/\s+/gu, ' ').trim().replaceAll('|', '\\|')
  const lines = [
    '# Upgrade guides',
    '',
    'Generated when `@hackdevcode/dsh` is packed. A `v<T>` section lists what to change when upgrading from release vT to the release after it; vT is the release being left, not the target. Paths are relative to this file.',
  ]
  for (const [version, guides] of [...versions].sort(([left], [right]) => rcompare(left, right))) {
    lines.push('', `## v${version}`, '', '| Item | Summary | Guide |', '| --- | --- | --- |')
    for (const guide of guides) {
      const directory = `v${version}/${guide.item}`
      lines.push(`| ${cell(guide.title)} | ${cell(guide.summary)} | [${directory}/guide.md](${directory}/guide.md) |`)
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * Read the frontmatter description and level-one title of one guide.
 * @param path - Absolute guide path.
 * @returns the guide's one-sentence description and title.
 * @throws When the file is missing or lacks either field.
 */
async function guideHeading(path: string): Promise<{ readonly description: string; readonly title: string }> {
  const text = await readFile(path, 'utf8')
  // The title is the first level-one heading after the frontmatter.
  const frontmatter = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---\r?\n/u.exec(text)
  const yaml = frontmatter?.groups?.yaml
  const metadata = yaml === undefined ? undefined : loadYaml(yaml, { schema: JSON_SCHEMA }) as { description?: unknown } | null
  const title = frontmatter === null ? undefined : /^# (?<title>.+?)\r?$/mu.exec(text.slice(frontmatter[0].length))?.groups?.title
  if (typeof metadata?.description !== 'string' || title === undefined) {
    throw new Error(`stage-dsh-docs: ${path} needs a frontmatter description and a level-one title`)
  }
  return { description: metadata.description, title }
}

/**
 * Remove a staged copy, so no pack leaves a stale tree for the next one.
 * @param destination - Package directory to remove; defaults to `apps/cli/docs`.
 * @returns Resolves after the directory is absent.
 */
export async function cleanStagedDshDocs(destination: string = STAGED_DIRECTORY): Promise<void> {
  await rm(destination, { recursive: true, force: true })
}

/**
 * List the files one stage publishes, in stable path order.
 * @param source - Documentation root to walk.
 * @returns source-relative POSIX paths of every published file.
 */
async function stagedFiles(source: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(join(source, directory), { withFileTypes: true })) {
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`
      if (EXCLUDED_DIRECTORIES.some(excluded => path === excluded || path.startsWith(`${excluded}/`))) continue
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (path.endsWith(EXCLUDED_SUFFIX) || EXCLUDED_FILES.some(name => entry.name === name)) continue
      files.push(path)
    }
  }
  await walk('')
  return files.sort()
}

if (import.meta.main) {
  if (process.argv.includes('--clean')) await cleanStagedDshDocs()
  else await stageDshDocs()
}
