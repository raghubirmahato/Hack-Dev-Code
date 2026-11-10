import { describe, expect, it } from 'vitest'
import { draftServer, folders, slug, splitCommand } from '../src/client/forms.ts'

describe('customize add forms', () => {
  it('makes a stored id from a typed name', () => {
    expect(slug('  My Notes Server ')).toBe('my-notes-server')
    expect(slug('GitHub')).toBe('github')
  })

  it('refuses a name that cannot make an id', () => {
    expect(slug('')).toBeUndefined()
    expect(slug('9 lives')).toBeUndefined()
    expect(slug('a'.repeat(33))).toBeUndefined()
  })

  it('keeps quoted words of a command line together', () => {
    expect(splitCommand('npx -y "my server" \'second arg\' --flag')).toEqual(['npx', '-y', 'my server', 'second arg', '--flag'])
    expect(splitCommand('   ')).toEqual([])
  })

  it('reads an address as a remote server', () => {
    expect(draftServer(' Docs ', ' HTTPS://example.com/mcp ')).toEqual({ enabled: true, title: 'Docs', url: 'HTTPS://example.com/mcp' })
  })

  it('reads anything else as a command with its arguments', () => {
    expect(draftServer('Files', 'npx -y files-server "C:/My Files"')).toEqual({
      enabled: true,
      title: 'Files',
      command: 'npx',
      args: ['-y', 'files-server', 'C:/My Files'],
    })
    expect(draftServer('Empty', '  ')).toEqual({ enabled: true, title: 'Empty', command: '', args: [] })
  })

  it('splits the folders field on commas and line breaks', () => {
    expect(folders(' C:/work, D:/notes\n\n ,E:/x ')).toEqual(['C:/work', 'D:/notes', 'E:/x'])
    expect(folders('')).toEqual([])
  })
})
