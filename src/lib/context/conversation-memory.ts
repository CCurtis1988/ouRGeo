import type { AiChat } from '@/store/ai'
import { buildWorkingState } from './working-state'
import { contentRevision, redactContext } from './policy'

export interface ConversationMemory {
  id: string
  statement: string
  status: 'active' | 'forgotten'
  pinned?: boolean
  sourceMessageId?: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** A correction or tombstone overrides a derived card, never the original
 * transcript. Notes belong to one chat and travel only with that chat. */
export function conversationMemories(chat: Pick<AiChat, 'messages' | 'conversationMemories'>): ConversationMemory[] {
  const state = buildWorkingState(chat.messages)
  const originals = [...state.constraints, ...state.decisions]
  const derived = new Map<string, ConversationMemory>()
  for (const span of originals) {
    const id = `derived:${span.messageId}:${contentRevision(span.text)}`
    const timestamp = new Date(chat.messages.find(message => message.id === span.messageId)!.timestamp).toISOString()
    derived.set(id, { id, statement: span.text, status: 'active', sourceMessageId: span.messageId, createdAt: timestamp, updatedAt: timestamp, revision: 1 })
  }
  for (const record of chat.conversationMemories ?? []) derived.set(record.id, record)
  return [...derived.values()].filter(record => record.status === 'active')
}

export function validateConversationMemory(statement: string): string {
  const clean = statement.trim()
  if (!clean || clean.length > 4000) throw new Error('Use a memory between 1 and 4,000 characters.')
  if (redactContext(clean) !== clean) throw new Error('Credentials cannot be remembered. Remove the secret and try again.')
  return clean
}

/** Portable import preserves explicit chat scope, including forgotten derived
 * cards. A malformed note rejects the chat rather than losing a constraint. */
export function importConversationMemories(input: unknown): ConversationMemory[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Invalid conversation memories.')
  const ids = new Set<string>()
  return input.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid conversation memory.')
    const record = value as ConversationMemory
    if (typeof record.id !== 'string' || !record.id || record.id.length > 256 || [...record.id].some(character => character.charCodeAt(0) < 32) || ids.has(record.id)
      || record.pinned !== undefined && typeof record.pinned !== 'boolean'
      || !['active', 'forgotten'].includes(record.status) || typeof record.statement !== 'string'
      || !Number.isSafeInteger(record.revision) || record.revision < 1
      || ![record.createdAt, record.updatedAt].every(time => typeof time === 'string' && time.length <= 64 && Number.isFinite(Date.parse(time)))
      || record.sourceMessageId !== undefined && (typeof record.sourceMessageId !== 'string' || record.sourceMessageId.length > 128)) throw new Error('Invalid conversation memory.')
    validateConversationMemory(record.statement)
    ids.add(record.id)
    return { id: record.id, statement: record.statement, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, revision: record.revision, pinned: record.pinned !== false,
      ...(record.sourceMessageId ? { sourceMessageId: record.sourceMessageId } : {}) }
  })
}
