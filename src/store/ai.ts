import { create } from 'zustand'
import { loadAiPreferences, saveAiPreferences } from '@/lib/ai-preferences-persistence'
import {
  setTierOverrides, setTierOverride, clearTierOverrides, type TierOverrides,
} from '@/lib/ai-actions/permissions'
import { TIERS, type Tier } from '@/lib/ai-actions/types'
import type { SentContext } from '@/lib/ai-session-context'

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

/**
 * One conversation, and everything that belongs to that conversation rather
 * than to the panel.
 *
 * The panel used to hold exactly one, in memory only: a renderer reload lost
 * it, and the only way to ask an unrelated question was the "New" button,
 * which destroyed it. Chats are now a SET the project owns — the same move the
 * code editor makes with tabs and the terminal makes with shells.
 *
 * Shaped after `NamedSession` in store/geometryEdit.ts and `TerminalSession`
 * in store/terminal.ts, including the `renamed` rule both of those need.
 */
export interface AiChat {
  id: string
  /** What the switcher shows: derived from the first user message until the
   *  user renames it, after which theirs wins — the rule
   *  `TerminalSession.renamed` encodes for shell title sequences. */
  title: string
  renamed: boolean
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  /**
   * The provider and model this conversation was actually held with, restored
   * when you switch back to it.
   *
   * A conversation written by Opus and one written by a local 8B are not the
   * same artefact, and continuing the first with the second — silently, because
   * the model selector is a global — is the failure this prevents.
   */
  provider: AiProvider
  model: string
  /**
   * Claude Code's own transcript id for this conversation.
   *
   * An OPTIMISATION, never the record. `messages` is the record. A project
   * opened on another machine names a session that machine has never seen, and
   * the CLI answers `No conversation found with session ID` and exits 1 — so
   * `sendClaudeCli` treats a dead id as a cache miss and starts a fresh
   * session from what is stored here. See ai-client.ts.
   */
  claudeSessionId: string | null
  /**
   * What this chat's transcript has already been told about the session, so
   * nothing is said twice. Per chat, because each has its own transcript.
   *
   * A record rather than the block itself since 1.15.3: the sections change
   * independently, and comparing the whole thing meant one moving console line
   * re-sent the entire object listing. See `lib/ai-session-context.ts`.
   */
  lastSessionContext: SentContext | null
  /** How full this conversation's context window is. See `tokenUsage` below. */
  tokenUsage: { used: number; total: number }
}

/**
 * The stable empty list.
 *
 * `selectMessages` must never return a fresh `[]`: a selector that BUILDS a
 * value returns a new one on every call, which zustand reads as a change and
 * re-renders for ever. Recorded at TabBar.tsx for the same trap.
 */
const NO_MESSAGES: ChatMessage[] = []

export const selectActiveChat = (s: { chats: AiChat[]; activeChatId: string | null }): AiChat | null =>
  s.chats.find((c) => c.id === s.activeChatId) ?? null

export const selectMessages = (s: { chats: AiChat[]; activeChatId: string | null }): ChatMessage[] =>
  selectActiveChat(s)?.messages ?? NO_MESSAGES

/**
 * A chat's name, from its first user message.
 *
 * Derived rather than asked for: a title is not worth a model round trip, and
 * one that cost tokens would be a title nobody wanted on a two-line question.
 */
export function titleFor(messages: ChatMessage[], fallback = 'New chat'): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return fallback
  const flat = first.content.replace(/\s+/g, ' ').trim()
  if (!flat) return fallback
  return flat.length <= 44 ? flat : `${flat.slice(0, 43).trimEnd()}…`
}

/** A brand-new, empty conversation on the given provider/model. */
export function makeChat(provider: AiProvider, model: string): AiChat {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    renamed: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
    provider,
    model,
    claudeSessionId: null,
    lastSessionContext: null,
    tokenUsage: { used: 0, total: 0 },
  }
}

/**
 * Update the active chat in place, leaving every other one alone.
 *
 * Lifted straight from `patchActiveSession` (store/geometryEdit.ts) and for
 * the same reason: without it every mutating action repeats the same find-map
 * dance, and one of them eventually gets it wrong. `updatedAt` moves here, so
 * no caller can forget it and leave the switcher sorting on a stale time.
 */
function patchActiveChat(
  chats: AiChat[], activeChatId: string | null, updater: (c: AiChat) => AiChat,
): AiChat[] {
  if (!activeChatId) return chats
  return chats.map((c) => (c.id === activeChatId ? { ...updater(c), updatedAt: Date.now() } : c))
}

