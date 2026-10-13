import { beforeEach, expect, it, vi } from 'vitest'
import { conversationMemories, importConversationMemories } from './conversation-memory'
import { useAiStore, makeChat, selectActiveChat } from '@/store/ai'
import { importChats } from './chat-import'
import { chatContentChanged } from './disclosure-dialogue'
vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
const active = () => selectActiveChat(useAiStore.getState())!
beforeEach(() => {
  const chat = makeChat('ollama', 'fixture')
  chat.messages = [{ id: 'first', role: 'user', content: 'For this chat, never modify source data. Buffer distance is exactly 100 metres; working CRS is EPSG:32610.', timestamp: 1 }]
  useAiStore.setState({ chats: [chat], activeChatId: chat.id, isStreaming: false, streamingContent: '', abortController: null })
})
it('corrects and removes a derived instruction without rewriting the source transcript', () => {
  const chat = active(), original = chat.messages, record = conversationMemories(chat)[0]
  useAiStore.getState().setConversationMemory(chat.id, 'Never modify the original source data.', record.id)
  expect(active().messages).toBe(original)
  expect(conversationMemories(active()).find(item => item.id === record.id)?.statement).toBe('Never modify the original source data.')
  useAiStore.getState().setConversationMemory(chat.id, 'Never modify the original source data.', record.id, { kind: 'forget' })
  expect(conversationMemories(active()).some(item => item.id === record.id)).toBe(false)
  expect(active().messages).toBe(original)
})
it('keeps manual notes and tombstones through portable project reload and isolates chats', () => {
  const chatId = active().id, record = conversationMemories(active())[0]
  useAiStore.getState().setConversationMemory(chatId, 'Use a separate output object.')
  useAiStore.getState().setConversationMemory(chatId, record.statement, record.id, { kind: 'forget' })
  const restored = importChats([active()], true)
  expect(conversationMemories(restored[0]).some(item => item.id === record.id)).toBe(false)
  expect(conversationMemories(restored[0]).some(item => item.statement === 'Use a separate output object.')).toBe(true)
  useAiStore.getState().newChat()
  expect(conversationMemories(active())).toEqual([])
  expect(() => useAiStore.getState().setConversationMemory(chatId, 'Late write')).toThrow('conversation changed')
})
it('marks note edits as project work and invalidates retained provider context', () => {
  const chat = active(), before = useAiStore.getState().chats
  useAiStore.setState({ chats: [{ ...chat, claudeSessionId: 'old', lastSessionContext: { objects: null, documents: '', switches: '', consoleMark: null } }] })
  useAiStore.getState().setConversationMemory(chat.id, 'Exactly 100 metres.')
  expect(chatContentChanged(useAiStore.getState().chats, before)).toBe(true)
  expect(active().claudeSessionId).toBeNull()
  expect(active().lastSessionContext).toBeNull()
})
it('refuses credentials and rejects malformed imported memory without losing an early constraint', () => {
  expect(() => useAiStore.getState().setConversationMemory(active().id, 'api_key=private_value')).toThrow('Credentials')
  expect(() => importConversationMemories([{ id: 'x' }])).toThrow('Invalid')
  expect(importChats([{ ...active(), conversationMemories: [{ id: 'x' }] }])).toEqual([])
})

it('does not create duplicate cards when a direct addition repeats an original instruction', () => {
  const chat = active(), original = conversationMemories(chat)[0]
  useAiStore.getState().setConversationMemory(chat.id, original.statement)
  useAiStore.getState().setConversationMemory(chat.id, original.statement)
  expect(conversationMemories(active()).filter(record => record.statement === original.statement)).toHaveLength(1)
  expect(active().conversationMemories).toHaveLength(1)
  expect(active().conversationMemories![0].pinned).toBe(true)
})
