import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanStagedDshDocs, stageDshDocs } from './stage-dsh-docs.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-stage-docs-'))
  roots.push(root)
  return root
}

function write(root: string, path: string, contents = '# fixture\n'): void {
  const target = join(root, path)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, contents)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('documentation staging', () => {
  it('copies pages, assets, and upgrade guides without the internal trees', async () => {
    const source = join(temporaryRoot(), 'docs')
    const destination = join(temporaryRoot(), 'cli', 'docs')
    write(source, 'user/index.md')
    write(source, 'user/index.i18n.yaml')
    write(source, 'assets/diagram.png', 'png')
    write(source, 'upgrade-guide/v0.1.0/change/guide.md', '---\ndescription: "Change."\n---\n# Change\n')
    write(source, 'postmortem/incident.md')
    write(source, 'AGENTS.md')
    write(source, 'persistence-changes/v1/changes.md')
    write(source, 'i18n/terminology.md')
    write(destination, 'stale.md')

    await stageDshDocs(source, destination)

    for (const copied of ['user/index.md', 'assets/diagram.png', 'upgrade-guide/v0.1.0/change/guide.md', 'upgrade-guide/README.md']) {
      expect(existsSync(join(destination, copied)), copied).toBe(true)
    }
    for (const excluded of ['stale.md', 'user/index.i18n.yaml', 'postmortem', 'AGENTS.md', 'persistence-changes', 'i18n']) {
      expect(existsSync(join(destination, excluded)), excluded).toBe(false)
    }
  })

  it('indexes every upgrade guide by the release it upgrades from, newest first', async () => {
    const source = join(temporaryRoot(), 'docs')
    const destination = join(temporaryRoot(), 'cli', 'docs')
    const guide = (description: string, title: string): string => `---\nkind: upgrade-guide\ndescription: "${description}"\n---\n# ${title}\n`
    write(source, 'upgrade-guide/v0.2.0-rc.1/b-item/guide.md', '---\r\nkind: upgrade-guide\r\ndescription: >\r\n  Second | change\r\n  across lines.\r\n---\r\n# Second\r\n')
    write(source, 'upgrade-guide/v0.2.0-rc.1/a-item/guide.md', guide('First change.', 'First'))
    write(source, 'upgrade-guide/v0.10.0/c-item/guide.md', guide('Later change.', 'Later'))

    await stageDshDocs(source, destination)
    const index = readFileSync(join(destination, 'upgrade-guide/README.md'), 'utf8')

    expect(index.indexOf('## v0.10.0')).toBeLessThan(index.indexOf('## v0.2.0-rc.1'))
    expect(index).toContain('| First | First change. | [v0.2.0-rc.1/a-item/guide.md](v0.2.0-rc.1/a-item/guide.md) |')
    expect(index).toContain('| Second | Second \\| change across lines. | [v0.2.0-rc.1/b-item/guide.md](v0.2.0-rc.1/b-item/guide.md) |')
  })

  it('rejects a guide without a description and removes a staged copy on clean', async () => {
    const source = join(temporaryRoot(), 'docs')
    const destination = join(temporaryRoot(), 'cli', 'docs')
    write(source, 'upgrade-guide/v0.1.0/broken/guide.md', '# No frontmatter\n')
    await expect(stageDshDocs(source, destination)).rejects.toThrow(/needs a frontmatter description/u)

    write(destination, 'user/index.md')
    await cleanStagedDshDocs(destination)
    expect(existsSync(destination)).toBe(false)
  })
})
