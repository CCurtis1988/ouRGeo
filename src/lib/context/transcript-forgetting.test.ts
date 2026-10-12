import { expect, it } from 'vitest'
import type { AiChat, ChatMessage } from '@/store/ai'
import type { MemoryRecord } from './types'
import { applyTranscriptForget, assertTranscriptForget, inspectTranscriptCopy, planTranscriptForget, reviewTranscriptCopies, type TranscriptForgetScope } from './transcript-forgetting'

const scope: TranscriptForgetScope = { workspaceEpoch: 5, projectId: 'project-a', savedProject: true, activeChatId: 'chat-a' }
const memory: MemoryRecord = { id: 'memory-a', scope: 'global', projectId: null, revision: 1, category: 'preference', statement: 'I prefer metric units', status: 'active', assertion: 'user-declared', evidence: ['source-message'], supersedes: [], createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }
const message = (id: string, content: string, role: ChatMessage['role'] = 'user'): ChatMessage => ({ id, content, role, timestamp: 1 })
const chat = (id: string, messages: ChatMessage[]): AiChat => ({ id, title: id, renamed: false, createdAt: 1, updatedAt: 1, messages,
  provider: 'openai', model: 'synthetic', claudeSessionId: 'retained-session', lastSessionContext: null, tokenUsage: { used: 300, total: 4000 } })

it('offers exact copies and original source messages only within the authorised workspace conversation scope', () => {
  const chats = [chat('chat-a', [message('source-message', 'Remember my units'), message('copy-a', 'I prefer metric units'), message('other', 'Use feet temporarily')]), chat('chat-b', [message('copy-b', 'I prefer metric units')])]
  expect(reviewTranscriptCopies(memory, chats, scope).map(copy => copy.messageId)).toEqual(['source-message', 'copy-a', 'copy-b'])
  expect(reviewTranscriptCopies(memory, chats, { ...scope, projectId: null, savedProject: false }).map(copy => copy.messageId)).toEqual(['source-message', 'copy-a'])
  expect(reviewTranscriptCopies(memory, chats, scope, 'feet').map(copy => copy.messageId)).toEqual(['source-message', 'other'])
})

it('counts original evidence in the 32-source limit and never silently drops a selected copy', () => {
  const chats = [chat('chat-a', [message('copy', memory.statement)])]
  const copies = reviewTranscriptCopies(memory, chats, scope)
  expect(() => planTranscriptForget({ ...memory, evidence: Array.from({ length: 32 }, (_, i) => `source-${i}`) }, copies, scope)).toThrow('32-source')
  expect(() => planTranscriptForget(memory, [...copies, ...copies], scope)).toThrow('distinct')
  expect(planTranscriptForget(memory, copies, scope).sourceIds).toEqual(['source-message', 'copy'])
})

it('refuses scope changes, revised memories and changed tool results before any transcript deletion', () => {
  const chats = [chat('chat-a', [{ ...message('copy', memory.statement, 'assistant'), toolCalls: [{ id: 't1', code: 'metric()' }], toolResults: [{ id: 't1', output: 'metric units' }] }])]
  const plan = planTranscriptForget(memory, reviewTranscriptCopies(memory, chats, scope), scope)
  expect(() => assertTranscriptForget(plan, memory, chats, scope)).not.toThrow()
  expect(() => assertTranscriptForget(plan, memory, chats, { ...scope, workspaceEpoch: 6 })).toThrow('SCOPE_CHANGED')
  expect(() => assertTranscriptForget(plan, { ...memory, revision: 2 }, chats, scope)).toThrow('SCOPE_CHANGED')
  chats[0].messages[0].toolResults![0].output = 'miles'
  expect(() => assertTranscriptForget(plan, memory, chats, scope)).toThrow('selected message changed')
  expect(chats[0].messages).toHaveLength(1)
})

