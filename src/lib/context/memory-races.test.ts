import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { makeChat, useAiStore } from '@/store/ai'
import type { MemoryRecord } from './types'
import { chatContentChanged } from './disclosure-dialogue'

vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
const forget = vi.fn(), stageProject = vi.fn(), saveGlobal = vi.fn()
const listGlobal = vi.fn()
let tracking: (() => void) | undefined
afterEach(() => { tracking?.(); tracking = undefined })
const now = new Date().toISOString()
const memory = (): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Prefer metric units', evidence: [], assertion: 'user-declared', createdAt: now, updatedAt: now, status: 'active', supersedes: [] })
beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: { context: { forget, stageProject, saveGlobal, listGlobal } } })
  forget.mockReset().mockResolvedValue(undefined)
  stageProject.mockReset().mockResolvedValue(undefined)
  saveGlobal.mockReset().mockImplementation(record => Promise.resolve(record))
  listGlobal.mockReset().mockImplementation(() => Promise.resolve(saveGlobal.mock.calls.length ? [saveGlobal.mock.calls.at(-1)![0]] : []))
  useProjectStore.setState({ projectId: crypto.randomUUID(), workspaceEpoch: 1, path: '/test.ourgeoproj', isDirty: false })
  useContextStore.setState({ globals: [], projectContext: { version: 1, revision: 0, memories: [] }, committedRevision: 0, projectLease: crypto.randomUUID(), traces: {}, ready: true, personalMemoryAvailable: true })
  const chat = { ...makeChat('claude-cli', 'fixture'), claudeSessionId: 'retained-provider-session' }
  useAiStore.setState({ chats: [chat], activeChatId: chat.id })
})

it('keeps About you edits independent of project dirty tracking', async () => {
  const global = memory(), project = useContextStore.getState().projectContext
  useContextStore.setState({ globals: [global] })
  tracking = useAiStore.subscribe((state, previous) => {
    if (chatContentChanged(state.chats, previous.chats)) useProjectStore.getState().markDirty()
  })
  await useContextStore.getState().edit(global.id, 'Prefer metres')
  await useContextStore.getState().setPinned(global.id, true)
  await useContextStore.getState().forget(global.id)
  expect(useContextStore.getState().projectContext).toBe(project)
  expect(stageProject).not.toHaveBeenCalled()
  expect(useProjectStore.getState().isDirty).toBe(false)
})

it('does not attach a late forget result to a newly opened project', async () => {
  let complete!: () => void
  forget.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const project = { ...memory(), scope: 'project' as const, projectId: useProjectStore.getState().projectId }
  useContextStore.setState({ projectContext: { version: 1, revision: 1, memories: [project] } })
  const deletion = useContextStore.getState().forget(project.id)
  useProjectStore.setState({ workspaceEpoch: 2, projectId: crypto.randomUUID() })
  useContextStore.getState().loadProject({ version: 1, revision: 7, memories: [] }, 7, crypto.randomUUID())
  const current = useContextStore.getState().projectContext
  complete()
  await expect(deletion).rejects.toThrow('SCOPE_CHANGED')
  expect(useContextStore.getState().projectContext).toBe(current)
  expect(useProjectStore.getState().isDirty).toBe(false)
  expect(stageProject).not.toHaveBeenCalled()
})

it('resets retained provider context even when the recovery journal fails', async () => {
  stageProject.mockRejectedValue(new Error('disk full'))
  const project = { ...memory(), scope: 'project' as const, projectId: useProjectStore.getState().projectId }
  useContextStore.setState({ projectContext: { version: 1, revision: 1, memories: [project] } })
  await expect(useContextStore.getState().forget(project.id)).rejects.toThrow('disk full')
  expect(useAiStore.getState().chats[0].claudeSessionId).toBeNull()
  expect(useContextStore.getState().projectContext.memories).toEqual([])
  expect(useProjectStore.getState().isDirty).toBe(true)
})

it('deletes a conversation only after forgetting its solely derived memories', async () => {
  const chat = useAiStore.getState().chats[0], messageId = crypto.randomUUID()
  useAiStore.setState({ chats: [{ ...chat, messages: [{ id: messageId, role: 'user', content: 'Prefer metric units', timestamp: 0 }] }] })
  const record = { ...memory(), evidence: [messageId] }
  useContextStore.setState({ globals: [record] })
  await useContextStore.getState().deleteConversation(chat.id)
  expect(forget).toHaveBeenCalledWith(record.id, expect.objectContaining({ sources: [messageId] }))
  expect(useContextStore.getState().globals).toEqual([])
  expect(useAiStore.getState().chats.some(current => current.id === chat.id)).toBe(false)
})

it('keeps a chat reviewable if durable deletion fails and refuses unknown protected memory', async () => {
  const chat = useAiStore.getState().chats[0], messageId = crypto.randomUUID()
  useAiStore.setState({ chats: [{ ...chat, messages: [{ id: messageId, role: 'user', content: 'Prefer metric units', timestamp: 0 }] }] })
  useContextStore.setState({ globals: [{ ...memory(), evidence: [messageId] }] })
  forget.mockRejectedValue(new Error('disk full'))
  await expect(useContextStore.getState().deleteConversation(chat.id)).rejects.toThrow('disk full')
  expect(useAiStore.getState().chats[0].id).toBe(chat.id)
  useContextStore.setState({ personalMemoryAvailable: false, memoryStoreAbsent: false })
  await expect(useContextStore.getState().deleteConversation(chat.id)).rejects.toThrow('Restore protected memory storage')
})

it('keeps edited records only when the deletion choice explicitly requests it', async () => {
  const chat = useAiStore.getState().chats[0], messageId = crypto.randomUUID()
  useAiStore.setState({ chats: [{ ...chat, messages: [{ id: messageId, role: 'user', content: 'Prefer metric units', timestamp: 0 }] }] })
  const edited = { ...memory(), evidence: [messageId], editedAt: now }
  useContextStore.setState({ globals: [edited] })
  await useContextStore.getState().deleteConversation(chat.id, true)
  expect(forget).not.toHaveBeenCalled()
  expect(useContextStore.getState().globals).toEqual([edited])
  expect(useContextStore.getState().notice).toContain('retained without their source chat')
})

it('does not delete an incoming copy with the same chat ID after a workspace switch', async () => {
  const chat = useAiStore.getState().chats[0]
  const deletion = useContextStore.getState().deleteConversation(chat.id)
  useProjectStore.setState({ workspaceEpoch: 2, projectId: crypto.randomUUID() })
  useAiStore.setState({ chats: [{ ...chat, title: 'Incoming copy' }] })
  await expect(deletion).rejects.toThrow('SCOPE_CHANGED')
  expect(useAiStore.getState().chats[0].title).toBe('Incoming copy')
  expect(forget).not.toHaveBeenCalled()
})

it('rechecks an absent store instead of trusting the startup snapshot for deletion', async () => {
  const chat = useAiStore.getState().chats[0]
  useAiStore.setState({ chats: [{ ...chat, messages: [{ id: crypto.randomUUID(), role: 'user', content: 'Hello', timestamp: 0 }] }] })
  useContextStore.setState({ personalMemoryAvailable: false, memoryStoreAbsent: true })
  const status = vi.fn().mockResolvedValue({ empty: false })
  window.electronAPI.context.storageStatus = status
  await expect(useContextStore.getState().deleteConversation(chat.id)).rejects.toThrow('Restore protected memory storage')
  expect(status).toHaveBeenCalledOnce()
  expect(useAiStore.getState().chats[0].id).toBe(chat.id)
})
