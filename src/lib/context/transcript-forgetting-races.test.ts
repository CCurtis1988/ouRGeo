import { beforeEach, expect, it, vi } from 'vitest'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { makeChat, useAiStore } from '@/store/ai'
import type { MemoryRecord } from './types'
import { planTranscriptForget, reviewTranscriptCopies, type TranscriptForgetScope } from './transcript-forgetting'

vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
const forget = vi.fn()
const memory: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'I prefer metric units', evidence: ['original-evidence'], assertion: 'user-declared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'active', supersedes: [] }
const scope = (): TranscriptForgetScope => ({ workspaceEpoch: useProjectStore.getState().workspaceEpoch, projectId: useProjectStore.getState().projectId, savedProject: !!useProjectStore.getState().path, activeChatId: useAiStore.getState().activeChatId })
beforeEach(() => {
  forget.mockReset().mockResolvedValue({ local: 'excluded', managed: 'confirmed' })
  vi.stubGlobal('window', { electronAPI: { context: { forget } } })
  useProjectStore.setState({ projectId: crypto.randomUUID(), workspaceEpoch: 10, path: '/synthetic.ourgeoproj', isDirty: false })
  useContextStore.setState({ globals: [memory], projectContext: { version: 1, revision: 0, memories: [] }, projectLease: crypto.randomUUID(), traces: {}, ready: true })
  const chat = makeChat('claude-cli', 'synthetic')
  chat.claudeSessionId = 'retained-session'
  chat.messages = [{ id: 'selected-message', content: memory.statement, role: 'user', timestamp: 1 }, { id: 'keep-message', content: 'Always preserve EPSG:27700', role: 'user', timestamp: 2 }]
  useAiStore.setState({ chats: [chat], activeChatId: chat.id, isStreaming: false })
})

it('commits canonical forgetting and the reviewed suppression union before removing message records', async () => {
  let complete!: () => void
  forget.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const plan = planTranscriptForget(memory, reviewTranscriptCopies(memory, useAiStore.getState().chats, scope()), scope())
  const operation = useContextStore.getState().forgetEverywhere(plan)
  expect(useAiStore.getState().chats[0].messages).toHaveLength(2)
  expect(forget.mock.calls[0][1].sources).toEqual(['original-evidence', 'selected-message'])
  complete()
  await operation
  expect(useAiStore.getState().chats[0].messages.map(message => message.id)).toEqual(['keep-message'])
  expect(useAiStore.getState().chats[0].claudeSessionId).toBeNull()
  expect(useProjectStore.getState().isDirty).toBe(true)
})

it('preserves the selected transcript when durable forgetting fails', async () => {
  forget.mockRejectedValue(new Error('SQLITE_FULL: database or disk is full'))
  const plan = planTranscriptForget(memory, reviewTranscriptCopies(memory, useAiStore.getState().chats, scope()), scope())
  await expect(useContextStore.getState().forgetEverywhere(plan)).rejects.toThrow('SQLITE_FULL')
  expect(useAiStore.getState().chats[0].messages).toHaveLength(2)
  expect(useContextStore.getState().globals).toEqual([memory])
})

it('cannot remove a late message copy after the workspace changes during canonical deletion', async () => {
  let complete!: () => void
  forget.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const plan = planTranscriptForget(memory, reviewTranscriptCopies(memory, useAiStore.getState().chats, scope()), scope())
  const operation = useContextStore.getState().forgetEverywhere(plan)
  useProjectStore.setState({ workspaceEpoch: 11, projectId: crypto.randomUUID() })
  complete()
  await expect(operation).rejects.toThrow('SCOPE_CHANGED')
  expect(useAiStore.getState().chats[0].messages).toHaveLength(2)
  expect(useContextStore.getState().globals).toEqual([])
})
