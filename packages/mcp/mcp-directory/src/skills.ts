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
const OPENAI_SKILLS = 'https://github.com/openai/skills.git'

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
  { id: 'algorithmic-art', title: 'Algorithmic art', description: 'Create generative art with p5.js: seeded randomness, flow fields and particle systems.', repository: ANTHROPIC_SKILLS, path: 'skills/algorithmic-art', license: 'Apache-2.0' },
  { id: 'brand-guidelines', title: 'Brand guidelines', description: 'Apply a brand\'s colours and typography consistently to documents and designs.', repository: ANTHROPIC_SKILLS, path: 'skills/brand-guidelines', license: 'Apache-2.0' },
  { id: 'internal-comms', title: 'Internal communications', description: 'Write status reports, leadership updates, newsletters, FAQs and incident reports.', repository: ANTHROPIC_SKILLS, path: 'skills/internal-comms', license: 'Apache-2.0' },
  { id: 'slack-gif-creator', title: 'Animated GIF creator', description: 'Make animated GIFs sized and optimised for chat apps.', repository: ANTHROPIC_SKILLS, path: 'skills/slack-gif-creator', license: 'Apache-2.0' },
  { id: 'claude-api', title: 'Claude API', description: 'Build applications on the Claude API and Agent SDK: models, tools, streaming and caching.', repository: ANTHROPIC_SKILLS, path: 'skills/claude-api', license: 'Apache-2.0' },
  { id: 'gh-fix-ci', title: 'Fix failing CI', description: 'Inspect failing GitHub Actions checks with the gh CLI, find the cause and fix it.', repository: OPENAI_SKILLS, path: 'skills/.curated/gh-fix-ci', license: 'Apache-2.0' },
  { id: 'gh-address-comments', title: 'Address review comments', description: 'Work through the review and issue comments on the open pull request of the current branch.', repository: OPENAI_SKILLS, path: 'skills/.curated/gh-address-comments', license: 'Apache-2.0' },
  { id: 'security-best-practices', title: 'Security best practices', description: 'Review code against language and framework specific security best practices.', repository: OPENAI_SKILLS, path: 'skills/.curated/security-best-practices', license: 'Apache-2.0' },
  { id: 'security-threat-model', title: 'Threat modelling', description: 'Build a repository-grounded threat model: trust boundaries, assets, abuse paths and mitigations.', repository: OPENAI_SKILLS, path: 'skills/.curated/security-threat-model', license: 'Apache-2.0' },
  { id: 'security-ownership-map', title: 'Security ownership map', description: 'Map who owns which code from Git history and find sensitive code with a low bus factor.', repository: OPENAI_SKILLS, path: 'skills/.curated/security-ownership-map', license: 'Apache-2.0' },
  { id: 'playwright', title: 'Playwright CLI', description: 'Automate a real browser from the terminal: navigation, forms, snapshots, screenshots and data extraction.', repository: OPENAI_SKILLS, path: 'skills/.curated/playwright', license: 'Apache-2.0' },
  { id: 'jupyter-notebook', title: 'Jupyter notebooks', description: 'Create and edit Jupyter notebooks for experiments, explorations and tutorials.', repository: OPENAI_SKILLS, path: 'skills/.curated/jupyter-notebook', license: 'Apache-2.0' },
  { id: 'aspnet-core', title: 'ASP.NET Core', description: 'Build, review and refactor ASP.NET Core web applications following current official guidance.', repository: OPENAI_SKILLS, path: 'skills/.curated/aspnet-core', license: 'Apache-2.0' },
  { id: 'winui-app', title: 'WinUI apps', description: 'Bootstrap and develop WinUI 3 desktop applications with C# and the Windows App SDK.', repository: OPENAI_SKILLS, path: 'skills/.curated/winui-app', license: 'Apache-2.0' },
  { id: 'vercel-deploy', title: 'Deploy to Vercel', description: 'Deploy applications and websites to Vercel and return the link.', repository: OPENAI_SKILLS, path: 'skills/.curated/vercel-deploy', license: 'MIT' },
  { id: 'netlify-deploy', title: 'Deploy to Netlify', description: 'Deploy web projects to Netlify with the Netlify CLI.', repository: OPENAI_SKILLS, path: 'skills/.curated/netlify-deploy', license: 'Apache-2.0' },
  { id: 'cloudflare-deploy', title: 'Deploy to Cloudflare', description: 'Deploy applications to Cloudflare Workers, Pages and related services.', repository: OPENAI_SKILLS, path: 'skills/.curated/cloudflare-deploy', license: 'Apache-2.0' },
  { id: 'render-deploy', title: 'Deploy to Render', description: 'Deploy applications to Render by generating a render.yaml Blueprint.', repository: OPENAI_SKILLS, path: 'skills/.curated/render-deploy', license: 'Apache-2.0' },
  { id: 'sentry', title: 'Sentry triage', description: 'Inspect Sentry issues and events and summarise recent production errors with the Sentry CLI.', repository: OPENAI_SKILLS, path: 'skills/.curated/sentry', license: 'Apache-2.0' },
  { id: 'linear', title: 'Linear workflows', description: 'Read, create and update Linear issues, projects and team workflows.', repository: OPENAI_SKILLS, path: 'skills/.curated/linear', license: 'Apache-2.0' },
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

/**
 * Default runner: git without a shell, bounded to two minutes, never prompting for credentials.
 * @param args - git arguments.
 * @param cwd - folder to run in.
 * @returns when git exits successfully.
 */
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
  // Built-in skills are never in this list; they need no folder.
  const target = join(skillsDir, skill.id)
  if (!await exists(target)) return 'no'
  return await exists(join(target, INSTALLED_MARKER)) ? 'directory' : 'other'
}
