import { create } from 'zustand'
import { loadAiPreferences, saveAiPreferences } from '@/lib/ai-preferences-persistence'
import {
  setTierOverrides, setTierOverride, clearTierOverrides, type TierOverrides,
} from '@/lib/ai-actions/permissions'
import { TIERS, type Tier } from '@/lib/ai-actions/types'

// Cloud providers have bespoke transports; local providers are OpenAI-compatible
// (except Ollama, which uses its native API). See LOCAL_PROVIDERS in ai-client.ts.
export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'jan'
  | 'localai'
  | 'vllm'
  | 'sglang'
  | 'mistralrs'
  | 'xinference'
  | 'openllm'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: { id: string; code: string }[]
  toolResults?: { id: string; output: string }[]
  timestamp: number
}

interface AiState {
  isOpen: boolean
  initialized: boolean
  provider: AiProvider
  modelByProvider: Record<string, string>
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  autoPilotEnabled: boolean
  autopilotWarningDismissed: boolean
  /** Master switch for the assistant's `web_search`/`web_fetch` tools. When off
   *  the tools are not offered to the model and any in-flight call is refused,
   *  so the only route to the internet left is R code the user sees run in the
   *  console. */
  webAccessEnabled: boolean
  /** Per-action permission overrides for the GUI actions, actionId → tier.
   *  Sparse: only what the user changed. See lib/ai-actions/permissions.ts. */
  actionTiers: Record<string, Tier>
  tokenUsage: { used: number; total: number }
  abortController: AbortController | null

  toggleOpen: () => void
  init: () => Promise<void>
  setProvider: (p: AiProvider) => void
  setModel: (model: string) => void
  addMessage: (msg: ChatMessage) => void
  appendStreamChunk: (chunk: string) => void
  finalizeStream: (fullContent: string) => void
  cancelStream: () => void
  clearMessages: () => void
  setAutoPilot: (on: boolean) => void
  setAutopilotWarningDismissed: (v: boolean) => void
  setWebAccess: (on: boolean) => void
  /** Move one action to a tier, or back to its default with null. */
  setActionTier: (actionId: string, tier: Tier | null) => void
  resetActionTiers: () => void
  setTokenUsage: (used: number, total: number) => void
  beginStream: () => AbortController
  currentModel: () => string
}

export const useAiStore = create<AiState>((set, get) => ({
  isOpen: false,
  initialized: false,
  provider: 'anthropic',
  modelByProvider: {
    openai: 'gpt-4o',
    anthropic: 'claude-opus-4-6',
    google: 'gemini-2.0-flash',
    ollama: 'llama3.1',
    // Local OpenAI-compatible providers — models are fetched from the server at runtime
    lmstudio: '',
    llamacpp: '',
    jan: '',
    localai: '',
    vllm: '',
    sglang: '',
    mistralrs: '',
    xinference: '',
    openllm: '',
  },
  messages: [],
  isStreaming: false,
  streamingContent: '',
  autoPilotEnabled: false,
  autopilotWarningDismissed: false,
  webAccessEnabled: true,
  actionTiers: {},
  tokenUsage: { used: 0, total: 200000 },
  abortController: null,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  init: async () => {
    if (get().initialized) return
    const prefs = await loadAiPreferences()
    // Drop anything that is not a valid tier, so a hand-edited preferences file
    // cannot leave an action stuck in a state the dialog can't show.
    const tiers: TierOverrides = {}
    for (const [id, tier] of Object.entries(prefs.actionTiers ?? {})) {
      if ((TIERS as string[]).includes(tier)) tiers[id] = tier as Tier
    }
    setTierOverrides(tiers)
    set({
      provider: prefs.provider as AiProvider,
      modelByProvider: prefs.modelByProvider,
      autopilotWarningDismissed: prefs.autopilotWarningDismissed,
      webAccessEnabled: prefs.webAccessEnabled,
      actionTiers: tiers,
      initialized: true,
    })
  },

  setProvider: (provider) => {
    set({ provider })
    saveAiPreferences({ provider })
  },

  setModel: (model) => {
    const provider = get().provider
    const next = { ...get().modelByProvider, [provider]: model }
    set({ modelByProvider: next })
    saveAiPreferences({ modelByProvider: next })
  },

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  appendStreamChunk: (chunk) => set((s) => ({ streamingContent: s.streamingContent + chunk })),

  finalizeStream: (fullContent) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: fullContent,
      timestamp: Date.now(),
    }
    set((s) => ({
      messages: [...s.messages, msg],
      isStreaming: false,
      streamingContent: '',
      abortController: null,
    }))
  },

  cancelStream: () => {
    const ac = get().abortController
    if (ac) ac.abort()
    set({ isStreaming: false, streamingContent: '', abortController: null })
  },

  clearMessages: () => set({ messages: [], tokenUsage: { used: 0, total: get().tokenUsage.total } }),

  setAutoPilot: (on) => set({ autoPilotEnabled: on }),

  setAutopilotWarningDismissed: (v) => {
    set({ autopilotWarningDismissed: v })
    saveAiPreferences({ autopilotWarningDismissed: v })
  },

  setWebAccess: (on) => {
    set({ webAccessEnabled: on })
    saveAiPreferences({ webAccessEnabled: on })
  },

  setActionTier: (actionId, tier) => {
    // permissions.ts holds the map the tool layer reads at call time; the store
    // mirrors it so the dialog re-renders and the file gets written.
    const next = setTierOverride(actionId, tier)
    set({ actionTiers: next })
    saveAiPreferences({ actionTiers: next })
  },

  resetActionTiers: () => {
    clearTierOverrides()
    set({ actionTiers: {} })
    saveAiPreferences({ actionTiers: {} })
  },

  setTokenUsage: (used, total) => set({ tokenUsage: { used, total } }),

  beginStream: () => {
    const ac = new AbortController()
    set({ isStreaming: true, streamingContent: '', abortController: ac })
    return ac
  },

  currentModel: () => {
    const { provider, modelByProvider } = get()
    return modelByProvider[provider] ?? ''
  },
}))
