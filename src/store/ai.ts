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
  /** Not an API at all: the Claude Code CLI on this machine, authenticated by
   *  whatever the user signed it in with — a Claude subscription, usually.
   *  See `sendClaudeCli` in ai-client.ts. */
  | 'claude-cli'
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
  /** Master switch for the `terminal:*` actions, AND-ed with Autopilot: both
   *  must be on before the assistant can run a shell command. Off by default.
   *  Not a containment boundary — R's `system()` already reaches the OS from
   *  behind Autopilot — but the point at which running shell commands becomes
   *  something the user turned on deliberately. */
  terminalEnabled: boolean
  /** Per-action permission overrides for the GUI actions, actionId → tier.
   *  Sparse: only what the user changed. See lib/ai-actions/permissions.ts. */
  actionTiers: Record<string, Tier>
  /**
   * How full the model's context window is, and how big it is.
   *
   * `total` is 0 until a provider has reported one — the panel falls back to
   * the resolved per-model size then. It is the PROVIDER's number when there
   * is one, because a Claude Code alias resolves to a window only that run can
   * name.
   */
  tokenUsage: { used: number; total: number }
  /**
   * The Claude Code CLI keeps its own transcript, so continuity there is a
   * session uuid rather than the message array every other provider is posted.
   *
   * Null means the next turn starts a session; it is cleared when the chat is,
   * which is the honest reset — ouRGeo's panel and the CLI's transcript can
   * otherwise disagree, since deleting a message here does not delete it
   * there.
   */
  claudeSessionId: string | null
  /**
   * The session-state block last sent to a transcript-keeping provider.
   *
   * Only what has CHANGED is worth sending again. Every turn's block goes into
   * the CLI's transcript and stays there, so re-sending an identical listing
   * of the same objects costs its tokens once per turn for the rest of the
   * conversation — on a ten-turn chat, ten copies of the same environment. The
   * block says outright that it replaces any earlier one, so the newest the
   * model has seen is the one in force.
   *
   * Not persisted: it describes one live conversation.
   */
  lastSessionContext: string | null
  /** Fraction of the subscription's rolling windows used, from the CLI's
   *  `rate_limit_event`. Null until a turn has run. */
  claudeUsage: { fiveHour: number; sevenDay: number; resetsAt: number } | null
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
  setTerminalAccess: (on: boolean) => void
  /** Move one action to a tier, or back to its default with null. */
  setActionTier: (actionId: string, tier: Tier | null) => void
  resetActionTiers: () => void
  setTokenUsage: (used: number, total: number) => void
  setClaudeSession: (sessionId: string) => void
  /** Note the session-state block just sent, so the next turn can skip an
   *  identical one. */
  setLastSessionContext: (block: string) => void
  setClaudeUsage: (fiveHour: number, sevenDay: number, resetsAt: number) => void
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
    'claude-cli': 'sonnet',
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
  terminalEnabled: false,
  actionTiers: {},
  // 0 = "no provider has said yet"; the panel draws against the resolved
  // per-model size until one does. A hard-coded 200000 here would have
  // outranked a local model's real 8k window on the very first render.
  tokenUsage: { used: 0, total: 0 },
  claudeSessionId: null,
  lastSessionContext: null,
  claudeUsage: null,
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
      terminalEnabled: prefs.terminalEnabled,
      actionTiers: tiers,
      initialized: true,
    })
  },

  // Both of these drop the token reading. It describes how full ONE model's
  // window was, so carrying it across a switch would show the new model's bar
  // filled by the old one's conversation until the next turn corrected it.
  setProvider: (provider) => {
    // The new provider has been sent nothing, so the next turn must carry the
    // session state in full even if it is identical to the last one sent.
    set({ provider, tokenUsage: { used: 0, total: 0 }, lastSessionContext: null })
    saveAiPreferences({ provider })
  },

  setModel: (model) => {
    const provider = get().provider
    const next = { ...get().modelByProvider, [provider]: model }
    set({ modelByProvider: next, tokenUsage: { used: 0, total: 0 } })
    saveAiPreferences({ modelByProvider: next })
  },

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  appendStreamChunk: (chunk) => set((s) => ({ streamingContent: s.streamingContent + chunk })),

  /**
   * End the turn, keeping what was said.
   *
   * An EMPTY answer adds no message. A blank assistant bubble is what the user
   * is left with when a turn fails before the model says anything, and it
   * reads as the assistant having replied with nothing — the error line under
   * the box is the honest report of that.
   */
  finalizeStream: (fullContent) => {
    const content = fullContent.trim() ? fullContent : ''
    set((s) => ({
      messages: content
        ? [...s.messages, {
            id: crypto.randomUUID(), role: 'assistant' as const, content, timestamp: Date.now(),
          }]
        : s.messages,
      isStreaming: false,
      streamingContent: '',
      abortController: null,
    }))
  },

  /**
   * Stop, and KEEP the half-written answer.
   *
   * It used to throw it away — `streamingContent: ''` — so pressing Stop
   * deleted every word the user had just been reading, including the part
   * they stopped it because they had already got. Stopping means "that is
   * enough", not "undo that".
   */
  cancelStream: () => {
    const { abortController, streamingContent } = get()
    if (abortController) abortController.abort()
    get().finalizeStream(streamingContent)
  },

  // Clearing the chat also drops the CLI's session: leaving it would resume a
  // transcript the user has just told us to forget, and the model would answer
  // from messages that are no longer on screen.
  clearMessages: () => set({
    messages: [], claudeSessionId: null, lastSessionContext: null, streamingContent: '',
    tokenUsage: { used: 0, total: get().tokenUsage.total },
  }),

  setAutoPilot: (on) => set({ autoPilotEnabled: on }),

  setAutopilotWarningDismissed: (v) => {
    set({ autopilotWarningDismissed: v })
    saveAiPreferences({ autopilotWarningDismissed: v })
  },

  setWebAccess: (on) => {
    set({ webAccessEnabled: on })
    saveAiPreferences({ webAccessEnabled: on })
  },

  setTerminalAccess: (on) => {
    set({ terminalEnabled: on })
    saveAiPreferences({ terminalEnabled: on })
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
  setClaudeSession: (claudeSessionId) => set({ claudeSessionId }),
  setLastSessionContext: (lastSessionContext) => set({ lastSessionContext }),
  setClaudeUsage: (fiveHour, sevenDay, resetsAt) =>
    set({ claudeUsage: { fiveHour, sevenDay, resetsAt } }),

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
