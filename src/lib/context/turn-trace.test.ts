import { expect, it } from 'vitest'
import type { ChatMessage } from '@/store/ai'
import type { ContextTrace } from './types'
import { attachTurnTrace } from './turn-trace'

const message = (id: string, role: ChatMessage['role']): ChatMessage => ({ id, role, content: id, timestamp: 0 })
const trace = { target: 'fixture', selected: [], invocations: [], retrievalCalls: 0 } as unknown as ContextTrace

it('retains a failed request inspector on its own initiating message without claiming a later answer', () => {
  const messages = [message('failed', 'user'), message('new', 'user'), message('new-answer', 'assistant')]
  const result = attachTurnTrace(messages, 'failed', trace)
  expect(result[0].contextTrace).toBe(trace)
  expect(result[2].contextTrace).toBeUndefined()
  expect(attachTurnTrace(messages, 'removed-turn', trace)).toBe(messages)
})

it('attaches cancelled partial-answer accounting to that answer while keeping newer messages intact', () => {
  const messages = [message('old', 'user'), message('partial', 'assistant'), message('new', 'user'), message('answer', 'assistant')]
  const result = attachTurnTrace(messages, 'old', trace)
  expect(result[1].contextTrace).toBe(trace)
  expect(result[3]).toBe(messages[3])
  expect(messages[1].contextTrace).toBeUndefined()
})
