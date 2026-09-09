import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildChatsData, applyChatsData, resetChats, saveChats } from './ai-chats-persistence'
import { useAiStore, makeChat, type AiChat, type ChatMessage } from '@/store/ai'
import { useProjectStore } from '@/store/project'

const written: { path: string; body: string }[] = []
vi.mock('@/lib/persistence', () => ({ getDataPath: () => Promise.resolve('/data') }))
vi.mock('@/lib/ai-preferences-persistence', () => ({
  loadAiPreferences: vi.fn(), saveAiPreferences: () => Promise.resolve(),
}))

beforeEach(() => {
  written.length = 0
  ;(globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      file: {
        write: (path: string, body: string) => { written.push({ path, body }); return Promise.resolve() },
      },
    },
  }
  const chat = makeChat('anthropic', 'claude-opus-4-6')
  useAiStore.setState({ chats: [chat], activeChatId: chat.id })
  useProjectStore.setState({ name: 'scratch', path: null, isDirty: false, recents: [] })
})

const msg = (content: string): ChatMessage =>
  ({ id: content, role: 'user', content, timestamp: 1 })

function twoChats(): AiChat[] {
  return [
    { ...makeChat('anthropic', 'claude-opus-4-6'), id: 'a', title: 'Roads', messages: [msg('buffer roads')] },
    { ...makeChat('llamacpp', 'local-8b'), id: 'b', title: 'Quick question', messages: [msg('what is sf?')] },
  ]
}

describe('the round trip', () => {
  it('gives back the same conversations, on the same models', () => {
    useAiStore.getState().loadChats(twoChats(), 'b')
    const data = buildChatsData()

    // A fresh store, as a relaunch or a project load leaves it.
    const blank = makeChat('anthropic', 'claude-opus-4-6')
    useAiStore.setState({ chats: [blank], activeChatId: blank.id })

    expect(applyChatsData(data)).toBe(true)
    const { chats, activeChatId } = useAiStore.getState()
    expect(chats.map((c) => c.title)).toEqual(['Roads', 'Quick question'])
    expect(chats[0].messages.map((m) => m.content)).toEqual(['buffer roads'])
    expect(activeChatId).toBe('b')
    // The active chat's model comes back with it, which is what makes
    // continuing an old conversation continue it with the right model.
    expect(useAiStore.getState().provider).toBe('llamacpp')
  })
})

describe('a file that is not what we hoped', () => {
  it('reports nothing restored for an absent bundle key', () => {
    // Every .ourgeoproj written before chats existed has no `chats` key, and
    // must still open.
    expect(applyChatsData(undefined)).toBe(false)
    expect(applyChatsData({ chats: [], activeChatId: null })).toBe(false)
  })

  it('drops a malformed chat rather than the whole file', () => {
    const bad = [
      { ...makeChat('anthropic', 'x'), id: 'good', title: 'Good' },
      { id: 'no-messages' } as unknown as AiChat,
      null as unknown as AiChat,
    ]
    expect(applyChatsData({ chats: bad, activeChatId: 'good' })).toBe(true)
    expect(useAiStore.getState().chats.map((c) => c.id)).toEqual(['good'])
  })

  it('still leaves a usable panel when the named active chat is gone', () => {
    applyChatsData({ chats: twoChats(), activeChatId: 'deleted-elsewhere' })
    expect(useAiStore.getState().activeChatId).toBe('b')
  })
})

describe('resetChats', () => {
  it('leaves exactly one empty conversation', () => {
    // What a project load starts from, so one project never shows another's
    // chats.
    useAiStore.getState().loadChats(twoChats(), 'a')
    resetChats()
    expect(useAiStore.getState().chats).toHaveLength(1)
    expect(useAiStore.getState().chats[0].messages).toEqual([])
  })
})

describe('which project owns the file', () => {
  it('writes ai-chats.json for scratch, so a reload does not lose the turn', async () => {
    // The file is session-scoped — `will-quit` deletes it, so scratch does not
    // carry conversations into the next launch. What it buys is the middle: a
    // renderer reload or a crash does not throw away the conversation the user
    // is in the middle of having.
    await saveChats()
    expect(written).toHaveLength(1)
    expect(written[0].path).toBe('/data/ai-chats.json')
  })

  it('writes nothing while a named project is open', async () => {
    // A named project's chats live in its bundle. A copy here as well would
    // be read back by the next launch — which opens scratch — as scratch's
    // own conversations.
    useProjectStore.setState({ name: 'survey', path: '/home/ada/survey.ourgeoproj' })
    await saveChats()
    expect(written).toEqual([])
  })

  it('is listed among the files a clean exit deletes', async () => {
    // The invariant the whole scratch rule rests on. Leaving it off the list
    // is silent: the file simply survives, and scratch quietly becomes an
    // archive of every conversation the user ever had in it.
    const { SESSION_SCOPED_FILES } = await import('./session-scoped-files')
    expect(SESSION_SCOPED_FILES).toContain('ai-chats.json')
  })
})
