import { createUserMessage } from '@hackdevcode/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { SessionId } from '@hackdevcode/dsh-session'
import type { Agent } from '@hackdevcode/dsh-agent'
import AgentLoop from '@hackdevcode/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@hackdevcode/dsh-agent-loop-testkit'
import * as ToolTodo from '@hackdevcode/dsh-tool-todo'
import { unfinishedTodosReminder } from '@hackdevcode/dsh-tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * A model that finishes while its own todo list still shows unfinished items is asked once per turn to bring the
 * list up to date, so the person never sees a stale "in progress" list after the work is done.
 */
async function run(script: ConstructorParameters<typeof MockAdapter>[0]): Promise<{ adapter: MockAdapter; agent: Agent }> {
  const adapter = new MockAdapter(script)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('todo-reminder'), { provider: 'mock', model: 'mock' })
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { dispose(); resolve() } })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do the task' }], source: { kind: 'user' } }))
  await idle
  return { adapter, agent }
}

/** How many reminders a request's history carries. */
const reminders = (request: unknown): number => JSON.stringify(request).split('Your todo list still shows').length - 1

describe('unfinished todos at the end of a turn', () => {
  it('asks once to update the list, and the final list is the one the model writes', async () => {
    const { adapter, agent } = await run([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'render', status: 'completed' }, { content: 'save', status: 'in_progress' }] }),
      textResponse('All done.'),
      toolCallResponse('c2', 'todo_write', { todos: [{ content: 'render', status: 'completed' }, { content: 'save', status: 'completed' }] }),
      textResponse('All done, list updated.'),
    ])
    expect(adapter.requests.map(reminders)).toEqual([0, 0, 1, 1])
    expect(JSON.stringify(adapter.requests[2])).toContain('- save (in progress)')
    const writes = agent.session.snapshotEvents().filter(event => event.type === 'todo/write')
    expect(writes.at(-1)?.data.todos.every(item => item.status === 'completed')).toBe(true)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('does not ask twice in a turn, nor when every item is completed or no list was written', async () => {
    const twice = await run([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'a', status: 'pending' }] }),
      textResponse('Stopping here.'),
      textResponse('Still stopping; the item waits for the person.'),
    ])
    expect(twice.adapter.requests.map(reminders)).toEqual([0, 0, 1])
    const complete = await run([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'a', status: 'completed' }] }),
      textResponse('Done.'),
    ])
    expect(complete.adapter.requests).toHaveLength(2)
    const none = await run([textResponse('Nothing to plan.')])
    expect(none.adapter.requests).toHaveLength(1)
  })

  it('names each unfinished item with its state', () => {
    expect(unfinishedTodosReminder([{ content: 'Save .blend', status: 'in_progress' }, { content: 'Open Blender', status: 'pending' }]))
      .toContain('2 unfinished items:\n- Save .blend (in progress)\n- Open Blender (pending)')
  })
})
