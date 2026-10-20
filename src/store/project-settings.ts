import { create } from 'zustand'
import { createJsonFileStore } from '@/lib/persistence'

// Settings → Projects (docs/project-persistence-spec.md §4.2). Device
// preferences, kept across sessions and never inside a project: how this
// computer treats unsaved work is not something a bundle from someone else
// should change.

export type CloseBehavior = 'keep' | 'save' | 'ask'
/** Seconds of R idle time before a checkpoint; 0 = only when closing or switching. */
export type CheckpointInterval = number

export const CHECKPOINT_CHOICES: { value: CheckpointInterval; label: string }[] = [
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 0, label: 'Only when closing or switching' },
]
export const DEFAULT_CHECKPOINT_INTERVAL = 30

const store = createJsonFileStore('project-settings.json', 'Project Settings')

interface ProjectSettingsState {
  closeBehavior: CloseBehavior
  checkpointInterval: CheckpointInterval
  saveDocumentsWithProject: boolean
  loaded: boolean
  setCloseBehavior: (value: CloseBehavior) => void
  setCheckpointInterval: (value: CheckpointInterval) => void
  setSaveDocumentsWithProject: (value: boolean) => void
}

/** The interval is a choice from a list, and an out-of-range value in the file
 *  (hand-edited, or from a future version) falls back to the default rather
 *  than checkpointing every second or never. */
export function normaliseInterval(value: unknown): CheckpointInterval {
  if (value === 0) return 0
  return typeof value === 'number' && Number.isFinite(value) && value >= 10 && value <= 1800 ? Math.round(value) : DEFAULT_CHECKPOINT_INTERVAL
}

export const useProjectSettingsStore = create<ProjectSettingsState>((set) => ({
  closeBehavior: 'keep',
  checkpointInterval: DEFAULT_CHECKPOINT_INTERVAL,
  saveDocumentsWithProject: false,
  loaded: false,
  setCloseBehavior: (closeBehavior) => { set({ closeBehavior }); void store.merge({ closeBehavior }) },
  setCheckpointInterval: (value) => { const checkpointInterval = normaliseInterval(value); set({ checkpointInterval }); void store.merge({ checkpointInterval }) },
  setSaveDocumentsWithProject: (saveDocumentsWithProject) => { set({ saveDocumentsWithProject }); void store.merge({ saveDocumentsWithProject }) },
}))

let loading: Promise<void> | null = null
export function loadProjectSettings(): Promise<void> {
  loading ??= store.read<Record<string, unknown>>().then(data => {
    useProjectSettingsStore.setState({
      closeBehavior: data.closeBehavior === 'save' || data.closeBehavior === 'ask' ? data.closeBehavior : 'keep',
      checkpointInterval: normaliseInterval(data.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL),
      saveDocumentsWithProject: data.saveDocumentsWithProject === true,
      loaded: true,
    })
  }, () => { useProjectSettingsStore.setState({ loaded: true }) })
  return loading
}