interface AiState {
  isOpen: boolean
  initialized: boolean
  provider: AiProvider
  modelByProvider: Record<string, string>
  /** Every conversation in this project, oldest first. */
  chats: AiChat[]
  activeChatId: string | null
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
  /** Fraction of the subscription's rolling windows used, from the CLI's
   *  `rate_limit_event`. Null until a turn has run. A property of the plan,
   *  not of a conversation, so it stays here. */
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
  /** Start a fresh conversation and show it, keeping every existing one. */
  newChat: () => string
  /** Show an existing conversation, restoring the provider and model it was
   *  held with. Stops a running turn first, keeping its partial answer. */
  switchChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  deleteChat: (id: string) => void
  /** Replace the whole set — a project load, or a restored session file. */
  loadChats: (chats: AiChat[], activeChatId: string | null) => void
  setAutoPilot: (on: boolean) => void
  setAutopilotWarningDismissed: (v: boolean) => void
  setWebAccess: (on: boolean) => void
  setTerminalAccess: (on: boolean) => void
  /** Move one action to a tier, or back to its default with null. */
  setActionTier: (actionId: string, tier: Tier | null) => void
  resetActionTiers: () => void
  setTokenUsage: (used: number, total: number) => void
  setClaudeSession: (sessionId: string) => void
  /** Forget a Claude Code transcript id the CLI no longer has. */
  clearClaudeSession: () => void
  /** Note what this chat's transcript has now been told, so the next turn can
   *  say only what has moved since. */
  setLastSessionContext: (sent: SentContext) => void
  setClaudeUsage: (fiveHour: number, sevenDay: number, resetsAt: number) => void
  beginStream: () => AbortController
  currentModel: () => string
}

/** The chat the panel opens on before anything is loaded. Its provider and
 *  model are corrected by `init()` once preferences are read. */
