import { create } from 'zustand'

type Status = Awaited<ReturnType<Window['electronAPI']['chatgpt']['status']>>
interface ChatGptState {
  status: Status | null
  models: { id: string; label: string }[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  act: (action: () => Promise<unknown>) => Promise<void>
}
let generation = 0
export const useChatGptStore = create<ChatGptState>((set) => ({
  status: null, models: [], loading: false, error: null,
  refresh: async () => {
    const current = ++generation
    set({ loading: true })
    try {
      const api = window.electronAPI?.chatgpt
      if (!api) throw new Error('ChatGPT sign-in is available in the ouRGeo desktop app.')
      const status = await api.status()
      if (current !== generation) return
      set({ status, models: [], error: status.error })
      const models = status.planEnabled && !status.signingIn ? await api.models() : []
      if (current === generation) set({ models, loading: false })
    } catch (e) {
      if (current === generation) set({ loading: false, models: [], error: e instanceof Error ? e.message : String(e) })
    }
  },
  act: async (action) => {
    ++generation
    set({ loading: true, error: null, models: [] })
    try { await action(); await useChatGptStore.getState().refresh() }
    catch (e) { set({ loading: false, error: e instanceof Error ? e.message : String(e) }) }
  },
}))
