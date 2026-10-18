import type { ContextSource, DocumentRange } from './types'
import type { ChatMessage } from '@/store/ai'
import { estimateTokens, inputCapacity } from './budget'
import { selectConversation } from './compaction'

export interface ContextAttachment {
  sourceId: string
  revision: string
  workspaceEpoch: number
  location?: import('@/lib/project-files').ProjectFileLocation
  range?: DocumentRange
}
export interface StagedAttachment extends ContextAttachment {
  title: string
  kind: 'environment' | 'console' | 'document'
}
export interface AttachmentSection { title: string; startLine: number; endLine: number }

/** Reserve explicit input before optional old assistant replies. The selector
 * retains every original user message; oversized instructions still fail the
 * final compiler rather than being clipped to make attachments fit. */
export function attachmentHeadroom(messages: ChatMessage[], fixed: Record<string, unknown>, window: number, output: number, count: number): number {
  const capacity = inputCapacity(window, output)
  const dialogue = count ? selectConversation(messages, Math.max(0, capacity - estimateTokens(fixed) - 300 - 2400)).messages : messages
  return Math.max(0, capacity - estimateTokens({ ...fixed, messages: dialogue }) - 300)
}

/** Headings inside fenced code are data, not document boundaries. Each range
 * includes complete code chunks and remains tied to the chosen buffer revision. */
export function attachmentSections(text: string): AttachmentSection[] {
  const lines = text.split('\n')
  const starts: { title: string; startLine: number }[] = [{ title: 'Opening section', startLine: 1 }]
  let fence: { char: string; length: number } | null = null
  for (let index = 0; index < lines.length; index++) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[index])
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[index])) fence = null
      continue
    }
    if (fence) continue
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index])
    if (!heading) continue
    const section = { title: heading[1].slice(0, 120), startLine: index + 1 }
    if (index === 0) starts[0] = section
    else starts.push(section)
  }
  return starts.map((start, index) => ({ ...start, endLine: (starts[index + 1]?.startLine ?? lines.length + 1) - 1 }))
}

export function stageAttachment(source: ContextSource, workspaceEpoch: number, range?: ContextAttachment['range']): StagedAttachment {
  if (!['environment', 'console', 'document'].includes(source.kind)) throw new Error('SOURCE_UNAVAILABLE: choose a live layer, document or console execution.')
  if (range && (source.kind !== 'document' || !Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine)) throw new Error('Choose positive, ordered document line numbers.')
  return { sourceId: source.id, revision: source.revision, workspaceEpoch, kind: source.kind as StagedAttachment['kind'], title: source.title.slice(0, 120), ...(range ? { range: { ...range } } : {}) }
}

export function addAttachment(current: StagedAttachment[], next: StagedAttachment): StagedAttachment[] {
  const index = current.findIndex(item => item.sourceId === next.sourceId)
  if (index >= 0) return current.map((item, at) => at === index ? next : item)
  if (current.length >= 3) throw new Error('Choose up to three attachments. Remove one before adding another.')
  return [...current, next]
}
