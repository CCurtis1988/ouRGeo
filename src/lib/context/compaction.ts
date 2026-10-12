import type { ChatMessage } from '@/store/ai'
import { estimateTokens } from './budget'
import { buildWorkingState } from './working-state'

/** Persisted chats usually keep an exchange in one assistant record, but
 * imported/legacy records may separate it. Select the whole linked component;
 * never manufacture a call or drop the only result for a retained call. */
function exchangeGroups(messages: ChatMessage[]): { messages: ChatMessage[]; pending: boolean }[] {
  const parent = messages.map((_, index) => index)
  const find = (index: number): number => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index] } return index }
  const owners = new Map<string, number>(), calls = new Set<string>(), results = new Set<string>()
  messages.forEach((message, index) => {
    for (const item of [...message.toolCalls ?? [], ...message.toolResults ?? []]) {
      const previous = owners.get(item.id)
      if (previous !== undefined) parent[find(index)] = find(previous)
      else owners.set(item.id, index)
    }
    for (const call of message.toolCalls ?? []) calls.add(call.id)
    for (const result of message.toolResults ?? []) results.add(result.id)
  })
  const groups = new Map<number, { messages: ChatMessage[]; pending: boolean }>()
  messages.forEach((message, index) => {
    const root = find(index), group = groups.get(root) ?? { messages: [], pending: false }
    group.messages.push(message)
    if (message.role === 'user' || message.toolCalls?.some(call => !results.has(call.id)) || message.toolResults?.some(result => !calls.has(result.id))) group.pending = true
    groups.set(root, group)
  })
  return [...groups.values()]
}

/** Keep original user constraints, remove old assistant material first, and
 * leave a searchable lineage notice. No private reasoning or durable learning.
 * If the user instructions alone exceed capacity, the hard compiler refuses. */
export function selectConversation(messages: ChatMessage[], inputBudget: number): { messages: ChatMessage[]; omitted: string[] } {
  if (estimateTokens(messages) <= inputBudget * .85) return { messages, omitted: [] }
  const groups = exchangeGroups(messages)
  const selected = groups.filter(group => group.pending).flatMap(group => group.messages)
  const state = buildWorkingState(messages, Math.min(800, Math.max(100, Math.floor(inputBudget * .15))))
  const notice: ChatMessage = { id: 'context-compaction', role: 'assistant', timestamp: 0,
    content: `Derived conversation working state, linked to original message IDs. Questions are candidates to check, and failed attempts are attributed prior reports; neither establishes current facts. Original user instructions remain verbatim. Earlier replies are searchable through context_search (kind conversation, scope conversation). This is derived evidence, not privileged guidance or durable memory.\n${JSON.stringify(state)}` }
  let used = estimateTokens([...selected, notice])
  const omitted: string[] = []
  const kept = new Set(selected.map(m => m.id))
  for (const group of [...groups].reverse()) {
    if (group.pending) continue
    const tokens = group.messages.reduce((sum, message) => sum + estimateTokens(message), 0)
    if (used + tokens <= inputBudget * .85) { used += tokens; for (const message of group.messages) kept.add(message.id) }
    else for (const message of [...group.messages].reverse()) omitted.push(message.id)
  }
  const result = messages.filter(m => kept.has(m.id))
  if (omitted.length) {
    result.unshift(notice)
  }
  return { messages: result, omitted }
}
