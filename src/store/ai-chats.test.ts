import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useAiStore, selectActiveChat, selectMessages, makeChat, titleFor, type ChatMessage,
} from './ai'

// The store writes preferences on setProvider/setModel; the point of several
// of these tests is that switching a chat does NOT, so the file store is
// stubbed and asserted against.
const saved: Record<string, unknown>[] = []
vi.mock('@/lib/ai-preferences-persistence', () => ({
  loadAiPreferences: vi.fn(),
  saveAiPreferences: (p: Record<string, unknown>) => { saved.push(p); return Promise.resolve() },
}))

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ id: `${role}-${content}`, role, content, timestamp: 0 })

const active = () => selectActiveChat(useAiStore.getState())!
const titles = (): string[] => useAiStore.getState().chats.map((c) => c.title)

beforeEach(() => {
  saved.length = 0
  const chat = makeChat('anthropic', 'claude-opus-4-6')
  useAiStore.setState({
    chats: [chat], activeChatId: chat.id,
    provider: 'anthropic',
    modelByProvider: { anthropic: 'claude-opus-4-6', llamacpp: 'local-8b', openai: 'gpt-4o' },
    isStreaming: false, streamingContent: '', abortController: null,
  })
})

describe('naming a chat', () => {
  it('takes the first thing the user said', () => {
    expect(titleFor([msg('user', 'Buffer the roads layer by 50m')]))
      .toBe('Buffer the roads layer by 50m')
  })

  it('elides a long opening question rather than filling the switcher with it', () => {
    const long = titleFor([msg('user', 'x'.repeat(200))])
    expect(long.length).toBeLessThanOrEqual(44)
    expect(long.endsWith('…')).toBe(true)
  })

  it('flattens the newlines a pasted question arrives with', () => {
    expect(titleFor([msg('user', 'Why does\n\n  this fail?')])).toBe('Why does this fail?')
  })

  it('ignores an assistant message — the chat is named by what was asked', () => {
    expect(titleFor([msg('assistant', 'Certainly!')], 'New chat')).toBe('New chat')
  })
})

describe('starting another conversation', () => {
  it('keeps the one you were in — the whole point of the feature', () => {
    useAiStore.getState().addMessage(msg('user', 'first question'))
    const firstId = useAiStore.getState().activeChatId

    useAiStore.getState().newChat()

    expect(useAiStore.getState().chats).toHaveLength(2)
    expect(useAiStore.getState().activeChatId).not.toBe(firstId)
    expect(selectMessages(useAiStore.getState())).toHaveLength(0)
    // …and the first is intact, not merely present.
    const first = useAiStore.getState().chats.find((c) => c.id === firstId)!
    expect(first.messages.map((m) => m.content)).toEqual(['first question'])
  })

  it('starts on the provider and model currently selected', () => {
    useAiStore.setState({ provider: 'llamacpp' })
    useAiStore.getState().newChat()
    expect(active().provider).toBe('llamacpp')
    expect(active().model).toBe('local-8b')
  })
})

describe('a message', () => {
  it('lands in the active chat and names it', () => {
    useAiStore.getState().addMessage(msg('user', 'How many rows in pts?'))
    expect(active().title).toBe('How many rows in pts?')
    expect(active().messages).toHaveLength(1)
  })

  it('never renames a chat the user named', () => {
    const id = useAiStore.getState().activeChatId!
    useAiStore.getState().renameChat(id, 'Roads work')
    useAiStore.getState().addMessage(msg('user', 'something else entirely'))
    expect(active().title).toBe('Roads work')
  })

  it('moves the chat to the top of the switcher', () => {
    const before = active().updatedAt
    vi.setSystemTime(new Date(Date.now() + 5000))
    useAiStore.getState().addMessage(msg('user', 'later'))
    expect(active().updatedAt).toBeGreaterThan(before)
    vi.useRealTimers()
  })
})

