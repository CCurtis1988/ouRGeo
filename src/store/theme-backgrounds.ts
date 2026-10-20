import { create } from 'zustand'
import { createJsonFileStore, getDataPath } from '@/lib/persistence'
import { clampBackgroundInterval, clampImageStrength, getThemeBackgroundPreferences, normaliseBackgroundSelection, type ThemeBackgroundPreferencesMap } from '@/lib/theme-backgrounds'
import type { ThemeImageFolder } from '@/lib/theme-backgrounds-types'
import { useSessionStore } from '@/store/session'
import { THEMES } from '@/lib/themes'

interface SavedBackgrounds { version: 1; preferences: ThemeBackgroundPreferencesMap }
interface ThemeBackgroundState {
  initialized: boolean
  preferences: ThemeBackgroundPreferencesMap
  strengthPreview: Record<string, number>
  error: string | null
  folders: ThemeImageFolder[]
  foldersLoading: boolean
  folderError: string | null
  folderRevision: number
  init: () => Promise<void>
  setSelection: (themeId: string, ids: readonly string[]) => Promise<void>
  toggleImage: (themeId: string, id: string) => Promise<void>
  setInterval: (themeId: string, seconds: number) => Promise<void>
  previewStrength: (themeId: string, strength: number) => void
  setImageStrength: (themeId: string, strength: number | null) => Promise<void>
  reset: (themeId: string) => Promise<void>
  resetAll: () => Promise<void>
  refreshFolders: () => Promise<void>
  linkFolder: (themeId: string) => Promise<ThemeImageFolder | null>
  rescanFolder: (id: string) => Promise<ThemeImageFolder>
  relinkFolder: (id: string) => Promise<ThemeImageFolder | null>
  forgetFolder: (id: string) => Promise<void>
}
const file = createJsonFileStore('theme-backgrounds.json', 'Theme backgrounds')
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
let queue = Promise.resolve()
let initializing: Promise<void> | undefined
const serial = (task: () => Promise<void>): Promise<void> => {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

async function readPreferences(allowMissing = true): Promise<SavedBackgrounds> {
  let contents: string
  try { contents = await window.electronAPI.file.read(`${await getDataPath()}/theme-backgrounds.json`) }
  catch (error) {
    if (allowMissing && /\bENOENT\b/.test(errorMessage(error))) return { version: 1, preferences: {} }
    throw new Error(`Cannot read background settings: ${errorMessage(error)}. Retry or reset background choices in Appearance.`)
  }
  let parsed: unknown
  try { parsed = JSON.parse(contents) }
  catch { throw new Error('Background settings are damaged. Retry or reset background choices in Appearance.') }
  const value = parsed as Partial<SavedBackgrounds> | null
  if (!value || value.version !== 1 || !value.preferences || typeof value.preferences !== 'object' || Array.isArray(value.preferences)) {
    throw new Error('Background settings are invalid. Retry or reset background choices in Appearance.')
  }
  const preferences: ThemeBackgroundPreferencesMap = Object.create(null)
  for (const [id, saved] of Object.entries(value.preferences)) {
    if (!id || id.length > 256 || !saved || !Array.isArray(saved.selectedIds) || !saved.selectedIds.every(item => typeof item === 'string') || typeof saved.intervalSeconds !== 'number') {
      throw new Error('Background settings contain an invalid selection. Reset background choices in Appearance to recover.')
    }
    if (saved.imageStrength !== undefined && (typeof saved.imageStrength !== 'number' || !Number.isFinite(saved.imageStrength))) {
      throw new Error('Background settings contain invalid image visibility. Reset background choices in Appearance to recover.')
    }
    preferences[id] = { selectedIds: normaliseBackgroundSelection(saved.selectedIds), intervalSeconds: clampBackgroundInterval(saved.intervalSeconds), ...(saved.imageStrength === undefined ? {} : { imageStrength: clampImageStrength(saved.imageStrength) }) }
  }
  return { version: 1, preferences }
}

async function persist(preferences: ThemeBackgroundPreferencesMap): Promise<void> {
  const next: SavedBackgrounds = { version: 1, preferences }
  await file.write(next)
  // The shared writer logs errors instead of rejecting. Read-back lets the
  // gallery explain a full disk without pretending a choice was remembered.
  if (JSON.stringify(await readPreferences(false)) !== JSON.stringify(next)) {
    throw new Error('Background choices could not be saved. Check disk space and permissions, then retry.')
  }
}

export const useThemeBackgroundStore = create<ThemeBackgroundState>((set, get) => {
  const commit = async (change: (current: ThemeBackgroundPreferencesMap) => ThemeBackgroundPreferencesMap): Promise<void> => {
    await get().init()
    return serial(async () => {
      try { const preferences = change(get().preferences); await persist(preferences); set({ preferences, error: null }) }
      catch (error) { set({ error: errorMessage(error) }); throw error }
    })
  }
  let folderRefresh: Promise<void> | undefined
  let refreshAgain = false
  let folderMutation = 0
  let folderOperations = 0
  const folderOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
    folderOperations++
    set({ foldersLoading: true, folderError: null })
    try { return await operation() }
    catch (error) { set({ folderError: errorMessage(error) }); throw error }
    finally { folderOperations--; set({ foldersLoading: folderOperations > 0 }) }
  }
  return {
    initialized: false, preferences: {}, strengthPreview: {}, error: null,
    folders: [], foldersLoading: false, folderError: null, folderRevision: 0,
    init: async () => {
      if (get().initialized) return
      if (initializing) return initializing
      initializing = serial(async () => {
        try { const saved = await readPreferences(); set({ preferences: saved.preferences, initialized: true, error: null }) }
        catch (error) { set({ error: errorMessage(error) }); throw error }
      })
      try { await initializing } finally { initializing = undefined }
    },
    setSelection: (themeId, ids) => commit(current => ({ ...current, [themeId]: { ...getThemeBackgroundPreferences(themeId, current), selectedIds: normaliseBackgroundSelection(ids) } })),
    toggleImage: (themeId, id) => commit(current => {
      const preference = getThemeBackgroundPreferences(themeId, current)
      const selected = preference.selectedIds.includes(id) ? preference.selectedIds.filter(value => value !== id) : [...preference.selectedIds, id]
      return { ...current, [themeId]: { ...preference, selectedIds: selected.length ? selected : preference.selectedIds } }
    }),
    setInterval: (themeId, seconds) => commit(current => ({ ...current, [themeId]: { ...getThemeBackgroundPreferences(themeId, current), intervalSeconds: clampBackgroundInterval(seconds) } })),
    previewStrength: (themeId, strength) => set(state => ({ strengthPreview: { ...state.strengthPreview, [themeId]: clampImageStrength(strength) } })),
    setImageStrength: async (themeId, strength) => {
      const value = strength === null ? null : clampImageStrength(strength)
      const preview = get().strengthPreview[themeId]
      try {
        await commit(current => {
          const preference = { ...getThemeBackgroundPreferences(themeId, current) }
          if (value === null) delete preference.imageStrength
          else preference.imageStrength = value
          return { ...current, [themeId]: preference }
        })
      } finally {
        // A slow save must not erase a newer drag preview; failed writes return
        // the editor to its last saved appearance and keep the error visible.
        if (get().strengthPreview[themeId] === preview) set(state => {
          const strengthPreview = { ...state.strengthPreview }
          delete strengthPreview[themeId]
          return { strengthPreview }
        })
      }
    },
    reset: themeId => commit(current => {
      const next = { ...current }
      const strength = next[themeId]?.imageStrength
      if (strength === undefined) delete next[themeId]
      else next[themeId] = { ...getThemeBackgroundPreferences(themeId, {}), imageStrength: strength }
      return next
    }),
    resetAll: () => serial(async () => {
      try { await persist({}); set({ initialized: true, preferences: {}, strengthPreview: {}, error: null }) }
      catch (error) { set({ error: errorMessage(error) }); throw error }
    }),
    refreshFolders: async () => {
      if (folderRefresh) { refreshAgain = true; return folderRefresh }
      folderRefresh = folderOperation(async () => {
        do {
          refreshAgain = false
          const before = folderMutation
          const folders = await window.electronAPI.themeBackgrounds.list()
          if (before === folderMutation) set({ folders, folderError: null })
          else refreshAgain = true
        } while (refreshAgain)
      })
      try { await folderRefresh } finally { folderRefresh = undefined }
    },
    linkFolder: themeId => folderOperation(async () => {
      folderMutation++
      const folder = await window.electronAPI.themeBackgrounds.link(themeId)
      folderMutation++
      if (folder) set({ folders: [...get().folders.filter(value => value.id !== folder.id), folder], folderRevision: get().folderRevision + 1 })
      if (folder) useSessionStore.getState().addConsoleEntry('info', `Linked image folder “${folder.path}” to ${THEMES[themeId]?.label ?? themeId}: ${folder.images.length} images available.${folder.warning ? ` ${folder.warning}` : ''}`)
      return folder
    }),
    rescanFolder: id => folderOperation(async () => {
      folderMutation++
      const folder = await window.electronAPI.themeBackgrounds.rescan(id)
      folderMutation++
      set({ folders: [...get().folders.filter(value => value.id !== id), folder], folderRevision: get().folderRevision + 1 })
      useSessionStore.getState().addConsoleEntry('info', `Rescanned image folder “${folder.path}”: ${folder.images.length} images available.${folder.warning ? ` ${folder.warning}` : ''}`)
      return folder
    }),
    relinkFolder: id => folderOperation(async () => {
      folderMutation++
      const folder = await window.electronAPI.themeBackgrounds.relink(id)
      folderMutation++
      if (folder) set({ folders: [...get().folders.filter(value => value.id !== id), folder], folderRevision: get().folderRevision + 1 })
      if (folder) useSessionStore.getState().addConsoleEntry('info', `Located image folder “${folder.path}”: ${folder.images.length} images available.${folder.warning ? ` ${folder.warning}` : ''}`)
      return folder
    }),
    forgetFolder: id => folderOperation(async () => {
      const folder = get().folders.find(value => value.id === id)
      folderMutation++
      await window.electronAPI.themeBackgrounds.forget(id)
      folderMutation++
      set({ folders: get().folders.filter(value => value.id !== id), folderRevision: get().folderRevision + 1 })
      useSessionStore.getState().addConsoleEntry('info', `Forgot image folder${folder ? ` “${folder.path}”` : ''}. Original files remain on disk.`)
      // Missing files retain their choices for relinking. Explicitly forgetting
      // a folder revokes those choices too, including files missing at scan time.
      await commit(current => Object.fromEntries(Object.entries(current).map(([themeId, preference]) => [themeId, {
        ...preference, selectedIds: normaliseBackgroundSelection(preference.selectedIds.filter(value => !value.startsWith(`folder:${id}:`))),
      }])))
    }),
  }
})
