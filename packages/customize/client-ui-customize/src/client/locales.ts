/** English copy of the Customize settings section. */

/** Dictionary keys of the Customize settings section. */
export type CustomizeLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'tabSkills' | 'tabConnectors' | 'tabServers'
  | 'loading' | 'retry' | 'website' | 'badName' | 'name'
  | 'skillsIntro' | 'skillInstall' | 'skillRemove' | 'skillInstalled' | 'skillOther'
  | 'connectorsIntro' | 'connectorConnect' | 'connectorSignIn' | 'connectorDisconnect' | 'connectorConnected'
  | 'connectorPending' | 'connectorOpened' | 'connectorAddTitle' | 'connectorUrl' | 'connectorAdd'
  | 'serversIntro' | 'serverSwitch' | 'serverCustom' | 'serverRemove' | 'serverSave' | 'serverFolders'
  | 'serverAddTitle' | 'serverCommand' | 'serverAdd' | 'pluginsNote'

/** English dictionary. */
export const en: Record<CustomizeLocaleKey, string> = {
  nav: 'Customize',
  title: 'Customize',
  intro: 'Give the agent more to work with: skills it can follow, accounts it can reach and MCP servers it can call.',
  tabs: 'Customize pages',
  tabSkills: 'Skills',
  tabConnectors: 'Connectors',
  tabServers: 'MCP servers',
  loading: 'Loading…',
  retry: 'Try again',
  website: 'Website',
  badName: 'Start the name with a letter and use at most 32 letters, digits and spaces.',
  name: 'Name',
  skillsIntro: 'A skill is a folder of instructions the agent reads when a task calls for it. New sessions see an installed skill.',
  skillInstall: 'Install',
  skillRemove: 'Remove',
  skillInstalled: 'Installed',
  skillOther: 'Installed separately',
  connectorsIntro: 'A connector signs in to a service in your browser and lets the agent use it. The sign-in is kept in the credential store.',
  connectorConnect: 'Connect',
  connectorSignIn: 'Sign in',
  connectorDisconnect: 'Disconnect',
  connectorConnected: 'Connected',
  connectorPending: 'Sign-in needed',
  connectorOpened: 'Finish signing in to {name} in the browser window that opened.',
  connectorAddTitle: 'Add a connector by address',
  connectorUrl: 'MCP address, such as https://example.com/mcp',
  connectorAdd: 'Add connector',
  serversIntro: 'An MCP server adds tools to the agent. Turn on one from the directory, or add your own.',
  serverSwitch: 'Use {name}',
  serverCustom: 'Yours',
  serverRemove: 'Remove',
  serverSave: 'Save',
  serverFolders: 'Folders it may open, separated by commas',
  serverAddTitle: 'Add your own server',
  serverCommand: 'Command to start it, or its https address',
  serverAdd: 'Add server',
  pluginsNote: 'Looking for plugins? Open the Plugins page and choose Discover.',
}
