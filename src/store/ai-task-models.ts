import { create } from 'zustand'
import { createJsonFileStore, getDataPath } from '@/lib/persistence'
import { validateTaskModelSelection, type TaskKind, type TaskModelPreferences, type TaskModelSelection } from '@/lib/ai-task-models'

interface SavedPreferences { version: 1; selections: TaskModelPreferences; analyseOnImport: boolean }
interface AiTaskModelsState {
  initialized: boolean
  selections: TaskModelPreferences
  analyseOnImport: boolean
  revision: number
  error: string | null
  init: () => Promise<void>
  setSelection: (kind: TaskKind, selection: TaskModelSelection) => Promise<void>
  setAnalyseOnImport: (enabled: boolean) => Promise<void>
  resetSelections: () => Promise<void>
}

const defaults = (): SavedPreferences => ({ version: 1, selections: { document: null, image: null }, analyseOnImport: false })
const file = createJsonFileStore('ai-task-models.json', 'File analysis models')
let initializing: Promise<void> | undefined
let queue = Promise.resolve()
const serial = (task: () => Promise<void>): Promise<void> => {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

async function readStrict(allowMissing = true): Promise<SavedPreferences> {
  let contents: string
  try { contents = await window.electronAPI.file.read(`${await getDataPath()}/ai-task-models.json`) }
  catch (error) {
    if (allowMissing && /\bENOENT\b/.test(errorMessage(error))) return defaults()
    throw new Error(`Cannot read file analysis settings: ${errorMessage(error)}`)
  }
  let parsed: unknown
  try { parsed = JSON.parse(contents) }
  catch { throw new Error('File analysis settings are damaged. Retry or explicitly reset them in Settings.') }
  const value = parsed as Partial<SavedPreferences> | null
  if (!value || value.version !== 1 || !value.selections || (value.analyseOnImport !== undefined && typeof value.analyseOnImport !== 'boolean')) {
    throw new Error('File analysis settings are invalid. Retry or explicitly reset them in Settings.')
  }
  return { version: 1, selections: { document: validateTaskModelSelection(value.selections.document), image: validateTaskModelSelection(value.selections.image) }, analyseOnImport: value.analyseOnImport ?? false }
}

async function persist(value: SavedPreferences): Promise<void> {
  await file.write(value)
  // The shared helper logs write failures; verification makes this setting fail closed.
  const saved = await readStrict(false)
  if (JSON.stringify(saved) !== JSON.stringify(value)) throw new Error('File analysis settings could not be saved. Check available disk space and permissions, then retry.')
}

export const useAiTaskModelsStore = create<AiTaskModelsState>((set, get) => {
  const commit = async (change: (current: SavedPreferences) => SavedPreferences): Promise<void> => {
    await get().init()
    return serial(async () => {
      try {
        const current = get()
        const next = change({ version: 1, selections: current.selections, analyseOnImport: current.analyseOnImport })
        await persist(next)
        set({ ...next, error: null, revision: current.revision + 1 })
      } catch (error) { set({ error: errorMessage(error) }); throw error }
    })
  }
  return {
    initialized: false, selections: defaults().selections, analyseOnImport: false, revision: 0, error: null,
    init: async () => {
      if (get().initialized) return
      if (initializing) return initializing
      initializing = serial(async () => {
        try { const saved = await readStrict(); set({ ...saved, initialized: true, error: null, revision: get().revision + 1 }) }
        catch (error) { set({ error: errorMessage(error) }); throw error }
      })
      try { await initializing } finally { initializing = undefined }
    },
    setSelection: (kind, selection) => {
      const valid = validateTaskModelSelection(selection)
      return commit(current => ({ ...current, selections: { ...current.selections, [kind]: valid } }))
    },
    setAnalyseOnImport: enabled => commit(current => ({ ...current, analyseOnImport: enabled })),
    resetSelections: () => serial(async () => {
      try { const next = defaults(); await persist(next); set({ ...next, initialized: true, error: null, revision: get().revision + 1 }) }
      catch (error) { set({ error: errorMessage(error) }); throw error }
    }),
  }
})
