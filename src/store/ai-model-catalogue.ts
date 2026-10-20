import { create } from 'zustand'
import type { AiProvider } from './ai'
import { fetchLocalModels } from '@/lib/ai-client'
import type { ModelChoice } from '@/lib/ai-model-catalogue'

interface Discovery { models: ModelChoice[]; loading: boolean; error: string | null }
interface CatalogueState {
  discoveries: Partial<Record<AiProvider, Discovery>>
  refresh: (provider: AiProvider, url: string, key: string, force?: boolean) => Promise<void>
}
const requests = new Map<AiProvider, { url: string; key: string; at: number; promise?: Promise<void> }>()
export const EMPTY_DISCOVERY: Discovery = { models: [], loading: false, error: null }

/** Credentials identify an in-memory request only. They are never copied into
 * catalogue state, persisted or used to create another provider connection. */
export const useAiModelCatalogueStore = create<CatalogueState>((set) => ({
  discoveries: {},
  refresh: (provider, url, key, force = false) => {
    const previous = requests.get(provider), same = previous?.url === url && previous.key === key
    if (same && previous.promise) return previous.promise
    if (same && !force && Date.now() - previous.at < 30_000) return Promise.resolve()
    const request = { url, key, at: Date.now(), promise: undefined as Promise<void> | undefined }
    requests.set(provider, request)
    set(state => ({ discoveries: { ...state.discoveries, [provider]: { models: same ? state.discoveries[provider]?.models ?? [] : [], loading: true, error: null } } }))
    request.promise = (async () => {
      try {
        const result = await fetchLocalModels(provider, url, key)
        if (requests.get(provider) !== request) return
        const models = [...new Set(result.models.map(id => id.trim()).filter(Boolean))].map(id => ({ id, label: id }))
        set(state => ({ discoveries: { ...state.discoveries, [provider]: { models, loading: false, error: result.error ?? null } } }))
      } catch (error) {
        if (requests.get(provider) === request) set(state => ({ discoveries: { ...state.discoveries, [provider]: { models: [], loading: false, error: error instanceof Error ? error.message : String(error) } } }))
      }
    })().finally(() => { if (requests.get(provider) === request) { request.promise = undefined; request.at = Date.now() } })
    return request.promise
  },
}))
