import { describe, expect, it, onTestFinished } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INSTALLED_MARKER, SKILLS, findSkill, installSkill, removeSkill, skillState } from '../src/skills.ts'
import type { GitRunner } from '../src/skills.ts'

async function skillsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hackdev-skills-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A git that "clones" by writing the skill folder the sparse checkout asks for. */
function fakeGit(withSkill = true): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const git: GitRunner = async (args, cwd) => {
    calls.push([...args])
    if (args[0] === 'clone') await mkdir(args.at(-1)!, { recursive: true })
    if (args[0] === 'sparse-checkout' && withSkill) {
      const path = args.at(-1)!.replace(/^\/|\/$/gu, '')
      await mkdir(join(cwd, ...path.split('/'), 'scripts'), { recursive: true })
      await writeFile(join(cwd, ...path.split('/'), 'SKILL.md'), '---\nname: test\n---\nBody\n')
    }
  }
  return { git, calls }
}

describe('the skill directory', () => {
  it('lists open-licensed skills with unique folder names', () => {
    const ids = SKILLS.map(skill => skill.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const skill of SKILLS) expect(['Apache-2.0', 'MIT']).toContain(skill.license)
    expect(findSkill('Web app testing')?.id).toBe('webapp-testing')
    expect(findSkill('nothing')).toBeUndefined()
  })

  it('installs only the skill folder with a shallow sparse checkout and marks it as the directory\'s', async () => {
    const dir = await skillsDir()
    const { git, calls } = fakeGit()
    const skill = findSkill('webapp-testing')!
    const target = await installSkill(skill, dir, git)
    expect(target).toBe(join(dir, 'webapp-testing'))
    expect(calls[0]).toEqual(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--quiet', skill.repository, expect.any(String)])
    expect(calls[1]).toEqual(['sparse-checkout', 'set', '--no-cone', '/skills/webapp-testing/'])
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('name: test')
    expect(await readFile(join(target, INSTALLED_MARKER), 'utf8')).toContain('skills/webapp-testing')
    expect(await skillState(skill, dir)).toBe('directory')
    await expect(installSkill(skill, dir, git)).rejects.toThrow('already exists')
  })

  it('refuses an entry whose folder has no SKILL.md, and removes only what it installed', async () => {
    const dir = await skillsDir()
    await expect(installSkill(findSkill('pdf')!, dir, fakeGit(false).git)).rejects.toThrow('has no skills/pdf/SKILL.md')
    expect(await skillState(findSkill('pdf')!, dir)).toBe('no')
    await mkdir(join(dir, 'docx'))
    expect(await skillState(findSkill('docx')!, dir)).toBe('other')
    expect(await removeSkill(findSkill('docx')!, dir)).toBe(false)
    await installSkill(findSkill('xlsx')!, dir, fakeGit().git)
    expect(await removeSkill(findSkill('xlsx')!, dir)).toBe(true)
    expect(await skillState(findSkill('xlsx')!, dir)).toBe('no')
  })
})
