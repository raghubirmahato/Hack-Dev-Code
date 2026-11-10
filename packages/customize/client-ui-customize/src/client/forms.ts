/** Turns what a person types into the add forms into the ids and servers the Host stores. */

import type { CustomizeSnapshot } from '@hackdevcode/dsh-api-remotes/client'

/** One of the person's own servers, as the Host stores it. */
export interface CustomServerDraft {
  enabled: boolean
  title: string
  command?: string
  args?: string[]
  url?: string
}

/** One server row of the page. */
export type ServerRow = CustomizeSnapshot['servers'][number]
/** One connector row of the page. */
export type ConnectorRow = CustomizeSnapshot['connectors'][number]
/** One skill row of the page. */
export type SkillRow = CustomizeSnapshot['skills'][number]

const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u

/**
 * Make the id a name is stored under.
 * @param name - the name a person typed.
 * @returns a lowercase id, or `undefined` when the name cannot make one.
 */
export function slug(name: string): string | undefined {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return ID_PATTERN.test(id) ? id : undefined
}

/**
 * Split a command line into words, keeping quoted text together.
 * @param line - the command line.
 * @returns the words without their quotes.
 */
export function splitCommand(line: string): string[] {
  const words: string[] = []
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu)) words.push((match[1] ?? match[2] ?? match[3]) as string)
  return words
}

/**
 * Read the add-server form.
 * @param name - the name a person typed.
 * @param line - a command line, or an http(s) address.
 * @returns the server; a blank line makes one with an empty command, which the form never sends.
 */
export function draftServer(name: string, line: string): CustomServerDraft {
  const text = line.trim()
  if (/^https?:\/\//iu.test(text)) return { enabled: true, title: name.trim(), url: text }
  const [command = '', ...args] = splitCommand(text)
  return { enabled: true, title: name.trim(), command, args }
}

/**
 * Split the folders field.
 * @param text - folders separated by commas or line breaks.
 * @returns the folders, without empty entries.
 */
export function folders(text: string): string[] {
  return text.split(/[,\n]/u).map(folder => folder.trim()).filter(folder => folder !== '')
}
