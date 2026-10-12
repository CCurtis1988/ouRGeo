import type { AiChat, ChatMessage } from '@/store/ai'
import type { MemoryRecord } from './types'
import { buildWorkingState } from './working-state'
import { redactContext } from './policy'
import { accountingOnlyTrace } from './retention'

export interface TranscriptForgetScope {
  workspaceEpoch: number
  projectId: string | null
  savedProject: boolean
  activeChatId: string | null
}
export interface TranscriptCopy {
  chatId: string
  chatTitle: string
  messageId: string
  role: ChatMessage['role']
  preview: string
  originalEvidence: boolean
  snapshot: ChatMessage
}
export interface TranscriptForgetPlan {
  memoryId: string
  memorySnapshot: string
  scope: TranscriptForgetScope
  copies: TranscriptCopy[]
  sourceIds: string[]
}

const sourceId = /^[a-zA-Z0-9_:.-]{1,128}$/u
const signature = (message: ChatMessage): string => JSON.stringify({ id: message.id, role: message.role, content: message.content,
  openAiMessages: message.openAiMessages, toolCalls: message.toolCalls, toolResults: message.toolResults, timestamp: message.timestamp })
const authorised = (chat: AiChat, scope: TranscriptForgetScope): boolean => scope.savedProject || chat.id === scope.activeChatId
const snapshotMessage = (message: ChatMessage): ChatMessage => structuredClone({ id: message.id, role: message.role, content: message.content,
  timestamp: message.timestamp, openAiMessages: message.openAiMessages, toolCalls: message.toolCalls, toolResults: message.toolResults })
export const snapshotTranscriptCopy = (copy: TranscriptCopy): TranscriptCopy => ({ ...copy, snapshot: snapshotMessage(copy.snapshot) })

export function inspectTranscriptCopy(copy: TranscriptCopy, limit = 100_000): { text: string; complete: boolean } {
  const message = copy.snapshot
  const parts = [message.content, ...(message.openAiMessages?.map(part => part.content) ?? []),
    ...(message.toolCalls?.map(call => `Tool call ${call.id}: ${call.code}`) ?? []), ...(message.toolResults?.map(result => `Tool result ${result.id}: ${result.output}`) ?? [])]
  let text = '', complete = true
  for (const part of parts) {
    if (text.length + part.length + 1 > limit) { text += `\n${part.slice(0, Math.max(0, limit - text.length - 1))}`; complete = false; break }
    text += `${text ? '\n' : ''}${part}`
  }
  // A display boundary can omit the END marker. Do not reveal the remaining
  // beginning of a private key merely because this local preview is bounded.
  return { text: redactContext(text).replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*$/u, '[redacted private key]'), complete }
}

/** Matching only offers copies for review. It cannot choose a user instruction
 * to delete, infer paraphrases, or search unopened projects/scratch chats. */
export function reviewTranscriptCopies(memory: MemoryRecord, chats: AiChat[], scope: TranscriptForgetScope, query = ''): TranscriptCopy[] {
  const text = (query.trim() || memory.statement.trim()).toLocaleLowerCase()
  const evidence = new Set(memory.evidence)
  const candidates: TranscriptCopy[] = []
  for (const chat of chats) {
    if (!authorised(chat, scope)) continue
    for (const message of chat.messages) {
      const originalEvidence = evidence.has(message.id)
      const haystack = `${message.content}\n${message.openAiMessages?.map(part => part.content).join('\n') ?? ''}\n${message.toolResults?.map(result => result.output).join('\n') ?? ''}`
      if (!originalEvidence && (!text || !haystack.toLocaleLowerCase().includes(text))) continue
      candidates.push({ chatId: chat.id, chatTitle: redactContext(chat.title).slice(0, 160), messageId: message.id, role: message.role,
        preview: redactContext(message.content || haystack).slice(0, 600), originalEvidence, snapshot: message })
      if (candidates.length >= 100) return candidates
    }
  }
  return candidates
}

export function planTranscriptForget(memory: MemoryRecord, copies: TranscriptCopy[], scope: TranscriptForgetScope): TranscriptForgetPlan {
  if (copies.length > 32 || new Set(copies.map(copy => JSON.stringify([copy.chatId, copy.messageId]))).size !== copies.length) throw new Error('Choose at most 32 distinct message copies.')
  if (copies.some(copy => !sourceId.test(copy.messageId) || (!scope.savedProject && copy.chatId !== scope.activeChatId))) throw new Error('Review copies from the current authorised conversation.')
  const sourceIds = [...new Set([...memory.evidence, ...copies.map(copy => copy.messageId)])]
  if (sourceIds.length > 32 || sourceIds.some(id => !sourceId.test(id))) throw new Error('This selection exceeds the 32-source forgetting limit. Choose fewer copies or review the memory’s source links first.')
  return { memoryId: memory.id, memorySnapshot: JSON.stringify(memory), scope: { ...scope }, copies: copies.map(snapshotTranscriptCopy), sourceIds }
}

export function assertTranscriptForget(plan: TranscriptForgetPlan, memory: MemoryRecord | undefined, chats: AiChat[], scope: TranscriptForgetScope, allowMemoryAbsent = false): void {
  if (scope.workspaceEpoch !== plan.scope.workspaceEpoch || scope.projectId !== plan.scope.projectId || scope.savedProject !== plan.scope.savedProject
      || scope.activeChatId !== plan.scope.activeChatId || (memory ? JSON.stringify(memory) !== plan.memorySnapshot : !allowMemoryAbsent)) throw new Error('SCOPE_CHANGED: the memory or workspace changed. Review the selection again.')
  const expected = planTranscriptForget(memory ?? JSON.parse(plan.memorySnapshot) as MemoryRecord, plan.copies, plan.scope)
  if (JSON.stringify(expected.sourceIds) !== JSON.stringify(plan.sourceIds) || expected.memoryId !== plan.memoryId) throw new Error('Review the selected memory and source links again.')
  for (const copy of plan.copies) {
    const chat = chats.find(chat => chat.id === copy.chatId)
    const message = chat?.messages.find(message => message.id === copy.messageId)
    if (!chat || !authorised(chat, scope) || !message || signature(message) !== signature(copy.snapshot)) throw new Error('SCOPE_CHANGED: a selected message changed. Review the selection again; no transcript copies were removed.')
  }
}

/** Call only after durable forget/suppression has succeeded and the snapshot
 * has been rechecked. Entire message records leave together, including their
 * tool exchanges; no malformed half-pair survives a body-only deletion. */
export function applyTranscriptForget(plan: TranscriptForgetPlan, chats: AiChat[], now = Date.now()): AiChat[] {
  return chats.map(chat => {
    const ids = new Set(plan.copies.filter(copy => copy.chatId === chat.id).map(copy => copy.messageId))
    if (!ids.size) return chat
    const messages = chat.messages.filter(message => !ids.has(message.id)).map(message => message.contextTrace ? { ...message, contextTrace: accountingOnlyTrace(message.contextTrace) } : message)
    return { ...chat, messages, workingState: buildWorkingState(messages), claudeSessionId: null, lastSessionContext: null,
      tokenUsage: { used: 0, total: 0 }, updatedAt: now }
  })
}
