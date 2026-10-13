import type { ChatMessage, AiChat } from '@/store/ai'

/** Past prose can contain a derivative of an excluded source without naming
 * it. Until complete lineage exists, reconstruct from original user messages
 * rather than treating an old assistant answer as privacy-safe evidence. */
export function disclosureDialogue(messages: ChatMessage[], excluded: string[], loaded: boolean): ChatMessage[] {
  return loaded && !excluded.length ? messages : messages.filter(message => message.role === 'user')
}

/** Retained-provider IDs and delivery caches are optimisations, not unsaved
 * project work. Revoking them must not trigger a project save prompt. */
export function chatContentChanged(chats: AiChat[], previous: AiChat[]): boolean {
  if (chats.length !== previous.length) return true
  return chats.some((chat, index) => {
    const prior = previous[index]
    const keys: (keyof AiChat)[] = ['id', 'title', 'renamed', 'createdAt', 'updatedAt', 'messages', 'workingState', 'conversationMemories', 'provider', 'model', 'tokenUsage']
    return keys.some(key => {
      if (key !== 'messages') return chat[key] !== prior[key]
      if (chat.messages === prior.messages) return false
      if (chat.messages.length !== prior.messages.length) return true
      return chat.messages.some((message, position) => {
        const old = prior.messages[position]
        // Diagnostic retention is not an edit to the user's conversation.
        const fields = Object.keys(message).filter(field => field !== 'contextTrace')
        return fields.length !== Object.keys(old).filter(field => field !== 'contextTrace').length
          || fields.some(field => message[field as keyof ChatMessage] !== old[field as keyof ChatMessage])
      })
    })
  })
}
