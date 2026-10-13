// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConversationMemoryLibrary } from './ConversationMemoryLibrary'
import { makeChat, selectActiveChat, useAiStore } from '@/store/ai'
import { conversationMemories } from '@/lib/context/conversation-memory'
const mocks = vi.hoisted(() => ({ remember: vi.fn(), revokeDelivery: vi.fn(), project: { path: '/test.ourgeoproj', workspaceEpoch: 1 } }))
vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
vi.mock('@/store/context', () => ({ useContextStore: { getState: () => mocks } }))
vi.mock('@/store/project', () => ({ useProjectStore: Object.assign((select: (state: typeof mocks.project) => unknown) => select(mocks.project), { getState: () => mocks.project }) }))
const active = () => selectActiveChat(useAiStore.getState())!
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks(); mocks.remember.mockResolvedValue({})
  const chat = makeChat('ollama', 'fixture')
  useAiStore.setState({ chats: [chat], activeChatId: chat.id, isStreaming: false, streamingContent: '', abortController: null })
})
async function addMemory() {
  fireEvent.change(screen.getByRole('textbox', { name: 'New memory' }), { target: { value: 'Buffer distance is exactly 100 metres.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Remember for this conversation' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('without running a model'))
}
it('adds, corrects, unpins and forgets a chat memory locally', async () => {
  render(<ConversationMemoryLibrary />)
  await addMemory()
  expect(mocks.remember).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: 'Always apply' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit memory' }), { target: { value: 'Buffer distance is exactly 200 metres.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
  await waitFor(() => expect(screen.getByText('Buffer distance is exactly 200 metres.')).toBeVisible())
  fireEvent.click(screen.getByRole('checkbox', { name: 'Always apply' }))
  await waitFor(() => expect(active().conversationMemories?.[0].pinned).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Forget' }))
  await waitFor(() => expect(conversationMemories(active())).toEqual([]))
})
it('keeps the conversation memory when saving its destination fails', async () => {
  render(<ConversationMemoryLibrary />); await addMemory()
  mocks.remember.mockRejectedValue(new Error('Protected storage unavailable'))
  fireEvent.click(screen.getByRole('button', { name: 'Move to About you' }))
  await waitFor(() => expect(screen.getByText('Protected storage unavailable')).toBeVisible())
  expect(conversationMemories(active())).toHaveLength(1)
})
it('moves to project memory only after the destination saves successfully', async () => {
  render(<ConversationMemoryLibrary />); await addMemory()
  fireEvent.click(screen.getByRole('button', { name: 'Move to project' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Moved to Project'))
  expect(mocks.remember).toHaveBeenCalledWith('Buffer distance is exactly 100 metres.', 'project')
  expect(conversationMemories(active())).toEqual([])
})