it('permits a second snapshot check after durable forgetting but rejects changed selected user instructions', () => {
  const chats = [chat('chat-a', [message('copy', `${memory.statement}. Always preserve exact CRS 27700.`)])]
  const plan = planTranscriptForget(memory, reviewTranscriptCopies(memory, chats, scope), scope)
  expect(() => assertTranscriptForget(plan, undefined, chats, scope)).toThrow('SCOPE_CHANGED')
  expect(() => assertTranscriptForget(plan, undefined, chats, scope, true)).not.toThrow()
  chats[0].messages = [message('copy', 'Updated instruction: use imperial units')]
  expect(() => assertTranscriptForget(plan, undefined, chats, scope, true)).toThrow('selected message changed')
})

it('removes only reviewed complete messages and rebuilds derived state without breaking tool exchanges', () => {
  const original = message('keep', 'Always use EPSG:27700 for this project')
  const removed = { ...message('copy', memory.statement, 'assistant'), toolCalls: [{ id: 't1', code: 'metric()' }], toolResults: [{ id: 't1', output: memory.statement }] }
  const chats = [chat('chat-a', [original, removed]), chat('chat-b', [message('unselected', memory.statement)])]
  const plan = planTranscriptForget(memory, [reviewTranscriptCopies(memory, chats, scope)[0]], scope)
  const result = applyTranscriptForget(plan, chats, 7)
  expect(result[0].messages).toEqual([original])
  expect(result[0].workingState?.constraints.some(span => span.text.includes('27700'))).toBe(true)
  expect(result[0].claudeSessionId).toBeNull()
  expect(result[0].tokenUsage.used).toBe(0)
  expect(result[1]).toBe(chats[1])
  expect(chats[0].messages).toHaveLength(2)
})

it('rejects forged source suppression IDs and caps displayed previews without copying complete source bodies', () => {
  const chats = [chat('chat-a', [message('copy', memory.statement.repeat(1000))])]
  const copies = reviewTranscriptCopies(memory, chats, scope)
  expect(copies[0].preview.length).toBeLessThanOrEqual(600)
  expect(copies[0].snapshot).toBe(chats[0].messages[0])
  const plan = planTranscriptForget(memory, copies, scope)
  expect(() => assertTranscriptForget({ ...plan, sourceIds: ['another-project-source'] }, memory, chats, scope)).toThrow('source links')
})

it('labels incomplete original displays and redacts a private-key block cut by the display boundary', () => {
  const chats = [chat('chat-a', [message('copy', `${memory.statement}\n-----BEGIN PRIVATE KEY-----\n${'PRIVATE_SECRET_MATERIAL'.repeat(100)}\n-----END PRIVATE KEY-----`)])]
  const copy = reviewTranscriptCopies(memory, chats, scope)[0]
  const display = inspectTranscriptCopy(copy, 100)
  expect(display.complete).toBe(false)
  expect(display.text).not.toContain('PRIVATE_SECRET_MATERIAL')
  expect(display.text).toContain('[redacted private key]')
})

it('keeps content-free accounting for unremoved messages while clearing every diagnostic evidence copy', () => {
  const usage = [{ invocation: 1, attempt: 1, scope: 'invocation' as const, inputTokens: 25, outputTokens: 5 }]
  const kept: ChatMessage = { ...message('keep', 'Keep the remaining request'), contextTrace: { turnId: 'turn', identity: { chatId: 'chat-a', projectId: null, workspaceEpoch: 5, policyRevision: 0 },
    target: 'assistant', state: 'acknowledged', selected: [{ ref: 'ctx_private', sourceId: 'memory:memory-a', kind: 'memory', scope: 'global', title: 'Private title', revision: '1', reason: 'preference', content: memory.statement, estimatedTokens: 10, completeness: 'complete' }],
    invocations: [{ inputTokens: 25, window: 32000, estimated: true, sentRefs: ['ctx_private'] }], retrievalCalls: 1, returnedTokens: 10, excluded: [], usage } }
  const chats = [chat('chat-a', [message('copy', memory.statement), kept])]
  const plan = planTranscriptForget(memory, [reviewTranscriptCopies(memory, chats, scope)[0]], scope)
  const result = applyTranscriptForget(plan, chats)[0].messages[0]
  expect(result.contextTrace?.usage).toEqual(usage)
  expect(result.contextTrace?.selected).toEqual([])
  expect(JSON.stringify(result.contextTrace)).not.toContain(memory.statement)
  expect(JSON.stringify(result.contextTrace)).not.toContain('ctx_private')
})