describe('switching', () => {
  it('restores the provider and model that chat was held with', () => {
    // The decision this test exists for: continuing an Opus conversation on a
    // local 8B, silently, because the model selector is a global.
    useAiStore.getState().addMessage(msg('user', 'opus question'))
    const opusChat = useAiStore.getState().activeChatId!

    useAiStore.setState({ provider: 'llamacpp' })
    useAiStore.getState().newChat()
    useAiStore.getState().addMessage(msg('user', 'local question'))

    useAiStore.getState().switchChat(opusChat)
    expect(useAiStore.getState().provider).toBe('anthropic')
    expect(useAiStore.getState().currentModel()).toBe('claude-opus-4-6')
  })

  it('does NOT rewrite the saved default', () => {
    // `switchChat` must not go through setProvider/setModel: opening an old
    // chat would change what the NEXT new one starts on, and would survive a
    // restart having never been asked for.
    useAiStore.getState().newChat()
    useAiStore.setState({
      chats: useAiStore.getState().chats.map((c, i) =>
        i === 1 ? { ...c, provider: 'openai' as const, model: 'gpt-4o' } : c),
    })
    // Away and back: `newChat` already left the second one active, and
    // switching to the chat you are in is correctly a no-op.
    useAiStore.getState().switchChat(useAiStore.getState().chats[0].id)
    saved.length = 0
    useAiStore.getState().switchChat(useAiStore.getState().chats[1].id)
    expect(useAiStore.getState().provider).toBe('openai')
    expect(saved).toEqual([])
  })

  it('stops a running turn first, so its answer stays in its own chat', () => {
    useAiStore.getState().newChat()
    const second = useAiStore.getState().activeChatId!
    const ac = useAiStore.getState().beginStream()
    useAiStore.getState().appendStreamChunk('half an answer')

    useAiStore.getState().switchChat(useAiStore.getState().chats[0].id)

    expect(ac.signal.aborted).toBe(true)
    expect(useAiStore.getState().streamingContent).toBe('')
    const left = useAiStore.getState().chats.find((c) => c.id === second)!
    expect(left.messages.map((m) => m.content)).toEqual(['half an answer'])
    // …and nothing leaked into the chat that was opened.
    expect(selectMessages(useAiStore.getState())).toHaveLength(0)
  })

  it('is a no-op for a chat that is not there', () => {
    const before = useAiStore.getState().activeChatId
    useAiStore.getState().switchChat('no-such-chat')
    expect(useAiStore.getState().activeChatId).toBe(before)
  })
})

describe('deleting', () => {
  const three = (): string[] => {
    const ids = [useAiStore.getState().activeChatId!]
    useAiStore.getState().renameChat(ids[0], 'one')
    ids.push(useAiStore.getState().newChat())
    useAiStore.getState().renameChat(ids[1], 'two')
    ids.push(useAiStore.getState().newChat())
    useAiStore.getState().renameChat(ids[2], 'three')
    return ids
  }

  it('activates the NEIGHBOUR, not the first', () => {
    // Deleting the middle of three and landing on the first loses the user's
    // place — the rule the terminal's tab strip already follows.
    const [, second] = three()
    useAiStore.getState().switchChat(second)
    useAiStore.getState().deleteChat(second)
    expect(titles()).toEqual(['one', 'three'])
    expect(active().title).toBe('three')
  })

  it('leaves the active chat alone when another one goes', () => {
    const [first] = three()
    useAiStore.getState().deleteChat(first)
    expect(active().title).toBe('three')
    expect(titles()).toEqual(['two', 'three'])
  })

  it('never leaves zero chats', () => {
    // A panel with no chat has nowhere to put the next message, and an empty
    // switcher is a dead end rather than a clean slate.
    const id = useAiStore.getState().activeChatId!
    useAiStore.getState().deleteChat(id)
    expect(useAiStore.getState().chats).toHaveLength(1)
    expect(useAiStore.getState().activeChatId).toBe(useAiStore.getState().chats[0].id)
    expect(selectMessages(useAiStore.getState())).toHaveLength(0)
  })
})

describe('loading a set of chats', () => {
  it('restores the active one and the model it was held with', () => {
    const a = { ...makeChat('anthropic', 'claude-opus-4-6'), id: 'a', title: 'A' }
    const b = { ...makeChat('llamacpp', 'local-8b'), id: 'b', title: 'B' }
    useAiStore.getState().loadChats([a, b], 'b')
    expect(active().id).toBe('b')
    expect(useAiStore.getState().provider).toBe('llamacpp')
  })

  it('falls back to the newest when the named active chat is not in the file', () => {
    const a = { ...makeChat('anthropic', 'x'), id: 'a' }
    useAiStore.getState().loadChats([a], 'gone')
    expect(active().id).toBe('a')
  })

  it('an empty set still leaves a usable panel', () => {
    useAiStore.getState().loadChats([], null)
    expect(useAiStore.getState().chats).toHaveLength(1)
    expect(useAiStore.getState().activeChatId).not.toBeNull()
  })
})

describe('selectMessages', () => {
  it('returns the SAME empty array every time there is no chat', () => {
    // A selector that builds `[]` returns a new one per call, which zustand
    // reads as a change — the component re-renders for ever. The panel
    // subscribes to this selector directly.
    useAiStore.setState({ chats: [], activeChatId: null })
    const a = selectMessages(useAiStore.getState())
    const b = selectMessages(useAiStore.getState())
    expect(a).toBe(b)
    expect(a).toEqual([])
  })

  it('returns the same reference while the conversation is unchanged', () => {
    useAiStore.getState().addMessage(msg('user', 'hi'))
    const a = selectMessages(useAiStore.getState())
    useAiStore.getState().appendStreamChunk('streaming does not touch chats')
    expect(selectMessages(useAiStore.getState())).toBe(a)
  })
})
