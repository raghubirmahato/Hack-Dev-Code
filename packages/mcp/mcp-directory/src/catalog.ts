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

/** One connector the directory offers: a remote MCP server the person signs in to in the browser. */
export interface DirectoryConnector {
  /** Stable id; also the MCP server name, so its tools are `mcp__<id>__<tool>`. */
  id: string
  title: string
  /** What the connector lets an agent do, for the person and the model. */
  description: string
  /** Where the connector is documented. */
  homepage: string
  /** The Streamable HTTP address of the MCP server. */
  url: string
}

/** The connectors, in display order. Each one authorizes with OAuth and registers this app on first sign-in. */
export const CONNECTORS: readonly DirectoryConnector[] = [
  {
    id: 'notion', title: 'Notion', description: 'Search, read, create and update Notion pages and databases.',
    homepage: 'https://developers.notion.com/docs/mcp', url: 'https://mcp.notion.com/mcp',
  },
  {
    id: 'linear', title: 'Linear', description: 'Find, create and update Linear issues, projects and comments.',
    homepage: 'https://linear.app/docs/mcp', url: 'https://mcp.linear.app/mcp',
  },
  {
    id: 'sentry', title: 'Sentry', description: 'Look up Sentry issues, events, traces and releases to debug errors.',
    homepage: 'https://docs.sentry.io/product/sentry-mcp/', url: 'https://mcp.sentry.dev/mcp',
  },
  {
    id: 'atlassian', title: 'Atlassian', description: 'Work with Jira issues and Confluence pages.',
    homepage: 'https://www.atlassian.com/platform/remote-mcp-server', url: 'https://mcp.atlassian.com/v1/mcp',
  },
  {
    id: 'stripe', title: 'Stripe', description: 'Read and manage Stripe customers, payments, products and invoices, and search the Stripe docs.',
    homepage: 'https://docs.stripe.com/mcp', url: 'https://mcp.stripe.com',
  },
  {
    id: 'vercel', title: 'Vercel', description: 'Inspect Vercel projects, deployments and logs, and search the Vercel docs.',
    homepage: 'https://vercel.com/docs/mcp/vercel-mcp', url: 'https://mcp.vercel.com',
  },
  {
    id: 'huggingface', title: 'Hugging Face', description: 'Search Hugging Face models, datasets, Spaces and papers.',
    homepage: 'https://huggingface.co/docs/hub/hf-mcp-server', url: 'https://huggingface.co/mcp',
  },
  {
    id: 'canva', title: 'Canva', description: 'Search, create and export Canva designs.',
    homepage: 'https://www.canva.dev/docs/connect/canva-mcp-server-setup/', url: 'https://mcp.canva.com/mcp',
  },
  {
    id: 'supabase', title: 'Supabase', description: 'Manage Supabase projects, run SQL and read logs.',
    homepage: 'https://supabase.com/docs/guides/getting-started/mcp', url: 'https://mcp.supabase.com/mcp',
  },
  {
    id: 'neon', title: 'Neon', description: 'Manage Neon Postgres projects and branches, and run SQL.',
    homepage: 'https://neon.com/docs/ai/neon-mcp-server', url: 'https://mcp.neon.tech/mcp',
  },
  {
    id: 'intercom', title: 'Intercom', description: 'Search Intercom conversations and contacts.',
    homepage: 'https://developers.intercom.com/docs/guides/mcp', url: 'https://mcp.intercom.com/mcp',
  },
  {
    id: 'monday', title: 'monday.com', description: 'Read and update monday.com boards, items and updates.',
    homepage: 'https://developer.monday.com/apps/docs/mcp', url: 'https://mcp.monday.com/mcp',
  },
]
