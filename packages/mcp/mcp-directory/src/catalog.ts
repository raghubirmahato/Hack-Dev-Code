/**
 * The curated MCP server directory: well-known servers with the command or address that starts each one and the
 * keys it needs. Commands use `npx` (Node.js) or `uvx` (Python uv), which download the server on first start.
 * @module @hackdevcode/dsh-mcp-directory/catalog
 */

/** One server the directory offers. */
export interface DirectoryServer {
  /** Stable id; also the MCP server name, so its tools are `mcp__<id>__<tool>`. */
  id: string
  title: string
  /** What the server lets an agent do, for the person and the model. */
  description: string
  /** Where the server is documented. */
  homepage: string
  /** How it starts. */
  launch:
    | { transport: 'stdio'; command: string; args: readonly string[] }
    | { transport: 'streamable-http'; url: string; headers: Readonly<Record<string, string>> }
  /** Environment variables or header values the server needs; `${NAME}` in args and headers is replaced by them. */
  requires: readonly { name: string; description: string }[]
  /** Arguments the person may set, such as the folders a filesystem server may open; `${roots}` in args expands to them. */
  roots?: { description: string }
}

/** The directory, in display order. */
export const DIRECTORY: readonly DirectoryServer[] = [
  {
    id: 'filesystem',
    title: 'Filesystem',
    description: 'Read, write, search and move files inside the folders you allow.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '${roots}'] },
    requires: [],
    roots: { description: 'Folders the server may open (default: the folder Hack Dev Code was started in).' },
  },
  {
    id: 'github',
    title: 'GitHub',
    description: 'Work with GitHub repositories, issues, pull requests, reviews, Actions runs and code search.',
    homepage: 'https://github.com/github/github-mcp-server',
    launch: { transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' } },
    requires: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', description: 'A GitHub personal access token with the scopes you want the agent to use.' }],
  },
  {
    id: 'playwright',
    title: 'Playwright browser',
    description: 'Drive a real browser through its accessibility tree: open pages, click, type, fill forms and take screenshots.',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    requires: [],
  },
  {
    id: 'context7',
    title: 'Context7 library docs',
    description: 'Fetch current, version-specific documentation and examples for libraries and frameworks.',
    homepage: 'https://github.com/upstash/context7',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    requires: [],
  },
  {
    id: 'fetch',
    title: 'Fetch',
    description: 'Fetch web pages and turn them into Markdown for reading.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    launch: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
    requires: [],
  },
  {
    id: 'git',
    title: 'Git',
    description: 'Read and change Git repositories: status, diff, log, branches, commits.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    launch: { transport: 'stdio', command: 'uvx', args: ['mcp-server-git'] },
    requires: [],
  },
  {
    id: 'memory',
    title: 'Memory',
    description: 'A persistent knowledge graph the agent can store facts in and recall across sessions.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    requires: [],
  },
  {
    id: 'sequential-thinking',
    title: 'Sequential thinking',
    description: 'Step-by-step problem solving with revisable, branching thoughts; helps smaller models plan.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    requires: [],
  },
  {
    id: 'time',
    title: 'Time',
    description: 'Current time and time-zone conversion.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    launch: { transport: 'stdio', command: 'uvx', args: ['mcp-server-time'] },
    requires: [],
  },
  {
    id: 'brave-search',
    title: 'Brave Search',
    description: 'Web, news, image and local search through the Brave Search API.',
    homepage: 'https://github.com/brave/brave-search-mcp-server',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] },
    requires: [{ name: 'BRAVE_API_KEY', description: 'A Brave Search API key (a free plan exists).' }],
  },
]

/**
 * Find a directory server by id or title, ignoring case and separators.
 * @param query - an id such as `github` or a title such as `Brave Search`.
 * @returns the server, or undefined.
 */
export function findServer(query: string): DirectoryServer | undefined {
  const key = query.toLowerCase().replace(/[^a-z0-9]/gu, '')
  return DIRECTORY.find(server => server.id.replace(/-/gu, '') === key || server.title.toLowerCase().replace(/[^a-z0-9]/gu, '') === key)
}
