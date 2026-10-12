import { create } from 'zustand'
import { useProjectStore } from './project'
import { useContextStore } from './context'
import { useSessionStore } from './session'
import { validateColumnDisclosure } from '@/lib/context/column-disclosure'
import { validateColumnPolicy } from '@/lib/context/column-policy'

interface ColumnDisclosureState {
  workspaceEpoch: number
  selections: Record<string, string[]>
  revision: number
  loaded: boolean
  error: string
  setColumns: (sourceId: string, columns: string[]) => void
  hydrate: (lease: string) => Promise<void>
}
let writes = Promise.resolve()
let generation = 0

/** Only encrypted profile-local policies can authorise a saved project's reads.
 * A failed load/write blocks disclosure; importing a bundle grants no policy. */
export const useColumnDisclosureStore = create<ColumnDisclosureState>((set, get) => ({
  workspaceEpoch: -1, selections: {}, revision: 0, loaded: true, error: '',
  hydrate: async lease => {
    const project = useProjectStore.getState(), current = ++generation
    if (!project.path || !project.projectId) { set({ workspaceEpoch: project.workspaceEpoch, loaded: true, error: '' }); return }
    set({ loaded: false, error: '' })
    try {
      const snapshot = validateColumnPolicy(await window.electronAPI.context.columnPolicies(lease))
      if (current !== generation || useProjectStore.getState().workspaceEpoch !== project.workspaceEpoch || useProjectStore.getState().projectId !== project.projectId) return
      set({ ...snapshot, workspaceEpoch: project.workspaceEpoch, loaded: true })
    } catch (failure) {
      if (current === generation && useProjectStore.getState().workspaceEpoch === project.workspaceEpoch) set({ loaded: false, error: `Column privacy settings could not be loaded: ${String(failure)}. Retry after protected storage becomes available.` })
    }
  },
  setColumns: (sourceId, columns) => {
    const selection = validateColumnDisclosure(sourceId, columns)
    const project = useProjectStore.getState(), saved = !!(project.path && project.projectId)
    if (saved && !get().loaded) throw new Error('Column privacy settings are unavailable. Reload them before editing.')
    const selections = get().workspaceEpoch === project.workspaceEpoch ? { ...get().selections } : {}
    if (selection.columns.length && !selections[sourceId] && Object.keys(selections).length >= 1000) throw new Error('Column privacy covers at most 1,000 objects. Remove an older selection before adding another.')
    if (selection.columns.length) selections[sourceId] = selection.columns
    else delete selections[sourceId]
    set({ workspaceEpoch: project.workspaceEpoch, selections })
    useContextStore.getState().revokeDelivery()
    useSessionStore.getState().addConsoleEntry('info', `Context privacy: ${selection.columns.length} column metadata exclusions for one workspace object.`)
    if (!saved) return
    const lease = useContextStore.getState().projectLease, current = generation
    // Serial writes prevent a slower earlier edit from restoring excluded names.
    set({ loaded: false })
    writes = writes.then(async () => {
      if (current !== generation || useProjectStore.getState().workspaceEpoch !== project.workspaceEpoch) return
      if (!lease) throw new Error('The current project lease is unavailable. Reload column privacy settings.')
      const snapshot = validateColumnPolicy(await window.electronAPI.context.saveColumnPolicies(get().revision, selections, lease))
      if (current !== generation || useProjectStore.getState().workspaceEpoch !== project.workspaceEpoch) return
      set({ revision: snapshot.revision, loaded: true, error: '' })
    }).catch(failure => {
      if (current === generation && useProjectStore.getState().workspaceEpoch === project.workspaceEpoch) set({ loaded: false, error: `Column privacy settings could not be saved: ${String(failure)}. Reload them before using workspace context.` })
    })
  },
}))

export function columnExclusions(sourceId: string): string[] {
  const state = useColumnDisclosureStore.getState(), project = useProjectStore.getState()
  if (project.path && project.projectId && !state.loaded) throw new Error('SOURCE_UNAVAILABLE: column privacy settings are unavailable. Reload protected settings before reading workspace context.')
  return state.workspaceEpoch === project.workspaceEpoch ? state.selections[sourceId] ?? [] : []
}

export function hasColumnExclusions(): boolean {
  const state = useColumnDisclosureStore.getState(), project = useProjectStore.getState()
  return !!(project.path && project.projectId && !state.loaded) || state.workspaceEpoch === project.workspaceEpoch && Object.keys(state.selections).length > 0
}

useProjectStore.subscribe((state, previous) => {
  if (state.workspaceEpoch !== previous.workspaceEpoch || state.projectId !== previous.projectId) {
    generation++
    useColumnDisclosureStore.setState({ workspaceEpoch: state.workspaceEpoch, selections: {}, revision: 0, loaded: !(state.path && state.projectId), error: '' })
  }
})
