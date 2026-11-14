import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { BUILTIN_SKILLS, CONNECTORS, DIRECTORY, browserCandidates, findBrowser, signInArgs, siteClientConfig, siteId, siteSkillBody, siteUrl } from '../src/index.ts'

describe('website sessions', () => {
  it('reads a link the way a person types it', () => {
    expect(siteUrl('reddit.com')?.href).toBe('https://reddit.com/')
    expect(siteUrl('  https://www.reddit.com/login ')?.href).toBe('https://www.reddit.com/login')
    expect(siteUrl('http://intranet.example.com:8080/a?b=1')?.href).toBe('http://intranet.example.com:8080/a?b=1')
    expect(siteUrl('')).toBeUndefined()
    expect(siteUrl('localhost')).toBeUndefined()
    expect(siteUrl('ftp://files.example.com')).toBeUndefined()
    expect(siteUrl('javascript:alert(1)')).toBeUndefined()
    expect(siteUrl('not a link')).toBeUndefined()
  })

  it('names a session after the website', () => {
    const id = (text: string) => siteId(siteUrl(text)!)
    expect(id('www.reddit.com/login')).toBe('reddit')
    expect(id('mail.google.com')).toBe('mail-google')
    expect(id('bbc.co.uk')).toBe('bbc')
    expect(id('news.ycombinator.com')).toBe('news-ycombinator')
    expect(id('xn--bcher-kva.example')).toBe('xn-bcher-kva')
    // An address made of numbers gives no name that starts with a letter.
    expect(id('192.168.1.10')).toBeUndefined()
    expect(id(`${'a'.repeat(40)}.com`)).toHaveLength(32)
  })

  it('looks for an installed browser in each platform\'s usual places', () => {
    const windows = browserCandidates('win32', { 'ProgramFiles': 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' })
    expect(windows[0]).toEqual({ path: join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'), channel: 'chrome' })
    expect(windows.some(candidate => candidate.channel === 'msedge')).toBe(true)
    expect(browserCandidates('darwin', {})[0]!.path).toContain('Google Chrome.app')
    expect(browserCandidates('linux', {}).map(candidate => candidate.channel)).toContain('chromium')
    const edge = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    expect(findBrowser('win32', { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }, path => path === edge)).toEqual({ path: edge, channel: 'msedge' })
    expect(findBrowser('linux', {}, () => false)).toBeUndefined()
  })

  it('opens the sign-in window and drives the session on the same profile and cookie store', () => {
    const args = signInArgs('/home/me/.hackdevcode/site-sessions/reddit/profile', 'https://www.reddit.com/login')
    expect(args[0]).toBe('--user-data-dir=/home/me/.hackdevcode/site-sessions/reddit/profile')
    expect(args).toContain('--password-store=basic')
    expect(args.at(-1)).toBe('https://www.reddit.com/login')
    const site = { enabled: true, title: 'Reddit', url: 'https://www.reddit.com/login' }
    expect(siteClientConfig('reddit', site, '/p/reddit', { path: '/opt/chrome', channel: 'chrome' })).toMatchObject({
      transport: 'stdio', serverName: 'reddit', command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--user-data-dir', '/p/reddit', '--browser', 'chrome'],
      toolGroup: { name: 'mcp-reddit' },
    })
    // A plain Chromium build has no channel name, so it is passed by path.
    expect(siteClientConfig('reddit', site, '/p/reddit', { path: '/usr/bin/chromium', channel: 'chromium' }))
      .toMatchObject({ args: ['-y', '@playwright/mcp@latest', '--user-data-dir', '/p/reddit', '--executable-path', '/usr/bin/chromium'] })
  })

  it('writes instructions that keep the person in charge and carry the playbook', () => {
    const site = { enabled: true, url: 'https://www.reddit.com/' }
    const fresh = siteSkillBody('reddit', site, '')
    expect(fresh).toContain('# Signed-in session for www.reddit.com')
    expect(fresh).toContain('mcp__reddit__browser_snapshot')
    expect(fresh).toContain('Never type, read out or store a password')
    expect(fresh).toContain('wait for their yes')
    expect(fresh).toContain('Nothing is recorded for www.reddit.com yet')
    const learned = siteSkillBody('reddit', { ...site, title: 'Reddit' }, '## Post\nOpen /submit.\n')
    expect(learned).toContain('# Signed-in session for Reddit')
    expect(learned).toContain('## Post\nOpen /submit.')
    expect(learned).not.toContain('Nothing is recorded')
  })
})

describe('what ships in the box', () => {
  it('has built-in skills with loadable names and real instructions', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(6)
    const names = BUILTIN_SKILLS.map(skill => skill.name)
    expect(new Set(names).size).toBe(names.length)
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      expect(skill.description.length).toBeGreaterThan(40)
      expect(skill.content.startsWith('# ')).toBe(true)
      expect(skill.content.length).toBeGreaterThan(600)
    }
  })

  it('keeps server and connector ids apart, with https addresses', () => {
    const ids = [...DIRECTORY.map(server => server.id), ...CONNECTORS.map(connector => connector.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const connector of CONNECTORS) {
      expect(connector.id).toMatch(/^[a-z][a-z0-9-]{0,31}$/u)
      expect(connector.url).toMatch(/^https:\/\//u)
    }
    for (const server of DIRECTORY) {
      if (server.launch.transport === 'streamable-http') expect(server.launch.url).toMatch(/^https:\/\//u)
    }
    expect(DIRECTORY.length).toBeGreaterThanOrEqual(60)
    expect(CONNECTORS.length).toBeGreaterThanOrEqual(60)
  })
})
