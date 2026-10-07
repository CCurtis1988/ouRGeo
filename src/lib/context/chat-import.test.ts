import { expect, it } from 'vitest'
import { importChats } from './chat-import'

it('quarantines malformed optional inspector metadata without losing user instructions', () => {
  const message = { id: 'user', role: 'user', content: 'Keep exact units.', timestamp: 0,
    contextTrace: { target: 'fixture', selected: [], invocations: [], retrievalCalls: 0, limitations: { malicious: 'object' } } }
  const chat = { id: 'chat', title: 'Fixture', provider: 'ollama', model: 'fixture', createdAt: 0, updatedAt: 0, messages: [message] }
  const restored = importChats([chat])
  expect(restored[0].messages[0].content).toBe('Keep exact units.')
  expect(restored[0].messages[0].contextTrace?.limitations).toBeUndefined()
  const limitations = ['Known limitation', ...Array(8).fill('x'.repeat(300))]
  expect(importChats([{ ...chat, messages: [{ ...message, contextTrace: { ...message.contextTrace, limitations } }] }])[0].messages[0].contextTrace?.limitations).toEqual(['Known limitation'])
})
