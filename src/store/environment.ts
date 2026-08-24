import { create } from 'zustand'
import type { REnvironmentInfo } from '@/lib/r-client'

interface EnvironmentState {
  environments: REnvironmentInfo[]
  isLoading: boolean
  error: string | null
  searchQuery: string
  isOpen: boolean
  userFilterActive: boolean
  rdataLoadedNames: Record<string, string[]>  // envName → rdata-loaded object names

  setEnvironments: (envs: REnvironmentInfo[]) => void
  mergeEnvironment: (env: REnvironmentInfo) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setSearchQuery: (query: string) => void
  toggleOpen: () => void
  setUserFilterActive: (v: boolean) => void
  addRdataLoadedNames: (envName: string, names: string[]) => void
}

export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  environments: [],
  isLoading: false,
  error: null,
  searchQuery: '',
  isOpen: false,
  userFilterActive: true,
  rdataLoadedNames: {},

  setEnvironments: (environments) => set({ environments }),
  // Replace a single environment entry in place (or prepend if new), producing
  // a fresh array so memoized consumers (e.g. the autocomplete index) rebuild.
  // Used by the change-detected .GlobalEnv broadcast to keep the panel and
  // completion current without re-walking the whole search path.
  mergeEnvironment: (env) => set((s) => {
    const idx = s.environments.findIndex((e) => e.name === env.name)
    if (idx === -1) return { environments: [env, ...s.environments] }
    const next = [...s.environments]
    next[idx] = env
    return { environments: next }
  }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setUserFilterActive: (userFilterActive) => set({ userFilterActive }),
  addRdataLoadedNames: (envName, names) => set((s) => ({
    rdataLoadedNames: {
      ...s.rdataLoadedNames,
      [envName]: [...new Set([...(s.rdataLoadedNames[envName] ?? []), ...names])]
    }
  })),
}))
