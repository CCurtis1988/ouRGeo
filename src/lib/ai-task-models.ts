import type { AiProvider } from '@/store/ai'

export type TaskKind = 'document' | 'image'
export type TaskModelSelection = { provider: AiProvider; model: string } | null
export type TaskModelPreferences = Record<TaskKind, TaskModelSelection>

const providers: AiProvider[] = ['openai', 'openai-subscription', 'anthropic', 'claude-cli', 'google', 'ollama', 'lmstudio', 'llamacpp', 'jan', 'localai', 'vllm', 'sglang', 'mistralrs', 'xinference', 'openllm']

/** Reject a broken explicit destination rather than silently sending to the assistant. */
export function validateTaskModelSelection(value: unknown): TaskModelSelection {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('Choose a valid file analysis provider and model.')
  const route = value as Record<string, unknown>
  if (!providers.includes(route.provider as AiProvider) || typeof route.model !== 'string' || !route.model.trim() || route.model.length > 200 || Array.from(route.model).some(character => character.charCodeAt(0) < 32)) {
    throw new Error('The saved file analysis provider or model is invalid. Repair or reset File analysis models in Settings.')
  }
  return { provider: route.provider as AiProvider, model: route.model.trim() }
}

export function resolveTaskModel(selection: TaskModelSelection, assistant: NonNullable<TaskModelSelection>): NonNullable<TaskModelSelection> {
  return validateTaskModelSelection(selection) ?? validateTaskModelSelection(assistant)!
}
