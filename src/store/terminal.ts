// The Terminal panel's sessions — their names, not their contents.
//
// The panel owns a SET, the way the code editor owns tabs, and this store is
// that set. What is emphatically NOT in it is the output: a pty produces data
// tens of times a second, and a store update per chunk would re-render the
// panel — and everything subscribed to it — for the whole of a `cat`. The IPC
// listener writes straight into xterm's own buffer instead, which is the same
// rule the voice level meter needed and for the same reason.
//
// So what is here is what the tab strip draws and what an assistant asking
// `terminal:list` needs to answer: which sessions exist, what shell each one
// is, where it is, and whether it is still alive.

import { create } from 'zustand'
import {
  loadTerminalPreferences, saveTerminalPreferences,
  TERMINAL_PREFERENCE_DEFAULTS,
  type TerminalPreferences, type TerminalPlacement,
} from '@/lib/terminal-preferences-persistence'

export interface TerminalSession {
  /** The id main assigned to the pty. */
  id: string
  /** Shell profile id — `bash`, `pwsh`, `git-bash`. */
  profileId: string
  /** What the tab says. Follows the shell's own title sequence (OSC 0/2) until
   *  the user renames it, after which theirs wins — a shell that retitles on
   *  every command must not undo a name the user chose. */
  title: string
  renamed: boolean
  /** Best-effort, from OSC 7. Absent for a shell that does not report it, which
   *  is why nothing depends on it being right. */
  cwd: string | null
  alive: boolean
  exitCode: number | null
  /** A `\a` arrived while this tab was not in front. Cleared on activation. */
  bell: boolean
}

interface TerminalStore {
  /** Mirrored into the layout — see PANEL_STORES in store/layout.ts. */
  isOpen: boolean
  sessions: TerminalSession[]
  activeId: string | null
  /** Null until asked, then the answer main gave. A machine with no usable
   *  binary shows the reason rather than a terminal that fails on first key. */
  backendError: string | null
  prefs: TerminalPreferences
  prefsLoaded: boolean

  toggleOpen: () => void
  setOpen: (v: boolean) => void

  addSession: (s: TerminalSession) => void
  removeSession: (id: string) => void
  setActive: (id: string) => void
  patchSession: (id: string, patch: Partial<TerminalSession>) => void
  markExited: (id: string, exitCode: number) => void

  setBackendError: (e: string | null) => void

  loadPrefs: () => Promise<void>
  setPrefs: (patch: Partial<TerminalPreferences>) => void
  setPlacement: (p: TerminalPlacement) => void
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  isOpen: false,
  sessions: [],
  activeId: null,
  backendError: null,
  prefs: { ...TERMINAL_PREFERENCE_DEFAULTS },
  prefsLoaded: false,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (v) => set({ isOpen: v }),

  addSession: (session) => set((s) => ({
    sessions: [...s.sessions, session],
    activeId: session.id,
  })),

  removeSession: (id) => set((s) => {
    const sessions = s.sessions.filter((x) => x.id !== id)
    if (s.activeId !== id) return { sessions, activeId: s.activeId }
    // Activate the neighbour rather than the first tab: closing the third of
    // five and landing on the first loses the user's place in the strip.
    const wasAt = s.sessions.findIndex((x) => x.id === id)
    const next = sessions[Math.min(wasAt, sessions.length - 1)] ?? null
    return { sessions, activeId: next?.id ?? null }
  }),

  setActive: (id) => set((s) => ({
    activeId: id,
    sessions: s.sessions.map((x) => (x.id === id ? { ...x, bell: false } : x)),
  })),

  patchSession: (id, patch) => set((s) => {
    const hit = s.sessions.find((x) => x.id === id)
    if (!hit) return s
    // A title sequence fires on every prompt in many shells, so bail when
    // nothing actually changed — otherwise the strip re-renders per command.
    if (Object.entries(patch).every(([k, v]) => hit[k as keyof TerminalSession] === v)) return s
    return { sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }
  }),

  markExited: (id, exitCode) => set((s) => ({
    // The tab STAYS. Output is often the whole point of running the command,
    // and closing the tab on exit would throw away the error the user is about
    // to read. It greys out and offers a restart instead.
    sessions: s.sessions.map((x) => (
      x.id === id ? { ...x, alive: false, exitCode } : x
    )),
  })),

  setBackendError: (backendError) => set({ backendError }),

  loadPrefs: async () => {
    if (get().prefsLoaded) return
    set({ prefs: await loadTerminalPreferences(), prefsLoaded: true })
  },

  setPrefs: (patch) => {
    set((s) => ({ prefs: { ...s.prefs, ...patch } }))
    void saveTerminalPreferences(patch)
  },

  setPlacement: (placement) => {
    set((s) => ({ prefs: { ...s.prefs, placement } }))
    void saveTerminalPreferences({ placement })
  },
}))
