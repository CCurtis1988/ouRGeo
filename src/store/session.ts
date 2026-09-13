import { create } from 'zustand'

export interface ConsoleEntry {
  id: string
  type: 'input' | 'output' | 'error' | 'info'
  text: string
  timestamp: number
  /**
   * Set on the entries the AI assistant itself produced — the code it ran, the
   * output that came back, and the one-line note logged for every document,
   * interface and web call.
   *
   * Nothing on screen reads it: an assistant's command is drawn exactly like a
   * typed one, because the console is one record of what happened to the
   * session and who typed a line is not what a reader is looking for.
   *
   * What reads it is `ai-session-context.ts`. A transcript-keeping provider has
   * already been handed every one of these as a TOOL RESULT, so repeating them
   * in the next turn's session-state block bills the same bytes twice and
   * leaves them in the transcript to be re-read on every turn after. Absent
   * means "a person did this", which is the half the model has not seen.
   */
  origin?: 'ai'
}

type RStatus = 'connecting' | 'ready' | 'error' | 'disconnected'

export type RecordingDestType = 'new' | 'saved' | 'current'

interface SessionState {
  rStatus: RStatus
  rPort: number | null
  wsConnected: boolean
  /** R's `getwd()`, kept live: the server broadcasts it whenever it moves. */
  workingDir: string | null
  /** `path.expand("~")`, so the display can shorten the home prefix. */
  homeDir: string | null
  consoleHistory: ConsoleEntry[]
  /** The environment the console evaluates in — `.GlobalEnv` unless the user
   *  asked to work inside one of their own. See `src/lib/working-env.ts`. */
  workingEnv: string
  consoleInputHistory: string[]
  isExecuting: boolean
  executingStartTime: number | null
  isRecording: boolean
  recordingTargetTabId: string | null
  recordingDestType: RecordingDestType | null
  recordingReturnOutput: boolean

  setRStatus: (status: RStatus) => void
  setRPort: (port: number | null) => void
  setWsConnected: (connected: boolean) => void
  setWorkingDir: (path: string | null, home?: string | null) => void
  setWorkingEnv: (name: string) => void
  setExecuting: (v: boolean) => void
  addConsoleEntry: (type: ConsoleEntry['type'], text: string, origin?: 'ai') => void
  clearConsole: () => void
  addInputHistory: (code: string) => void
  startRecording: (targetTabId: string, destType: RecordingDestType, returnOutput: boolean) => void
  stopRecording: () => { destType: RecordingDestType | null; targetTabId: string | null }
}

let entryId = 0

export const useSessionStore = create<SessionState>((set, get) => ({
  rStatus: 'connecting',
  rPort: null,
  wsConnected: false,
  workingDir: null,
  homeDir: null,
  consoleHistory: [],
  workingEnv: '.GlobalEnv',
  consoleInputHistory: [],
  isExecuting: false,
  executingStartTime: null,
  isRecording: false,
  recordingTargetTabId: null,
  recordingDestType: null,
  recordingReturnOutput: false,

  setRStatus: (rStatus) => set({ rStatus }),
  setRPort: (rPort) => set({ rPort }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setWorkingDir: (workingDir, home) =>
    set(home === undefined ? { workingDir } : { workingDir, homeDir: home }),
  setWorkingEnv: (workingEnv) => set({ workingEnv }),
  setExecuting: (v) => set(v
    ? { isExecuting: true, executingStartTime: Date.now() }
    : { isExecuting: false, executingStartTime: null }
  ),

  addConsoleEntry: (type, text, origin) =>
    set((state) => ({
      consoleHistory: [
        ...state.consoleHistory,
        { id: String(entryId++), type, text, timestamp: Date.now(), ...(origin ? { origin } : {}) }
      ]
    })),

  clearConsole: () => set({ consoleHistory: [] }),

  addInputHistory: (code) =>
    set((state) => ({
      consoleInputHistory: [...state.consoleInputHistory, code]
    })),

  startRecording: (targetTabId, destType, returnOutput) =>
    set({ isRecording: true, recordingTargetTabId: targetTabId, recordingDestType: destType, recordingReturnOutput: returnOutput }),

  stopRecording: () => {
    const { recordingDestType, recordingTargetTabId } = get()
    set({ isRecording: false, recordingTargetTabId: null, recordingDestType: null, recordingReturnOutput: false })
    return { destType: recordingDestType, targetTabId: recordingTargetTabId }
  },
}))
