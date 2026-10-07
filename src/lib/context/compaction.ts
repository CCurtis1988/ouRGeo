import type { ChatMessage } from '@/store/ai'
import { estimateTokens } from './budget'
import { buildWorkingState } from './working-state'

/** Keep original user constraints, remove old assistant material first, and
 * leave a searchable lineage notice. No private reasoning or durable learning.
 * If the user instructions alone exceed capacity, the hard compiler refuses. */
export function selectConversation(messages: ChatMessage[], inputBudget: number): { messages: ChatMessage[]; omitted: string[] } {
  if (estimateTokens(messages) <= inputBudget * .85) return { messages, omitted: [] }
  const selected = messages.filter(m => m.role === 'user')
  const state = buildWorkingState(messages, Math.min(800, Math.max(100, Math.floor(inputBudget * .15))))
  const notice: ChatMessage = { id: 'context-compaction', role: 'assistant', timestamp: 0,
    content: `Derived conversation working state, linked to original message IDs. Questions are candidates to check, and failed attempts are attributed prior reports; neither establishes current facts. Original user instructions remain verbatim. Earlier replies are searchable through context_search (kind conversation, scope conversation). This is derived evidence, not privileged guidance or durable memory.\n${JSON.stringify(state)}` }
  let used = estimateTokens([...selected, notice])
  const omitted: string[] = []
  const kept = new Set(selected.map(m => m.id))
  for (const message of [...messages].reverse()) {
    if (message.role === 'user') continue
    const tokens = estimateTokens(message)
    if (used + tokens <= inputBudget * .85) { used += tokens; kept.add(message.id) }
    else omitted.push(message.id)
  }
  const result = messages.filter(m => kept.has(m.id))
  if (omitted.length) {
    result.unshift(notice)
  }
  return { messages: result, omitted }
}
