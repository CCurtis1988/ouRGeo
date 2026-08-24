import { create } from 'zustand'

// A project is a portable `.ourgeoproj` bundle (R env snapshot + ouRGeo UI
// state). The special "scratch" project (path === null) is the workspace ouRGeo
// always launches into: a clean R env every time, with only its code/scratch
// tabs persisted via session.json. It is never savable in place (Save is
// disabled and closing it never prompts) — use Save As to spin off a real
// project, or the Environment panel to save just the env.

export const SCRATCH_PROJECT_NAME = 'scratch'
const MAX_RECENTS = 5

export interface RecentProject {
  name: string
  path: string
}

interface ProjectState {
  /** Display name of the current project ("scratch" or the bundle's base name). */
  name: string
  /** Absolute path to the `.ourgeoproj` bundle, or null for the scratch project. */
  path: string | null
  /** True when env / UI state has changed since the last save. */
  isDirty: boolean
  recents: RecentProject[]

  setCurrent: (name: string, path: string | null) => void
  markDirty: () => void
  clearDirty: () => void
  setRecents: (recents: RecentProject[]) => void
  /** Add/promote a project to the front of the recents list (capped, deduped). */
  pushRecent: (project: RecentProject) => RecentProject[]
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  name: SCRATCH_PROJECT_NAME,
  path: null,
  isDirty: false,
  recents: [],

  setCurrent: (name, path) => set({ name, path }),
  markDirty: () => set((s) => (s.isDirty ? s : { isDirty: true })),
  clearDirty: () => set((s) => (s.isDirty ? { isDirty: false } : s)),
  setRecents: (recents) => set({ recents: recents.slice(0, MAX_RECENTS) }),

  pushRecent: (project) => {
    const deduped = get().recents.filter((r) => r.path !== project.path)
    const recents = [project, ...deduped].slice(0, MAX_RECENTS)
    set({ recents })
    return recents
  },
}))
