import { create } from 'zustand'
import { loadApiKeys, saveApiKey } from '@/lib/api-keys-persistence'

interface ApiKeysState {
  keys: Record<string, string>
  initialized: boolean
  setKey: (id: string, value: string) => void
  getKey: (id: string) => string
  init: () => Promise<void>
}

export const useApiKeysStore = create<ApiKeysState>((set, get) => ({
  keys: {},
  initialized: false,

  setKey: (id, value) => {
    saveApiKey(id, value)
    set((s) => ({ keys: { ...s.keys, [id]: value } }))
  },

  getKey: (id) => get().keys[id] ?? '',

  init: async () => {
    if (get().initialized) return
    const keys = await loadApiKeys()
    set({ keys, initialized: true })
  },
}))
