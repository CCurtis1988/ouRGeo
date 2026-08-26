import { create } from 'zustand'

export interface ConsoleEntry {
  id: string
  type: 'input' | 'output' | 'error' | 'info'
  text: string
  timestamp: number
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
  setExecuting: (v: boolean) => void
  addConsoleEntry: (type: ConsoleEntry['type'], text: string) => void
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
  setExecuting: (v) => set(v
    ? { isExecuting: true, executingStartTime: Date.now() }
    : { isExecuting: false, executingStartTime: null }
  ),

  addConsoleEntry: (type, text) =>
    set((state) => ({
      consoleHistory: [
        ...state.consoleHistory,
        { id: String(entryId++), type, text, timestamp: Date.now() }
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
