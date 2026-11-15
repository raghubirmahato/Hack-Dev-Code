import { describe, expect, it } from 'vitest'
import { brandString } from '@hackdevcode/dsh-brand'
import { builtinCommandName, builtinCommandTokens, resolveCommand } from '../src/builtin.ts'
import type { CommandDefinitionId, CommandDescriptor } from '../src/types.ts'

const definitions = [
  ['goal', '@hackdevcode/dsh-command-goal'],
  ['plan', '@hackdevcode/dsh-plan-mode'],
  ['feedback', '@hackdevcode/dsh-command-feedback'],
  ['compact', '@hackdevcode/dsh-command-compact'],
  ['permission', '@hackdevcode/dsh-permission-presets'],
  ['export', '@hackdevcode/dsh-session-log-export'],
] as const

describe('builtin command resolution', () => {
  it.each(definitions)('follows the %s identity through canonical, Chinese and renamed input', (name, id) => {
    const descriptor: CommandDescriptor = {
      name: `renamed-${name}`, definitionId: brandString<CommandDefinitionId>(id), description: 'Renamed command',
    }
    expect(builtinCommandName(descriptor)).toBe(name)
    for (const token of [builtinCommandTokens.en[name], descriptor.name]) {
      expect(resolveCommand(token, [descriptor])).toBe(descriptor)
    }
  })

  it('retains exact-name priority without assigning builtin identity to the replacement', () => {
    const builtin: CommandDescriptor = {
      name: 'planning', definitionId: brandString<CommandDefinitionId>('@hackdevcode/dsh-plan-mode'), description: 'Plan',
    }
    const replacement: CommandDescriptor = {
      name: 'plan', definitionId: brandString<CommandDefinitionId>('example/plan'), description: 'Other command',
    }
    expect(resolveCommand('plan', [builtin, replacement])).toBe(replacement)
    expect(builtinCommandName(replacement)).toBeUndefined()
    expect(resolveCommand('missing', [builtin])).toBeUndefined()
    expect(resolveCommand('plan', [])).toBeUndefined()
  })
})