const INITIAL_CHAT = makeChat('anthropic', 'claude-opus-4-6')

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
  // One empty chat from the start: a panel with no chat at all has no place to
  // put the first message, and `deleteChat` maintains the same invariant.
  chats: [INITIAL_CHAT],
  activeChatId: INITIAL_CHAT.id,
  isStreaming: false,
  streamingContent: '',
  autoPilotEnabled: false,
  autopilotWarningDismissed: false,
  webAccessEnabled: true,
  terminalEnabled: false,
  actionTiers: {},
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
    const provider = prefs.provider as AiProvider
    const model = prefs.modelByProvider[provider] ?? ''
    set((st) => ({
      provider,
      modelByProvider: prefs.modelByProvider,
      autopilotWarningDismissed: prefs.autopilotWarningDismissed,
      webAccessEnabled: prefs.webAccessEnabled,
      terminalEnabled: prefs.terminalEnabled,
      actionTiers: tiers,
      initialized: true,
      // The seed chat was built before preferences were readable. Correct it
      // — but only while it is still untouched, or reading preferences would
      // rewrite the provider of a conversation restored from disk.
      chats: st.chats.map((c) => (
        c.messages.length === 0 && !c.renamed ? { ...c, provider, model } : c
      )),
    }))
  },

  // Both of these drop the token reading. It describes how full ONE model's
  // window was, so carrying it across a switch would show the new model's bar
  // filled by the old one's conversation until the next turn corrected it.
  setProvider: (provider) => {
    const model = get().modelByProvider[provider] ?? ''
    set((s) => ({
      provider,
      // The active chat moves with the selector — picking a model IS choosing
      // what continues this conversation, and the chat has to record what
      // answered it or switching back would restore the wrong one.
      chats: patchActiveChat(s.chats, s.activeChatId, (c) => ({
        ...c,
        provider,
        model,
        // The new provider has been sent nothing, so the next turn must carry
        // the session state in full even if it matches the last one sent.
        lastSessionContext: null,
        tokenUsage: { used: 0, total: 0 },
      })),
    }))
    // Persisted as the default a NEW chat starts on. `switchChat` deliberately
    // does not come through here: opening an old conversation must not rewrite
    // what the next new one begins with.
    saveAiPreferences({ provider })
  },

  setModel: (model) => {
    const provider = get().provider
    const next = { ...get().modelByProvider, [provider]: model }
    set((s) => ({
      modelByProvider: next,
      chats: patchActiveChat(s.chats, s.activeChatId, (c) => ({
        ...c, model, tokenUsage: { used: 0, total: 0 },
      })),
    }))
    saveAiPreferences({ modelByProvider: next })
  },

  addMessage: (msg) => set((s) => ({
    chats: patchActiveChat(s.chats, s.activeChatId, (c) => ({
      ...c,
      messages: [...c.messages, msg],
      // The first user message names the chat, unless the user already has.
      title: c.renamed ? c.title : titleFor([...c.messages, msg], c.title),
    })),
  })),

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
      chats: content
        ? patchActiveChat(s.chats, s.activeChatId, (c) => ({
            ...c,
            messages: [...c.messages, {
              id: crypto.randomUUID(), role: 'assistant' as const, content, timestamp: Date.now(),
            }],
          }))
        : s.chats,
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

  newChat: () => {
    // Seeded from the CURRENT selection, which is the default a new
    // conversation starts on. Nothing is discarded — that is the whole point.
    const chat = makeChat(get().provider, get().currentModel())
    set((s) => ({ chats: [...s.chats, chat], activeChatId: chat.id, streamingContent: '' }))
    return chat.id
  },

  switchChat: (id) => {
    const s = get()
    if (id === s.activeChatId) return
    const target = s.chats.find((c) => c.id === id)
    if (!target) return
    // A turn in flight belongs to the chat it was started in. Stopping it
    // first files its partial answer there (cancelStream keeps it) rather
    // than letting the next chunk land in the conversation being opened.
    if (s.isStreaming) get().cancelStream()
    set({
      activeChatId: id,
      streamingContent: '',
      // The conversation's own provider and model, NOT through
      // setProvider/setModel: those write ai-preferences.json, so opening an
      // old chat would silently change what the next new one starts on.
      provider: target.provider,
      modelByProvider: target.model
        ? { ...get().modelByProvider, [target.provider]: target.model }
        : get().modelByProvider,
    })
  },

  renameChat: (id, title) => set((s) => {
    const clean = title.trim()
    if (!clean) return s
    return {
      chats: s.chats.map((c) => (c.id === id ? { ...c, title: clean, renamed: true } : c)),
    }
  }),

  deleteChat: (id) => set((s) => {
    const remaining = s.chats.filter((c) => c.id !== id)
    // Never zero. A panel with no chat has nowhere to put the next message,
    // and an empty switcher is a dead end rather than a clean slate.
    if (remaining.length === 0) {
      const fresh = makeChat(s.provider, s.modelByProvider[s.provider] ?? '')
      return { chats: [fresh], activeChatId: fresh.id, streamingContent: '' }
    }
    if (s.activeChatId !== id) return { chats: remaining, activeChatId: s.activeChatId }
    // The NEIGHBOUR, not the first: deleting the third of five and landing on
    // the first loses the user's place, exactly as it does in the terminal's
    // tab strip.
    const wasAt = s.chats.findIndex((c) => c.id === id)
    const next = remaining[Math.min(wasAt, remaining.length - 1)]
    return {
      chats: remaining,
      activeChatId: next.id,
      streamingContent: '',
      provider: next.provider,
      modelByProvider: next.model
        ? { ...s.modelByProvider, [next.provider]: next.model }
        : s.modelByProvider,
    }
  }),

  loadChats: (chats, activeChatId) => set((s) => {
    // A file can be empty, truncated, or name an active chat that is not in
    // it. Any of those must still leave a usable panel.
    const usable = chats.length > 0
      ? chats
      : [makeChat(s.provider, s.modelByProvider[s.provider] ?? '')]
    const active = usable.find((c) => c.id === activeChatId) ?? usable[usable.length - 1]
    return {
      chats: usable,
      activeChatId: active.id,
      streamingContent: '',
      provider: active.provider,
      modelByProvider: active.model
        ? { ...s.modelByProvider, [active.provider]: active.model }
        : s.modelByProvider,
    }
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

  setTokenUsage: (used, total) => set((s) => ({
    chats: patchActiveChat(s.chats, s.activeChatId, (c) => ({ ...c, tokenUsage: { used, total } })),
  })),

  setClaudeSession: (claudeSessionId) => set((s) => ({
    chats: patchActiveChat(s.chats, s.activeChatId, (c) => ({ ...c, claudeSessionId })),
  })),

  clearClaudeSession: () => set((s) => ({
    chats: patchActiveChat(s.chats, s.activeChatId, (c) => ({
      // The context block goes with it: a fresh transcript has been sent
      // nothing, so the next turn must carry the session state in full.
      ...c, claudeSessionId: null, lastSessionContext: null,
    })),
  })),

  setLastSessionContext: (lastSessionContext) => set((s) => ({
    chats: patchActiveChat(s.chats, s.activeChatId, (c) => ({ ...c, lastSessionContext })),
  })),
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
