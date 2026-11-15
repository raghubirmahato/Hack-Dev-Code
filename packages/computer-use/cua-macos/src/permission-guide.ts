/** macOS permission guide copy and private native request parameters. */
import { z } from 'zod'
import type { CuaBackend } from '@hackdevcode/dsh-cua'

/** Native-only fields for opening the selected privacy pane. */
export const PermissionSettingsParameters = z.object({ settingsMessage: z.string().min(1) })
/** Native-only guide fields, validated again by the Swift request parser. */
export const PermissionGuideParameters = PermissionSettingsParameters.extend({
  instruction: z.string().min(1), backLabel: z.string().min(1), finderLabel: z.string().min(1),
  unavailableMessage: z.string().min(1), pollIntervalMs: z.number().int().min(100).max(2 ** 31 - 1),
})

const en = {
  instruction: 'Drag {application} to the list above to allow {permission}',
  backLabel: 'Back',
  finderLabel: 'Show in Finder',
  unavailableMessage: 'Application unavailable. Enable Computer Use again and retry.',
  settingsMessage: 'Open System Settings > Privacy & Security > {permission} manually.',
  accessibility: 'Accessibility',
  screenRecording: 'Screen Recording',
}

const dictionaries = new Map<string, typeof en>(Object.entries({ en }))

/**
 * Resolve native permission copy from the Client language; unsupported languages use English.
 * @param pollIntervalMs Interval between native guide permission and position checks.
 * @returns Provider-owned parameters for the selected permission action.
 */
export function createPermissionParameters(pollIntervalMs: number): CuaBackend['permissionParameters'] {
  return (method, permission, locale) => {
    const language = locale.toLowerCase().replace(/-.*/, '')
    const text = dictionaries.get(language) ?? en
    const settingsMessage = text.settingsMessage.replace('{permission}', text[permission])
    if (method === 'openPermissionSettings') return { permission, settingsMessage }
    return { permission, settingsMessage, pollIntervalMs,
      instruction: text.instruction.replace('{permission}', text[permission]),
      backLabel: text.backLabel, finderLabel: text.finderLabel, unavailableMessage: text.unavailableMessage }
  }
}
