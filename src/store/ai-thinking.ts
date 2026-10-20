import { create } from 'zustand'
import { createJsonFileStore } from '@/lib/persistence'
import { thinkingKey } from '@/lib/ai-thinking'
import type { AiProvider } from '@/store/ai'
const file = createJsonFileStore('ai-thinking.json', 'AI thinking')
interface State {
  initialized: boolean
  selections: Record<string, string>
  error: string | null
  init: () => Promise<void>
  setEffort: (provider: AiProvider, model: string, value: string) => Promise<void>
}
let initializing: Promise<void> | undefined
let queue = Promise.resolve()
export const useAiThinkingStore = create<State>((set, get) => ({
  initialized: false, selections: {}, error: null,
  init: () => {
    if (get().initialized) return Promise.resolve()
    if (initializing) return initializing
    initializing = (async () => {
      const data = await file.read<{ selections?: unknown }>()
      const selections: Record<string, string> = {}
      if (data?.selections && typeof data.selections === 'object' && !Array.isArray(data.selections)) {
        for (const [key, value] of Object.entries(data.selections)) if (typeof value === 'string' && value.length <= 64) selections[key] = value
      }
      set({ initialized: true, selections })
    })().finally(() => { initializing = undefined })
    return initializing
  },
  setEffort: async (provider, model, value) => {
    await get().init()
    const save = async (): Promise<void> => {
      const selections = { ...get().selections }
      const key = thinkingKey(provider, model)
      if (value === 'default') delete selections[key]
      else selections[key] = value
      await file.write({ selections })
      const saved = await file.read<{ selections?: Record<string, string> }>()
      if (JSON.stringify(saved.selections) !== JSON.stringify(selections)) {
        const message = 'Thinking setting could not be saved. Check disk space and permissions, then retry.'
        set({ error: message }); throw new Error(message)
      }
      set({ selections, error: null })
    }
    const next = queue.then(save, save)
    queue = next.catch(() => undefined)
    return next
  },
}))
