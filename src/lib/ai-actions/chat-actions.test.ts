import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BUILTIN_ACTIONS, actionById } from './registry'
import { validateArgs } from './types'
import { useProjectStore } from '@/store/project'
import { useAiStore, makeChat, type AiChat, type ChatMessage } from '@/store/ai'

vi.mock('@/lib/ai-preferences-persistence', () => ({
  loadAiPreferences: vi.fn(), saveAiPreferences: () => Promise.resolve(),
}))

const chatGroup = BUILTIN_ACTIONS.filter((a) => a.group === 'chat')

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ id: `${role}:${content}`, role, content, timestamp: 0 })

function seed(): AiChat[] {
  return [
    {
      ...makeChat('anthropic', 'claude-opus-4-6'),
      id: 'older', title: 'Buffer the roads', updatedAt: 1000,
      messages: [msg('user', 'buffer roads by 50m'), msg('assistant', 'Used 50 metres.')],
    },
    {
      ...makeChat('llamacpp', 'local-8b'),
      id: 'current', title: 'Today', updatedAt: 2000, messages: [msg('user', 'hello')],
    },
  ]
}

/** Run an action the way the tool layer does: arguments validated FIRST. */
async function run(id: string, args: Record<string, unknown> = {}): Promise<string> {
  const action = actionById(id)!
  const bad = validateArgs(action, args)
  if (bad) return `INVALID: ${bad}`
  const res = await action.run(args)
  if (typeof res === 'string') return res
  // The same shape ai-ui-tools.ts hands the model: message, then `data` when
  // it is a string.
  const body = typeof res.data === 'string' && res.data ? `\n\n${res.data}` : ''
  return `${res.ok ? '' : 'FAILED: '}${res.message}${body}`
}

beforeEach(() => {
  useProjectStore.setState({ path: '/saved/project.ourgeoproj', projectId: 'saved-project' })
  useAiStore.setState({ chats: seed(), activeChatId: 'current' })
})

describe('the chat group', () => {
  it('offers exactly two actions, both read-only', () => {
    // The deliberate omission. CLAUDE.md: "an assistant that can close its own
    // panel can end the conversation" — switching or deleting a chat is that
    // hazard one step worse, so neither is here. If this list ever grows a
    // `chat:switch`, it was a decision, not an oversight.
    expect(chatGroup.map((a) => a.id).sort()).toEqual(['chat:list', 'chat:read'])
  })

  it('touches neither R nor disk, so neither needs Autopilot', () => {
    for (const a of chatGroup) {
      expect(a.tier).toBe('always')
      expect(a.requires).toBeUndefined()
    }
  })
})

describe('chat:list', () => {
  it('names every chat, its size, and the model it was held with', async () => {
    const out = await run('chat:list')
    expect(out).toContain('2 chats in this project')
    expect(out).toContain('"Buffer the roads"')
    expect(out).toContain('2 messages')
    expect(out).toContain('claude-opus-4-6')
    expect(out).toContain('local-8b')
  })

  it('says which one the assistant is in', async () => {
    // Otherwise a model reads back the conversation it is already having.
    expect(await run('chat:list')).toContain('THIS conversation')
  })

  it('says outright that it cannot switch or delete', async () => {
    // Cheaper than a refusal: a model told what it cannot do does not spend a
    // turn discovering it, and tells the user where the control is instead.
    const out = await run('chat:list')
    expect(out).toMatch(/cannot switch or delete/i)
    expect(out).toMatch(/chat switcher/i)
  })
})

describe('chat:read', () => {
  it('refuses without an id, before the handler runs', async () => {
    expect(await run('chat:read')).toMatch(/^INVALID:/)
  })

  it('reads an earlier conversation', async () => {
    const out = await run('chat:read', { id: 'older' })
    expect(out).toContain('User: buffer roads by 50m')
    expect(out).toContain('Assistant: Used 50 metres.')
  })

  it('accepts the title, because that is what a model has just been shown', async () => {
    expect(await run('chat:read', { id: 'Buffer the roads' })).toContain('Used 50 metres.')
  })

  it('names the way out when there is no such chat', async () => {
    const out = await run('chat:read', { id: 'nonsense' })
    expect(out).toMatch(/^FAILED:/)
    expect(out).toContain('chat:list')
  })

  it('redirects rather than repeating the conversation it is in', async () => {
    const out = await run('chat:read', { id: 'current' })
    expect(out).toMatch(/^FAILED:/)
    expect(out).toMatch(/already in/i)
  })

  it('says an empty chat is empty', async () => {
    useAiStore.setState({
      chats: [{ ...makeChat('anthropic', 'x'), id: 'blank', title: 'Blank' },
        ...useAiStore.getState().chats],
    })
    expect(await run('chat:read', { id: 'blank' })).toContain('is empty')
  })
})


describe('scratch conversation boundaries', () => {
  it('does not list or read another scratch conversation without attachment', async () => {
    useProjectStore.setState({ path: null, projectId: null })
    expect(await run('chat:list')).not.toContain('Buffer the roads')
    expect(await run('chat:read', { id: 'older' })).toMatch(/^FAILED:/)
  })
})
