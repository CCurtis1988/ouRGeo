import type { ChatMessage } from '@/store/ai'
import type { ContextTrace } from './types'

/** Bind late accounting to its original user turn, never a newer answer. A
 * request without an answer keeps its inspector on the initiating message. */
export function attachTurnTrace(messages: ChatMessage[], userId: string, trace: ContextTrace): ChatMessage[] {
  const start = messages.findIndex(message => message.id === userId && message.role === 'user')
  if (start < 0) return messages
  let target = start
  for (let index = start + 1; index < messages.length && messages[index].role !== 'user'; index++) {
    if (messages[index].role === 'assistant') { target = index; break }
  }
  return messages.map((message, index) => index === target ? { ...message, contextTrace: trace } : message)
}
