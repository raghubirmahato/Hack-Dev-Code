/**
 * The curated skill directory: open-licensed skills from public repositories, installed with one choice into the
 * user skill folder (`$DSH_HOME/skills`), which the skill loader watches, so a new skill is available without a
 * restart. Installation fetches only the skill's folder with a shallow, sparse Git checkout.
 * @module @hackdevcode/dsh-mcp-directory/skills
 */

import { execFile } from 'node:child_process'
import { access, cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** One skill the directory offers. */
export interface DirectorySkill {
  /** Folder name the skill installs as. */
  id: string
  title: string
  description: string
  /** Git repository holding the skill. */
  repository: string
  /** The skill's folder inside the repository. */
  path: string
  license: string
}

const ANTHROPIC_SKILLS = 'https://github.com/anthropics/skills.git'

/** The skill directory, in display order. */
export const SKILLS: readonly DirectorySkill[] = [
  { id: 'mcp-builder', title: 'MCP server builder', description: 'Design and build high-quality MCP servers in TypeScript or Python.', repository: ANTHROPIC_SKILLS, path: 'skills/mcp-builder', license: 'Apache-2.0' },
  { id: 'webapp-testing', title: 'Web app testing', description: 'Test local web apps with Playwright: start the server, drive the page, capture screenshots and logs.', repository: ANTHROPIC_SKILLS, path: 'skills/webapp-testing', license: 'Apache-2.0' },
  { id: 'frontend-design', title: 'Frontend design', description: 'Build distinctive, production-grade web interfaces instead of generic templates.', repository: ANTHROPIC_SKILLS, path: 'skills/frontend-design', license: 'Apache-2.0' },
  { id: 'skill-creator', title: 'Skill creator', description: 'Write, test and improve new skills.', repository: ANTHROPIC_SKILLS, path: 'skills/skill-creator', license: 'Apache-2.0' },
  { id: 'docx', title: 'Word documents', description: 'Create, read and edit .docx files, including tracked changes and comments.', repository: ANTHROPIC_SKILLS, path: 'skills/docx', license: 'Apache-2.0' },
  { id: 'xlsx', title: 'Spreadsheets', description: 'Create and edit .xlsx spreadsheets with formulas, formatting and charts.', repository: ANTHROPIC_SKILLS, path: 'skills/xlsx', license: 'Apache-2.0' },
  { id: 'pptx', title: 'Presentations', description: 'Create and edit .pptx slide decks.', repository: ANTHROPIC_SKILLS, path: 'skills/pptx', license: 'Apache-2.0' },
  { id: 'pdf', title: 'PDF files', description: 'Read, fill, merge, split and create PDF files.', repository: ANTHROPIC_SKILLS, path: 'skills/pdf', license: 'Apache-2.0' },
  { id: 'doc-coauthoring', title: 'Document co-authoring', description: 'Write documents with the person in structured drafting and review rounds.', repository: ANTHROPIC_SKILLS, path: 'skills/doc-coauthoring', license: 'Apache-2.0' },
  { id: 'web-artifacts-builder', title: 'Web artifact builder', description: 'Build self-contained HTML apps with React, Tailwind and shadcn/ui.', repository: ANTHROPIC_SKILLS, path: 'skills/web-artifacts-builder', license: 'Apache-2.0' },
  { id: 'canvas-design', title: 'Canvas design', description: 'Create posters and visual designs as PNG and PDF.', repository: ANTHROPIC_SKILLS, path: 'skills/canvas-design', license: 'Apache-2.0' },
  { id: 'theme-factory', title: 'Theme factory', description: 'Apply consistent colour and font themes to documents, slides and pages.', repository: ANTHROPIC_SKILLS, path: 'skills/theme-factory', license: 'Apache-2.0' },
]

/** Marker file written into each skill this directory installed, so removal never touches skills the person added. */
export const INSTALLED_MARKER = '.hackdev-directory'

/**
 * Find a directory skill by id or title, ignoring case and separators.
 * @param query - id or title.
 * @returns the skill, or undefined.
 */
export function findSkill(query: string): DirectorySkill | undefined {
  const key = query.toLowerCase().replace(/[^a-z0-9]/gu, '')
  return SKILLS.find(skill => skill.id.replace(/-/gu, '') === key || skill.title.toLowerCase().replace(/[^a-z0-9]/gu, '') === key)
}

/** Runs git with arguments in a folder; replaceable in tests. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<void>

/** Default runner: git without a shell, bounded to two minutes, never prompting for credentials. */
export const runGit: GitRunner = (args, cwd) => new Promise((resolve, reject) => {
  execFile('git', [...args], { cwd, timeout: 120_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, _stdout, stderr) => {
    if (error === null) resolve()
    else reject(new Error(`git ${args[0] ?? ''} failed: ${stderr.trim().split(/\r?\n/u).at(-1) ?? error.message}`))
  })
})

/** Whether a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Install one skill into a skill folder.
 * @param skill - the directory skill.
 * @param skillsDir - the user skill folder.
 * @param git - git runner.
 * @returns where it was installed.
 */
export async function installSkill(skill: DirectorySkill, skillsDir: string, git: GitRunner = runGit): Promise<string> {
  const target = join(skillsDir, skill.id)
  if (await exists(target)) throw new Error(`a skill folder named ${skill.id} already exists in ${skillsDir}; remove it first`)
  const scratch = await mkdtemp(join(tmpdir(), 'hackdev-skill-'))
  try {
    const checkout = join(scratch, 'repo')
    await git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--quiet', skill.repository, checkout], scratch)
    await git(['sparse-checkout', 'set', '--no-cone', `/${skill.path}/`], checkout)
    const source = join(checkout, ...skill.path.split('/'))
    if (!await exists(join(source, 'SKILL.md'))) throw new Error(`${skill.repository} has no ${skill.path}/SKILL.md; the directory entry is out of date`)
    await cp(source, target, { recursive: true, errorOnExist: true, force: false })
    await writeFile(join(target, INSTALLED_MARKER), `${skill.repository} ${skill.path}\n`)
    return target
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Remove a skill this directory installed.
 * @param skill - the directory skill.
 * @param skillsDir - the user skill folder.
 * @returns false when it was not installed by the directory.
 */
export async function removeSkill(skill: DirectorySkill, skillsDir: string): Promise<boolean> {
  const target = join(skillsDir, skill.id)
  if (!await exists(join(target, INSTALLED_MARKER))) return false
  await rm(target, { recursive: true, force: true })
  return true
}

/**
 * Whether a directory skill is installed, and by whom.
 * @param skill - the directory skill.
 * @param skillsDir - the user skill folder.
 * @returns `directory`, `other` for a folder of the same name the directory did not install, or `no`.
 */
export async function skillState(skill: DirectorySkill, skillsDir: string): Promise<'directory' | 'other' | 'no'> {
  const target = join(skillsDir, skill.id)
  if (!await exists(target)) return 'no'
  return await exists(join(target, INSTALLED_MARKER)) ? 'directory' : 'other'
}
