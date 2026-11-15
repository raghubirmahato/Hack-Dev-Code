import { describe, expect, it } from 'vitest'
import { brandString } from '@hackdevcode/dsh-brand'
import type { CommandDefinitionId, CommandDescriptor } from '@hackdevcode/dsh-commands/types'
import { queryCommand } from '../src/query-input.ts'

const commands: readonly CommandDescriptor[] = [
  { name: 'compact', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-command-compact'), description: 'Compact' },
  { name: 'plan', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-plan-mode'), description: 'Plan', input: { hint: 'Task' } },
  { name: 'goal', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-command-goal'), description: 'Goal', input: { hint: 'Goal' } },
  { name: 'permission', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-permission-presets'), description: 'Permission', input: { hint: 'Preset' } },
  { name: 'feedback', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-command-feedback'), description: 'Feedback', input: { hint: 'Feedback' } },
  { name: 'export', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-session-log-export'), description: 'Export' },
]

describe('SDK query text recognition', () => {
  it.each([
    ['/compact', '/compact'], [' \n/compact \t', '/compact'], ['/compact', '/compact'],
    ['/permission workspace-write', '/permission workspace-write'],
    [' \n/permission\tread-only \t', '/permission\tread-only'],
    ['/permission\ncustom-deployment-preset', '/permission\ncustom-deployment-preset'],
    ['/permission\rread-only', '/permission\rread-only'],
    ['/permission  missing extra', '/permission  missing extra'],
    ['/plan', '/plan'], ['/plan', '/plan'], [' \n/plan off\t ', '/plan off'],
    ['/plan\nDesign the change', '/plan\nDesign the change'],
    ['/plan  off extra', '/plan  off extra'],
    ['/goal', '/goal'], ['/goal', '/goal'], ['/goal\nfinish the task', '/goal\nfinish the task'],
    ['/goal edit new objective', '/goal edit new objective'], ['/goal pause', '/goal pause'],
    ['/goal resume', '/goal resume'], ['/goal clear', '/goal clear'],
  ])('recognizes the Desktop form %j', (text, expected) => {
    expect(queryCommand(text, commands)).toBe(expected)
  })

  it.each([
    ['/plan\u3000Inspect\u3000the\nchange', '/plan Inspect\u3000the\nchange'],
    ['/plan\u00a0\t\u8bbe\u8ba1\u00a0\u65b9\u6848', '/plan \t\u8bbe\u8ba1\u00a0\u65b9\u6848'],
    ['/goal\u2003Finish\u3000the task', '/goal Finish\u3000the task'],
    ['/goal\u3000\u00a0\u5b8c\u6210\u4efb\u52a1', '/goal \u00a0\u5b8c\u6210\u4efb\u52a1'],
    ['/permission\u00a0read-only', '/permission read-only'],
    ['/permission\u202f\tread-only', '/permission \tread-only'],
  ])('normalizes only the first Unicode separator in %j', (text, expected) => {
    expect(queryCommand(text, commands)).toBe(expected)
  })

  it.each(['ordinary text', '/', '/unknown', '/usr/bin', '/COMPACT', '/\u6a21\u578b', '/\u6587\u4ef6',
    '/compact extra', '/compact extra', '/export path', '/model extra', '/file path',
    '/plans inspect', '/goals finish', '/feedback problem',
    '/permission', ' \n/permission \t', '/permission', '/permission\n\t', '/permissions read-only',
    '/export', '/export', '/model', '/file'])('leaves %j as ordinary text', (text) => {
    expect(queryCommand(text, commands)).toBeUndefined()
  })

  it('does not identify unrelated scoped replacements as builtins', () => {
    const replaced = [{ name: 'compact', description: 'Scoped command' }, { name: 'permission', description: 'Scoped permission' }]
    expect(queryCommand('/compact', replaced)).toBeUndefined()
    expect(queryCommand('/compact', replaced)).toBeUndefined()
    expect(queryCommand('/permission read-only', replaced)).toBeUndefined()
    expect(queryCommand('/permission read-only', replaced)).toBeUndefined()
    expect(queryCommand('/plan', [{ name: 'plan', description: 'Scoped plan' }])).toBeUndefined()
  })

  it('leaves other registered commands and unavailable supported commands unchanged', () => {
    expect(queryCommand('/feedback', commands)).toBeUndefined()
    expect(queryCommand('/goal', [])).toBeUndefined()
    expect(queryCommand('/plan', [])).toBeUndefined()
    expect(queryCommand('/compact', [])).toBeUndefined()
    expect(queryCommand('/export', [])).toBeUndefined()
    expect(queryCommand('/permission read-only', [])).toBeUndefined()
    expect(queryCommand('/compact', [{ name: 'prune', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-command-compact'), description: 'Renamed command' }]))
      .toBe('/prune')
    expect(queryCommand('/permission read-only', [{ name: 'access', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-permission-presets'), description: 'Renamed permission' }]))
      .toBe('/access read-only')
    expect(queryCommand('/plan', [{ name: 'planning', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-plan-mode'), description: 'Renamed plan' }]))
      .toBe('/planning')
    expect(queryCommand('/goal', [{ name: 'goal', description: 'Scoped goal' }])).toBeUndefined()
  })

  it('preserves exact-name priority over the builtin name', () => {
    const shadowed = [{ name: 'permission', description: 'Another definition' }, ...commands]
    expect(queryCommand('/permission read-only', shadowed)).toBeUndefined()
  })
})
