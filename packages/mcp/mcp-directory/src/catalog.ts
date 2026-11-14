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
  {
    id: 'chrome-devtools',
    title: 'Chrome DevTools',
    description: 'Debug a live Chrome page: console messages, network requests, performance traces, screenshots and page scripting.',
    homepage: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
    requires: [],
  },
  {
    id: 'deepwiki',
    title: 'DeepWiki',
    description: 'Ask questions about any public GitHub repository and read its generated architecture documentation.',
    homepage: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    launch: { transport: 'streamable-http', url: 'https://mcp.deepwiki.com/mcp', headers: {} },
    requires: [],
  },
  {
    id: 'microsoft-learn',
    title: 'Microsoft Learn docs',
    description: 'Search and fetch official Microsoft documentation: Azure, .NET, Windows, Microsoft 365 and code samples.',
    homepage: 'https://learn.microsoft.com/en-us/training/support/mcp',
    launch: { transport: 'streamable-http', url: 'https://learn.microsoft.com/api/mcp', headers: {} },
    requires: [],
  },
  {
    id: 'cloudflare-docs',
    title: 'Cloudflare docs',
    description: 'Search the Cloudflare developer documentation: Workers, Pages, R2, D1, DNS and the rest of the platform.',
    homepage: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/',
    launch: { transport: 'streamable-http', url: 'https://docs.mcp.cloudflare.com/mcp', headers: {} },
    requires: [],
  },
  {
    id: 'aws-docs',
    title: 'AWS documentation',
    description: 'Search and read the official AWS documentation and get related-page recommendations.',
    homepage: 'https://awslabs.github.io/mcp/servers/aws-documentation-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['awslabs.aws-documentation-mcp-server@latest'] },
    requires: [],
  },
  {
    id: 'markitdown',
    title: 'MarkItDown',
    description: 'Convert PDF, Word, Excel, PowerPoint, images, audio and web pages to Markdown for reading.',
    homepage: 'https://github.com/microsoft/markitdown',
    launch: { transport: 'stdio', command: 'uvx', args: ['markitdown-mcp'] },
    requires: [],
  },
  {
    id: 'desktop-commander',
    title: 'Desktop Commander',
    description: 'Long-running terminal sessions, process control, and fast search and patch-style edits across large folders.',
    homepage: 'https://github.com/wonderwhy-er/DesktopCommanderMCP',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander@latest'] },
    requires: [],
  },
  {
    id: 'exa',
    title: 'Exa search',
    description: 'Neural web search and page crawling tuned for code, documentation and research questions.',
    homepage: 'https://docs.exa.ai/reference/exa-mcp',
    launch: { transport: 'streamable-http', url: 'https://mcp.exa.ai/mcp', headers: {} },
    requires: [],
  },
  {
    id: 'tavily',
    title: 'Tavily search',
    description: 'Web search, page extraction and site crawling through the Tavily API.',
    homepage: 'https://github.com/tavily-ai/tavily-mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'tavily-mcp@latest'] },
    requires: [{ name: 'TAVILY_API_KEY', description: 'A Tavily API key (a free plan exists).' }],
  },
  {
    id: 'firecrawl',
    title: 'Firecrawl',
    description: 'Scrape, crawl and extract structured data from websites, including pages that need JavaScript.',
    homepage: 'https://github.com/firecrawl/firecrawl-mcp-server',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'firecrawl-mcp'] },
    requires: [{ name: 'FIRECRAWL_API_KEY', description: 'A Firecrawl API key (a free plan exists).' }],
  },
  {
    id: 'aws-knowledge',
    title: 'AWS knowledge',
    description: 'Search AWS documentation, API references, architecture guidance and regional availability.',
    homepage: 'https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server',
    launch: { transport: 'streamable-http', url: 'https://knowledge-mcp.global.api.aws', headers: {} },
    requires: [],
  },
  {
    id: 'gitmcp',
    title: 'GitMCP',
    description: 'Read the documentation and code of any public GitHub repository as context.',
    homepage: 'https://gitmcp.io',
    launch: { transport: 'streamable-http', url: 'https://gitmcp.io/docs', headers: {} },
    requires: [],
  },
  {
    id: 'svelte',
    title: 'Svelte docs',
    description: 'Official Svelte and SvelteKit documentation, with a checker for Svelte code.',
    homepage: 'https://svelte.dev/docs/mcp/overview',
    launch: { transport: 'streamable-http', url: 'https://mcp.svelte.dev/mcp', headers: {} },
    requires: [],
  },
  {
    id: 'coingecko',
    title: 'CoinGecko',
    description: 'Public cryptocurrency prices, market data and coin information.',
    homepage: 'https://docs.coingecko.com/reference/mcp-server',
    launch: { transport: 'streamable-http', url: 'https://mcp.api.coingecko.com/mcp', headers: {} },
    requires: [],
  },
  {
    id: 'duckduckgo',
    title: 'DuckDuckGo search',
    description: 'Web search and page fetching through DuckDuckGo, with no key.',
    homepage: 'https://github.com/nickclyde/duckduckgo-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['duckduckgo-mcp-server'] },
    requires: [],
  },
  {
    id: 'wikipedia',
    title: 'Wikipedia',
    description: 'Search Wikipedia and read articles, summaries and sections.',
    homepage: 'https://github.com/Rudra-ravi/wikipedia-mcp',
    launch: { transport: 'stdio', command: 'uvx', args: ['wikipedia-mcp'] },
    requires: [],
  },
  {
    id: 'arxiv',
    title: 'arXiv',
    description: 'Search arXiv and download and read papers.',
    homepage: 'https://github.com/blazickjp/arxiv-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['arxiv-mcp-server'] },
    requires: [],
  },
  {
    id: 'perplexity',
    title: 'Perplexity',
    description: 'Web-grounded answers, research and reasoning through the Perplexity API.',
    homepage: 'https://github.com/perplexityai/modelcontextprotocol',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@perplexity-ai/mcp-server'] },
    requires: [{ name: 'PERPLEXITY_API_KEY', description: 'A Perplexity API key.' }],
  },
  {
    id: 'shadcn',
    title: 'shadcn/ui',
    description: 'Browse, search and install components from shadcn/ui registries.',
    homepage: 'https://ui.shadcn.com/docs/mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'shadcn@latest', 'mcp'] },
    requires: [],
  },
  {
    id: 'magic-ui',
    title: 'Magic UI',
    description: 'Animated React components and their install instructions from Magic UI.',
    homepage: 'https://magicui.design/docs/mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@magicuidesign/mcp@latest'] },
    requires: [],
  },
  {
    id: 'figma',
    title: 'Figma (API key)',
    description: 'Read Figma files, frames and layout data to implement designs.',
    homepage: 'https://github.com/GLips/Figma-Context-MCP',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'] },
    requires: [{ name: 'FIGMA_API_KEY', description: 'A Figma personal access token.' }],
  },
  {
    id: 'charts',
    title: 'Charts',
    description: 'Generate charts and diagrams (bar, line, pie, flow, mind map and more) as images.',
    homepage: 'https://github.com/antvis/mcp-server-chart',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@antv/mcp-server-chart'] },
    requires: [],
  },
  {
    id: 'eslint',
    title: 'ESLint',
    description: 'Lint files with the project\'s own ESLint configuration.',
    homepage: 'https://eslint.org/docs/latest/use/mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@eslint/mcp@latest'] },
    requires: [],
  },
  {
    id: 'next-devtools',
    title: 'Next.js DevTools',
    description: 'Next.js documentation, upgrade help and runtime diagnostics for a running dev server.',
    homepage: 'https://github.com/vercel/next-devtools-mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'next-devtools-mcp@latest'] },
    requires: [],
  },
  {
    id: 'angular',
    title: 'Angular CLI',
    description: 'Angular best practices, documentation search and project information.',
    homepage: 'https://angular.dev/ai/mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@angular/cli', 'mcp'] },
    requires: [],
  },
  {
    id: 'shopify-dev',
    title: 'Shopify dev',
    description: 'Search Shopify developer docs and explore the Admin GraphQL schema.',
    homepage: 'https://shopify.dev/docs/apps/build/devmcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@shopify/dev-mcp@latest'] },
    requires: [],
  },
  {
    id: 'n8n',
    title: 'n8n',
    description: 'Documentation and schemas for n8n workflow nodes, to design and validate workflows.',
    homepage: 'https://github.com/czlonkowski/n8n-mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'n8n-mcp'] },
    requires: [],
  },
  {
    id: 'firebase',
    title: 'Firebase',
    description: 'Manage Firebase projects, Auth, Firestore, rules and other services with your Firebase CLI sign-in.',
    homepage: 'https://firebase.google.com/docs/cli/mcp-server',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'firebase-tools@latest', 'mcp'] },
    requires: [],
  },
  {
    id: 'azure',
    title: 'Azure',
    description: 'Work with Azure resources using your Azure CLI sign-in: storage, databases, monitoring and more.',
    homepage: 'https://github.com/microsoft/mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@azure/mcp@latest', 'server', 'start'] },
    requires: [],
  },
  {
    id: 'gcloud',
    title: 'Google Cloud',
    description: 'Run Google Cloud CLI operations with your gcloud sign-in.',
    homepage: 'https://github.com/googleapis/gcloud-mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@google-cloud/gcloud-mcp'] },
    requires: [],
  },
  {
    id: 'aws-api',
    title: 'AWS API',
    description: 'Run AWS CLI operations with your AWS credentials.',
    homepage: 'https://awslabs.github.io/mcp/servers/aws-api-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['awslabs.aws-api-mcp-server@latest'] },
    requires: [],
  },
  {
    id: 'aws-pricing',
    title: 'AWS pricing',
    description: 'Look up AWS prices and estimate the cost of an architecture.',
    homepage: 'https://awslabs.github.io/mcp/servers/aws-pricing-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['awslabs.aws-pricing-mcp-server@latest'] },
    requires: [],
  },
  {
    id: 'aws-cdk',
    title: 'AWS CDK',
    description: 'AWS CDK guidance, constructs and infrastructure patterns.',
    homepage: 'https://awslabs.github.io/mcp/servers/cdk-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['awslabs.cdk-mcp-server@latest'] },
    requires: [],
  },
  {
    id: 'aws-terraform',
    title: 'AWS Terraform',
    description: 'Terraform on AWS: provider docs, modules and security checks.',
    homepage: 'https://awslabs.github.io/mcp/servers/terraform-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['awslabs.terraform-mcp-server@latest'] },
    requires: [],
  },
  {
    id: 'pulumi',
    title: 'Pulumi',
    description: 'Preview and deploy Pulumi stacks and search the Pulumi registry.',
    homepage: 'https://www.pulumi.com/docs/iac/guides/ai-integration/mcp-server/',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@pulumi/mcp-server@latest', 'stdio'] },
    requires: [],
  },
  {
    id: 'kubernetes',
    title: 'Kubernetes',
    description: 'Inspect and manage a Kubernetes cluster with your kubeconfig: pods, deployments, logs, Helm.',
    homepage: 'https://github.com/Flux159/mcp-server-kubernetes',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-server-kubernetes'] },
    requires: [],
  },
  {
    id: 'docker',
    title: 'Docker',
    description: 'Manage local Docker containers, images, volumes and networks.',
    homepage: 'https://github.com/ckreiling/mcp-server-docker',
    launch: { transport: 'stdio', command: 'uvx', args: ['mcp-server-docker'] },
    requires: [],
  },
  {
    id: 'postgres',
    title: 'PostgreSQL',
    description: 'Query a PostgreSQL database, inspect its schema and analyse query plans and health.',
    homepage: 'https://github.com/crystaldba/postgres-mcp',
    launch: { transport: 'stdio', command: 'uvx', args: ['postgres-mcp', '--access-mode=unrestricted'] },
    requires: [{ name: 'DATABASE_URI', description: 'The database connection string, such as postgresql://user:password@host:5432/dbname.' }],
  },
  {
    id: 'mongodb',
    title: 'MongoDB',
    description: 'Query and manage MongoDB databases and collections.',
    homepage: 'https://github.com/mongodb-js/mongodb-mcp-server',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'mongodb-mcp-server'] },
    requires: [{ name: 'MDB_MCP_CONNECTION_STRING', description: 'The MongoDB connection string.' }],
  },
  {
    id: 'redis',
    title: 'Redis',
    description: 'Read and write Redis data: strings, hashes, lists, sets, streams and search.',
    homepage: 'https://github.com/redis/mcp-redis',
    launch: { transport: 'stdio', command: 'uvx', args: ['--from', 'redis-mcp-server@latest', 'redis-mcp-server', '--url', '${REDIS_URL}'] },
    requires: [{ name: 'REDIS_URL', description: 'The Redis address, such as redis://localhost:6379/0.' }],
  },
  {
    id: 'clickhouse',
    title: 'ClickHouse',
    description: 'Run SQL on ClickHouse and list its databases and tables.',
    homepage: 'https://github.com/ClickHouse/mcp-clickhouse',
    launch: { transport: 'stdio', command: 'uvx', args: ['mcp-clickhouse'] },
    requires: [{ name: 'CLICKHOUSE_HOST', description: 'The ClickHouse host name.' }, { name: 'CLICKHOUSE_USER', description: 'The ClickHouse user.' }, { name: 'CLICKHOUSE_PASSWORD', description: 'The ClickHouse password.' }],
  },
  {
    id: 'elasticsearch',
    title: 'Elasticsearch',
    description: 'Search Elasticsearch indices and read their mappings.',
    homepage: 'https://github.com/elastic/mcp-server-elasticsearch',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@elastic/mcp-server-elasticsearch'] },
    requires: [{ name: 'ES_URL', description: 'The Elasticsearch address.' }, { name: 'ES_API_KEY', description: 'An Elasticsearch API key.' }],
  },
  {
    id: 'chroma',
    title: 'Chroma',
    description: 'A local vector database for storing and searching embeddings and documents.',
    homepage: 'https://github.com/chroma-core/chroma-mcp',
    launch: { transport: 'stdio', command: 'uvx', args: ['chroma-mcp'] },
    requires: [],
  },
  {
    id: 'basic-memory',
    title: 'Basic Memory',
    description: 'Long-term notes kept as local Markdown files that the agent reads and writes across sessions.',
    homepage: 'https://github.com/basicmachines-co/basic-memory',
    launch: { transport: 'stdio', command: 'uvx', args: ['basic-memory', 'mcp'] },
    requires: [],
  },
  {
    id: 'serena',
    title: 'Serena',
    description: 'Symbol-level code navigation and editing through language servers, for large codebases.',
    homepage: 'https://github.com/oraios/serena',
    launch: { transport: 'stdio', command: 'uvx', args: ['--from', 'serena-agent', 'serena', 'start-mcp-server'] },
    requires: [],
  },
  {
    id: 'semgrep',
    title: 'Semgrep',
    description: 'Scan code for security vulnerabilities and bugs with Semgrep rules.',
    homepage: 'https://github.com/semgrep/mcp',
    launch: { transport: 'stdio', command: 'uvx', args: ['semgrep-mcp'] },
    requires: [],
  },
  {
    id: 'snyk',
    title: 'Snyk',
    description: 'Scan code, dependencies, containers and infrastructure files for vulnerabilities with your Snyk sign-in.',
    homepage: 'https://docs.snyk.io/integrations/snyk-studio-agentic-integrations',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'snyk@latest', 'mcp', '-t', 'stdio'] },
    requires: [],
  },
  {
    id: 'circleci',
    title: 'CircleCI',
    description: 'Read CircleCI build failures, flaky tests and pipeline status.',
    homepage: 'https://github.com/CircleCI-Public/mcp-server-circleci',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@circleci/mcp-server-circleci'] },
    requires: [{ name: 'CIRCLECI_TOKEN', description: 'A CircleCI personal API token.' }],
  },
  {
    id: 'e2b',
    title: 'E2B sandbox',
    description: 'Run code in a secure cloud sandbox.',
    homepage: 'https://github.com/e2b-dev/mcp-server',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@e2b/mcp-server'] },
    requires: [{ name: 'E2B_API_KEY', description: 'An E2B API key.' }],
  },
  {
    id: 'apify',
    title: 'Apify',
    description: 'Run Apify actors to scrape and extract data from websites and apps.',
    homepage: 'https://github.com/apify/actors-mcp-server',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@apify/actors-mcp-server'] },
    requires: [{ name: 'APIFY_TOKEN', description: 'An Apify API token.' }],
  },
  {
    id: 'browserbase',
    title: 'Browserbase',
    description: 'Drive a cloud browser: navigate, act, extract and take screenshots.',
    homepage: 'https://github.com/browserbase/mcp-server-browserbase',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@browserbasehq/mcp-server-browserbase'] },
    requires: [{ name: 'BROWSERBASE_API_KEY', description: 'A Browserbase API key.' }, { name: 'BROWSERBASE_PROJECT_ID', description: 'The Browserbase project id.' }],
  },
  {
    id: 'elevenlabs',
    title: 'ElevenLabs',
    description: 'Text to speech, voice cloning and audio transcription.',
    homepage: 'https://github.com/elevenlabs/elevenlabs-mcp',
    launch: { transport: 'stdio', command: 'uvx', args: ['elevenlabs-mcp'] },
    requires: [{ name: 'ELEVENLABS_API_KEY', description: 'An ElevenLabs API key.' }],
  },
  {
    id: 'blender',
    title: 'Blender',
    description: 'Create and edit 3D scenes in a running Blender with its MCP add-on.',
    homepage: 'https://github.com/ahujasid/blender-mcp',
    launch: { transport: 'stdio', command: 'uvx', args: ['blender-mcp'] },
    requires: [],
  },
  {
    id: 'excel',
    title: 'Excel files',
    description: 'Create, read and edit Excel workbooks: cells, formulas, formatting and charts.',
    homepage: 'https://github.com/haris-musa/excel-mcp-server',
    launch: { transport: 'stdio', command: 'uvx', args: ['excel-mcp-server', 'stdio'] },
    requires: [],
  },
  {
    id: 'pandoc',
    title: 'Pandoc',
    description: 'Convert documents between Markdown, HTML, Word, PDF and other formats.',
    homepage: 'https://github.com/vivekVells/mcp-pandoc',
    launch: { transport: 'stdio', command: 'uvx', args: ['mcp-pandoc'] },
    requires: [],
  },
  {
    id: 'xcodebuild',
    title: 'Xcode build',
    description: 'Build, test and run Xcode projects and control iOS simulators (macOS).',
    homepage: 'https://github.com/cameroncooke/XcodeBuildMCP',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', 'xcodebuildmcp@latest'] },
    requires: [],
  },
  {
    id: 'mobile',
    title: 'Mobile devices',
    description: 'Drive iOS and Android simulators, emulators and devices: tap, type, screenshot, read the screen.',
    homepage: 'https://github.com/mobile-next/mobile-mcp',
    launch: { transport: 'stdio', command: 'npx', args: ['-y', '@mobilenext/mobile-mcp@latest'] },
    requires: [],
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

/**
 * The connectors, in display order. Each one authorizes with OAuth and registers this app on first sign-in, so only
 * services whose authorization server accepts self-registration are listed; an account on any other service is
 * reached through a website session instead.
 */
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
  {
    id: 'gitlab', title: 'GitLab', description: 'Work with GitLab projects, issues, merge requests and pipelines.',
    homepage: 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/', url: 'https://gitlab.com/api/v4/mcp',
  },
  {
    id: 'clickup', title: 'ClickUp', description: 'Search, create and update ClickUp tasks, lists and docs.',
    homepage: 'https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server', url: 'https://mcp.clickup.com/mcp',
  },
  {
    id: 'airtable', title: 'Airtable', description: 'Read and change Airtable bases, tables and records.',
    homepage: 'https://support.airtable.com/docs/using-the-airtable-mcp-server', url: 'https://mcp.airtable.com/mcp',
  },
  {
    id: 'cloudflare', title: 'Cloudflare', description: 'Manage Cloudflare Workers, KV, R2, D1 and other account resources.',
    homepage: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/', url: 'https://bindings.mcp.cloudflare.com/mcp',
  },
  {
    id: 'netlify', title: 'Netlify', description: 'Create, deploy and manage Netlify sites, and read their build logs.',
    homepage: 'https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/', url: 'https://netlify-mcp.netlify.app/mcp',
  },
  {
    id: 'prisma', title: 'Prisma Postgres', description: 'Create and manage Prisma Postgres databases, run SQL and manage backups.',
    homepage: 'https://www.prisma.io/docs/postgres/integrations/mcp-server', url: 'https://mcp.prisma.io/mcp',
  },
  {
    id: 'webflow', title: 'Webflow', description: 'Read and edit Webflow sites, pages, collections and CMS items.',
    homepage: 'https://developers.webflow.com/data/docs/ai-tools', url: 'https://mcp.webflow.com/mcp',
  },
  {
    id: 'wix', title: 'Wix', description: 'Manage Wix sites and business data, and search the Wix developer docs.',
    homepage: 'https://dev.wix.com/docs/sdk/articles/use-the-wix-mcp/about-the-wix-mcp', url: 'https://mcp.wix.com/mcp',
  },
  {
    id: 'paypal', title: 'PayPal', description: 'Read PayPal transactions, invoices, orders and disputes, and create invoices.',
    homepage: 'https://developer.paypal.com/tools/mcp-server/', url: 'https://mcp.paypal.com/mcp',
  },
  {
    id: 'jam', title: 'Jam', description: 'Read Jam bug reports with their console logs, network requests and recordings.',
    homepage: 'https://jam.dev/docs/debug-a-jam/mcp', url: 'https://mcp.jam.dev/mcp',
  },
  {
    id: 'figma-account', title: 'Figma', description: 'Read Figma designs, variables and components to implement them in code.',
    homepage: 'https://developers.figma.com/docs/figma-mcp-server/', url: 'https://mcp.figma.com/mcp',
  },
  {
    id: 'zapier', title: 'Zapier', description: 'Run actions across the apps connected to your Zapier account.',
    homepage: 'https://zapier.com/mcp', url: 'https://mcp.zapier.com/api/mcp/mcp',
  },
  {
    id: 'pipedream', title: 'Pipedream', description: 'Call the APIs of the apps connected to your Pipedream account.',
    homepage: 'https://pipedream.com/docs/connect/mcp', url: 'https://mcp.pipedream.net/v2',
  },
  {
    id: 'todoist', title: 'Todoist', description: 'Find, add, complete and organise Todoist tasks and projects.',
    homepage: 'https://developer.todoist.com/api/v1/#tag/Todoist-MCP', url: 'https://ai.todoist.net/mcp',
  },
  {
    id: 'dropbox', title: 'Dropbox', description: 'Search, read and organise files and folders in Dropbox.',
    homepage: 'https://help.dropbox.com/integrations/set-up-MCP-server', url: 'https://mcp.dropbox.com/mcp',
  },
  {
    id: 'miro', title: 'Miro', description: 'Read Miro boards and create diagrams and documents on them.',
    homepage: 'https://developers.miro.com/docs/miro-mcp', url: 'https://mcp.miro.com/',
  },
  {
    id: 'gamma', title: 'Gamma', description: 'Create presentations, documents and web pages with Gamma.',
    homepage: 'https://developers.gamma.app/docs/gamma-mcp-server', url: 'https://mcp.gamma.app/mcp',
  },
  {
    id: 'granola', title: 'Granola', description: 'Search and read your Granola meeting notes and transcripts.',
    homepage: 'https://www.granola.ai', url: 'https://mcp.granola.ai/mcp',
  },
  {
    id: 'fireflies', title: 'Fireflies', description: 'Search meeting transcripts and summaries in Fireflies.',
    homepage: 'https://docs.fireflies.ai/getting-started/mcp-configuration', url: 'https://mcp.fireflies.ai/mcp',
  },
  {
    id: 'gong', title: 'Gong', description: 'Search Gong calls and read their transcripts and insights.',
    homepage: 'https://www.gong.io', url: 'https://mcp.gong.io/mcp',
  },
  {
    id: 'cal-com', title: 'Cal.com', description: 'Read availability and manage Cal.com bookings and event types.',
    homepage: 'https://cal.com/docs/mcp-server', url: 'https://mcp.cal.com/mcp',
  },
  {
    id: 'resend', title: 'Resend', description: 'Send email and manage domains, contacts and broadcasts with Resend.',
    homepage: 'https://resend.com/docs/mcp-server', url: 'https://mcp.resend.com/mcp',
  },
  {
    id: 'attio', title: 'Attio', description: 'Search and update Attio CRM records, lists and notes.',
    homepage: 'https://docs.attio.com/mcp/overview', url: 'https://mcp.attio.com/mcp',
  },
  {
    id: 'close', title: 'Close', description: 'Search and update Close CRM leads, contacts and opportunities.',
    homepage: 'https://help.close.com/docs/mcp-server', url: 'https://mcp.close.com/mcp',
  },
  {
    id: 'apollo', title: 'Apollo', description: 'Search Apollo for people and companies and manage sequences.',
    homepage: 'https://docs.apollo.io', url: 'https://mcp.apollo.io/mcp',
  },
  {
    id: 'zoominfo', title: 'ZoomInfo', description: 'Look up companies and contacts in ZoomInfo.',
    homepage: 'https://www.zoominfo.com', url: 'https://mcp.zoominfo.com/mcp',
  },
  {
    id: 'similarweb', title: 'Similarweb', description: 'Website traffic, audience and competitor data from Similarweb.',
    homepage: 'https://www.similarweb.com', url: 'https://mcp.similarweb.com',
  },
  {
    id: 'pitchbook', title: 'PitchBook', description: 'Private-market data on companies, deals, funds and investors.',
    homepage: 'https://pitchbook.com', url: 'https://mcp.pitchbook.com/mcp',
  },
  {
    id: 'daloopa', title: 'Daloopa', description: 'Company financials and KPIs sourced from filings.',
    homepage: 'https://docs.daloopa.com/docs/daloopa-mcp', url: 'https://mcp.daloopa.com/server/mcp',
  },
  {
    id: 'plaid', title: 'Plaid', description: 'Inspect Plaid integrations: items, link analytics and diagnostics.',
    homepage: 'https://plaid.com/docs/resources/mcp/', url: 'https://mcp.plaid.com/mcp',
  },
  {
    id: 'square', title: 'Square', description: 'Read and manage Square payments, orders, customers and catalog.',
    homepage: 'https://developer.squareup.com/docs/mcp', url: 'https://mcp.squareup.com/mcp',
  },
  {
    id: 'mercury', title: 'Mercury', description: 'Read Mercury bank accounts, transactions and statements.',
    homepage: 'https://docs.mercury.com/docs/what-is-mercury-mcp', url: 'https://mcp.mercury.com/mcp',
  },
  {
    id: 'ramp', title: 'Ramp', description: 'Read Ramp spend, transactions, bills and reimbursements.',
    homepage: 'https://docs.ramp.com/developer-api/v1/guides/ramp-mcp-remote', url: 'https://mcp.ramp.com/mcp',
  },
  {
    id: 'alchemy', title: 'Alchemy', description: 'Blockchain data: balances, transactions, tokens and prices across chains.',
    homepage: 'https://www.alchemy.com/docs/alchemy-mcp-server', url: 'https://mcp.alchemy.com/mcp',
  },
  {
    id: 'heroku', title: 'Heroku', description: 'Manage Heroku apps, dynos, add-ons and logs.',
    homepage: 'https://devcenter.heroku.com/articles/heroku-mcp-server', url: 'https://mcp.heroku.com/mcp',
  },
  {
    id: 'railway', title: 'Railway', description: 'Manage Railway projects, services, deployments and variables.',
    homepage: 'https://docs.railway.com/reference/mcp-server', url: 'https://mcp.railway.app/mcp',
  },
  {
    id: 'digitalocean', title: 'DigitalOcean', description: 'Manage DigitalOcean apps, droplets, databases and other resources.',
    homepage: 'https://docs.digitalocean.com/reference/mcp/', url: 'https://mcp.digitalocean.com/mcp',
  },
  {
    id: 'clickhouse-cloud', title: 'ClickHouse Cloud', description: 'Run SQL on ClickHouse Cloud services and manage them.',
    homepage: 'https://clickhouse.com/docs/use-cases/AI/MCP/remote_mcp', url: 'https://mcp.clickhouse.cloud/mcp',
  },
  {
    id: 'algolia', title: 'Algolia', description: 'Search Algolia indices and read their settings and analytics.',
    homepage: 'https://www.algolia.com/doc/guides/algolia-ai/mcp-server/', url: 'https://mcp.algolia.com/mcp',
  },
  {
    id: 'sanity', title: 'Sanity', description: 'Query and edit Sanity content, schemas and releases.',
    homepage: 'https://www.sanity.io/docs/compute-and-ai/mcp-server', url: 'https://mcp.sanity.io',
  },
  {
    id: 'mapbox', title: 'Mapbox', description: 'Geocoding, directions, places and map styles from Mapbox.',
    homepage: 'https://docs.mapbox.com/api/guides/mcp-server/', url: 'https://mcp.mapbox.com/mcp',
  },
  {
    id: 'clerk', title: 'Clerk', description: 'Clerk SDK guidance and snippets, and management of users and organisations.',
    homepage: 'https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server', url: 'https://mcp.clerk.com/mcp',
  },
  {
    id: 'stytch', title: 'Stytch', description: 'Manage Stytch projects, redirect URLs and authentication settings.',
    homepage: 'https://stytch.com/docs/workspace-management/stytch-mcp', url: 'https://mcp.stytch.dev/mcp',
  },
  {
    id: 'postman', title: 'Postman', description: 'Work with Postman collections, environments, workspaces and APIs.',
    homepage: 'https://learning.postman.com/docs/developer/postman-api/postman-mcp-server/overview/', url: 'https://mcp.postman.com/mcp',
  },
  {
    id: 'buildkite', title: 'Buildkite', description: 'Read Buildkite pipelines, builds, jobs and logs.',
    homepage: 'https://buildkite.com/docs/apis/mcp-server', url: 'https://mcp.buildkite.com/mcp',
  },
  {
    id: 'launchdarkly', title: 'LaunchDarkly', description: 'Manage LaunchDarkly feature flags and their targeting.',
    homepage: 'https://docs.launchdarkly.com/home/getting-started/mcp', url: 'https://mcp.launchdarkly.com/mcp',
  },
  {
    id: 'semgrep-cloud', title: 'Semgrep AppSec', description: 'Read Semgrep findings for your organisation and scan code.',
    homepage: 'https://semgrep.dev/docs/mcp', url: 'https://mcp.semgrep.ai/mcp',
  },
  {
    id: 'datadog', title: 'Datadog', description: 'Query Datadog logs, metrics, traces, monitors and incidents.',
    homepage: 'https://docs.datadoghq.com/bits_ai/mcp_server/', url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
  },
  {
    id: 'grafana', title: 'Grafana Cloud', description: 'Query Grafana dashboards, metrics, logs and alerts.',
    homepage: 'https://grafana.com/docs/grafana-cloud/machine-learning/assistant/', url: 'https://mcp.grafana.com/mcp',
  },
  {
    id: 'honeycomb', title: 'Honeycomb', description: 'Query Honeycomb traces, events and service level objectives.',
    homepage: 'https://docs.honeycomb.io/integrations/mcp/', url: 'https://mcp.honeycomb.io/mcp',
  },
  {
    id: 'axiom', title: 'Axiom', description: 'Query Axiom datasets with APL and read monitors.',
    homepage: 'https://axiom.co/docs/console/intelligence/mcp-server', url: 'https://mcp.axiom.co/mcp',
  },
  {
    id: 'posthog', title: 'PostHog', description: 'Query PostHog analytics, feature flags, experiments and error tracking.',
    homepage: 'https://posthog.com/docs/model-context-protocol', url: 'https://mcp.posthog.com/mcp',
  },
  {
    id: 'amplitude', title: 'Amplitude', description: 'Query Amplitude charts, dashboards, experiments and user data.',
    homepage: 'https://amplitude.com/docs/amplitude-ai/amplitude-mcp', url: 'https://mcp.amplitude.com/mcp',
  },
  {
    id: 'mixpanel', title: 'Mixpanel', description: 'Query Mixpanel events, funnels, retention and session replays.',
    homepage: 'https://docs.mixpanel.com/docs/features/mcp', url: 'https://mcp.mixpanel.com/mcp',
  },
]
