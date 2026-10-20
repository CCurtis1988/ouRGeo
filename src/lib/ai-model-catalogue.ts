import type { AiProvider } from '@/store/ai'
import { PROVIDER_MODELS } from './ai-client'

export interface ModelChoice { id: string; label: string }
export interface ModelCatalogueInput {
  provider: AiProvider
  selected?: string
  preferred?: string
  chats?: readonly { provider: AiProvider; model: string }[]
  tasks?: readonly ({ provider: AiProvider; model: string } | null)[]
  discovered?: readonly ModelChoice[]
}

/** Model identity includes its provider. An API key and a subscription are
 * different connections even when both offer the same model name. This is a
 * view of existing choices, never another account/model registration store. */
export function modelCatalogue(input: ModelCatalogueInput): ModelChoice[] {
  const choices = new Map<string, ModelChoice>()
  const add = (id: string | undefined, label?: string): void => {
    if (typeof id !== 'string' || !id.trim()) return
    const name = id.trim()
    if (!choices.has(name)) choices.set(name, { id: name, label: label || name })
    else if (label) choices.set(name, { id: name, label })
  }
  add(input.selected); add(input.preferred)
  for (const chat of input.chats ?? []) if (chat.provider === input.provider) add(chat.model)
  for (const task of input.tasks ?? []) if (task?.provider === input.provider) add(task.model)
  for (const id of PROVIDER_MODELS[input.provider] ?? []) add(id)
  for (const choice of input.discovered ?? []) add(choice.id, choice.label)
  return [...choices.values()]
}
