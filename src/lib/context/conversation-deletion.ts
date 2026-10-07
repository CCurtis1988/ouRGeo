import type { AiChat } from '@/store/ai'
import type { MemoryRecord } from './types'

/** Only evidence solely owned by this chat qualifies. A fact supported by
 * another chat/resource remains independently retained; absent provenance is
 * not permission to guess which record to delete. */
export function conversationMemories(chat: AiChat, records: MemoryRecord[]): { dependent: MemoryRecord[]; independent: MemoryRecord[] } {
  const sources = new Set(chat.messages.flatMap(message => [message.id,
    ...message.toolCalls?.map(call => call.id) ?? [], ...message.toolResults?.map(result => result.id) ?? []]))
  const dependent = records.filter(record => record.evidence.length > 0 && record.evidence.every(source => sources.has(source)))
  return { dependent, independent: dependent.filter(record => record.pinned === true || record.editedAt !== undefined) }
}
