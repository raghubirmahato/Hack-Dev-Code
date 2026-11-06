/**
 * On-demand tool groups: large tool families (desktop control, a browser) stay out of every request until the
 * agent loads them, so a step does not pay for dozens of definitions it never uses.
 * @module @hackdevcode/dsh-tools/groups
 */

/** Name of the model-facing tool that loads a group. */
export const LOAD_TOOLS_NAME = 'load_tools'

/** One declared group. */
interface GroupRecord {
  readonly description: string
  /** Registrations currently tagged with the group. */
  members: number
}

/** The groups declared in one tool runtime and which agents have loaded them. */
export class ToolGroups {
  private readonly groups = new Map<string, GroupRecord>()
  private readonly loaded = new WeakMap<object, Set<string>>()

  /**
   * Declare a group, or count one more member of an existing group.
   * @param name - group name, such as `desktop`.
   * @param description - what the group's tools do, shown to the model.
   * @returns the disposer that removes this member, and the group when it was the last.
   */
  join(name: string, description: string): () => void {
    const record = this.groups.get(name)
    if (record === undefined) this.groups.set(name, { description, members: 1 })
    else record.members += 1
    let joined = true
    return () => {
      if (!joined) return
      joined = false
      const current = this.groups.get(name)
      if (current === undefined) return
      current.members -= 1
      if (current.members <= 0) this.groups.delete(name)
    }
  }

  /** Whether any group is declared. */
  get size(): number {
    return this.groups.size
  }

  /**
   * Whether an agent has loaded a group.
   * @param agent - the agent preparing a step.
   * @param name - group name.
   */
  isLoaded(agent: object, name: string): boolean {
    return this.loaded.get(agent)?.has(name) === true
  }

  /**
   * Load a group for one agent.
   * @param agent - the calling agent.
   * @param name - group name.
   * @returns false when no such group is declared.
   */
  load(agent: object, name: string): boolean {
    if (!this.groups.has(name)) return false
    let set = this.loaded.get(agent)
    if (set === undefined) {
      set = new Set()
      this.loaded.set(agent, set)
    }
    set.add(name)
    return true
  }

  /**
   * Describe every group for the model, marking the ones an agent already loaded.
   * @param agent - the agent the description is for, when known.
   * @returns one line per group.
   */
  describe(agent?: object): string {
    return [...this.groups].map(([name, record]) =>
      `- ${name}${agent !== undefined && this.isLoaded(agent, name) ? ' (loaded)' : ''}: ${record.description}`).join('\n')
  }
}
