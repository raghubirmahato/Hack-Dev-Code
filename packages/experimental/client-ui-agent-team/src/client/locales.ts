/** Agent Teams Web dictionaries. */

/** Locale namespace owned by the Agent Teams Web UI. */
export const NS = 'agent-team'

/** Agent Teams locale key union. */
export type TeamKey = keyof typeof en

/** English dictionary (the key-set source of truth). */
export const en = {
  trigger: 'Agent team',
  loading: 'Loading team…',
  unavailable: 'Team is unavailable',
  failure: 'Invalid persisted team record: {message}',
  empty: 'No shared tasks yet. Create them through the conversation.',
  roster: 'Members',
  tasks: 'Shared tasks',
  model: 'Model',
  open: 'Open member conversation',
  current: 'Current chat',
  owner: 'Owner',
  unowned: 'Unowned',
  blockedBy: 'Blocked by',
  writeScopes: 'Write scopes',
  ready: 'Ready',
  blocked: 'Blocked by dependencies',
  'task.expand': 'Show more',
  'task.collapse': 'Show less',
  'memberStatus.running': 'Running',
  'memberStatus.inactive': 'Inactive',
  'memberStatus.provisioning': 'Provisioning',
  'memberStatus.failed': 'Failed',
  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
} satisfies Record<string, string>
