import { expect, it } from 'vitest'
import { importChats } from './chat-import'

it('expires recovered excerpts and reference metadata while retaining the original dialogue and usage', () => {
  const usage = [{ invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 20, outputTokens: 5 }]
  const message = { id: 'user', role: 'user', content: 'Use EPSG:27700.', timestamp: Date.now() - 8 * 86400_000,
    contextTrace: { target: 'fixture', selected: [{ title: 'secret title', scope: 'workspace', ref: 'private-ref', sourceId: 'private-source', revision: '1', content: 'secret excerpt', reason: 'private reason' }], invocations: [{ inputTokens: 20, window: 32000, estimated: true, sentRefs: ['private-ref'] }], retrievalCalls: 1, usage } }
  const chat = { id: 'chat', title: 'Fixture', provider: 'ollama', model: 'fixture', createdAt: 0, updatedAt: 0, messages: [message] }
  const restored = importChats([chat])[0].messages[0]
  expect(restored.content).toBe('Use EPSG:27700.')
  expect(restored.contextTrace?.usage).toEqual(usage)
  expect(restored.contextTrace?.evidenceExpired).toBe(true)
  expect(JSON.stringify(restored.contextTrace)).not.toMatch(/secret|private/)
})

it('quarantines malformed optional inspector metadata without losing user instructions', () => {
  const message = { id: 'user', role: 'user', content: 'Keep exact units.', timestamp: Date.now(),
    contextTrace: { target: 'fixture', selected: [], invocations: [], retrievalCalls: 0, limitations: { malicious: 'object' } } }
  const chat = { id: 'chat', title: 'Fixture', provider: 'ollama', model: 'fixture', createdAt: 0, updatedAt: 0, messages: [message] }
  const restored = importChats([chat])
  expect(restored[0].messages[0].content).toBe('Keep exact units.')
  expect(restored[0].messages[0].contextTrace?.limitations).toBeUndefined()
  const limitations = ['Known limitation', ...Array(8).fill('x'.repeat(300))]
  expect(importChats([{ ...chat, messages: [{ ...message, contextTrace: { ...message.contextTrace, limitations } }] }])[0].messages[0].contextTrace?.limitations).toEqual(['Known limitation'])
})
