import { expect, it } from 'vitest'
import type { ChatMessage } from '@/store/ai'
import { selectConversation } from './compaction'

it('preserves exact original instructions and conflicting corrections through a long history', () => {
  const first: ChatMessage = { id: 'first', role: 'user', content: 'Use exactly 12.5 US survey feet; do not convert to international feet.', timestamp: 0 }
  const correction: ChatMessage = { id: 'correction', role: 'user', content: 'Correction: use 12.6 US survey feet only for the revised comparison.', timestamp: 100 }
  const messages: ChatMessage[] = [first, ...Array.from({ length: 40 }, (_, index) => ({ id: `reply-${index}`, role: 'assistant' as const, content: 'intermediate discussion '.repeat(80), timestamp: index + 1 })), correction]
  const view = selectConversation(messages, 3000)
  expect(view.messages.find(message => message.id === 'first')).toBe(first)
  expect(view.messages.find(message => message.id === 'correction')).toBe(correction)
  expect(view.messages[0].content).toContain('derived evidence')
  expect(messages).toHaveLength(42)
})

it('selects separate tool call and result records together rather than leaving an orphan result', () => {
  const messages: ChatMessage[] = [
    { id: 'request', role: 'user', content: 'Inspect roads.', timestamp: 0 },
    { id: 'call', role: 'assistant', content: 'call context '.repeat(1000), toolCalls: [{ id: 'tool-one', code: 'inspect' }], timestamp: 1 },
    { id: 'result', role: 'assistant', content: 'result', toolResults: [{ id: 'tool-one', output: 'schema' }], timestamp: 2 },
    { id: 'next', role: 'user', content: 'Continue.', timestamp: 3 },
  ]
  const view = selectConversation(messages, 1800)
  expect(view.omitted).toEqual(expect.arrayContaining(['call', 'result']))
  expect(view.messages.some(message => message.id === 'call' || message.id === 'result')).toBe(false)
  expect(messages[1].toolCalls).toEqual([{ id: 'tool-one', code: 'inspect' }])
})

it('retains an unfinished exchange intact even when the compiler must reject its size', () => {
  const pending: ChatMessage = { id: 'pending', role: 'assistant', content: 'unfinished output '.repeat(2000), toolCalls: [{ id: 'pending-call', code: 'inspect' }], timestamp: 1 }
  const request: ChatMessage = { id: 'request', role: 'user', content: 'Inspect roads.', timestamp: 0 }
  const view = selectConversation([request, pending], 1000)
  expect(view.messages).toEqual([request, pending])
  expect(view.omitted).toEqual([])
})
