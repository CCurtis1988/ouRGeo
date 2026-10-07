import { expect, it, vi } from 'vitest'
import { makeChat } from '@/store/ai'
import { conversationMemories } from './conversation-deletion'
import type { MemoryRecord } from './types'

vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
const memory = (evidence: string[], extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Prefer metric units', evidence, assertion: 'user-declared', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', status: 'active', supersedes: [], ...extra })

it('removes only memories supported solely by the deleted conversation', () => {
  const chat = { ...makeChat('ollama', 'fixture'), messages: [{ id: 'user', role: 'user' as const, content: 'Use metres', timestamp: 0, toolResults: [{ id: 'execution', output: 'done' }] }] }
  const solely = memory(['user']), computation = memory(['execution']), shared = memory(['user', 'another-chat']), addedManually = memory([])
  expect(conversationMemories(chat, [solely, computation, shared, addedManually]).dependent).toEqual([solely, computation])
})

it('allows deliberate retention of edited or pinned records, not automatic suggestions', () => {
  const chat = { ...makeChat('ollama', 'fixture'), messages: [{ id: 'user', role: 'user' as const, content: 'Use metres', timestamp: 0 }] }
  const pinned = memory(['user'], { pinned: true }), edited = memory(['user'], { editedAt: '2026-10-07T00:00:00Z' }), accepted = memory(['user'], { revision: 2 })
  const plan = conversationMemories(chat, [pinned, edited, accepted])
  expect(plan.dependent).toEqual([pinned, edited, accepted])
  expect(plan.independent).toEqual([pinned, edited])
})
