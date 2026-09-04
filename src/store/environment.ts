import { create } from 'zustand'
import type { REnvironmentInfo } from '@/lib/r-client'
import { DEFAULT_PLACEMENT, type EnvPlacement, type EnvPlacements } from '@/lib/environments'
import { saveEnvironmentPreferences } from '@/lib/environment-preferences'
import { pruneWorkingEnv } from '@/lib/working-env'

interface EnvironmentState {
  environments: REnvironmentInfo[]
  isLoading: boolean
  error: string | null
  searchQuery: string
  isOpen: boolean
  userFilterActive: boolean
  rdataLoadedNames: Record<string, string[]>  // envName → rdata-loaded object names
  /** ouRGeo's own objects in .GlobalEnv — the server's source()d functions,
   *  from /session/init. Held apart from `rdataLoadedNames` (which mixes them
   *  with objects the user loaded from a file) because Export has to exclude
   *  exactly these and nothing else. */
  systemNames: string[]
  /** How each of the user's environments is listed — see `EnvPlacement`.
   *  Sparse: an environment absent from here is at the default. */
  envPlacement: EnvPlacements

  setEnvironments: (envs: REnvironmentInfo[]) => void
  mergeEnvironment: (env: REnvironmentInfo) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setSearchQuery: (query: string) => void
  toggleOpen: () => void
  setUserFilterActive: (v: boolean) => void
  addRdataLoadedNames: (envName: string, names: string[]) => void
  setSystemNames: (names: string[]) => void
  setEnvPlacement: (name: string, placement: EnvPlacement) => void
  setEnvPlacements: (placements: EnvPlacements) => void
}

export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  environments: [],
  isLoading: false,
  error: null,
  searchQuery: '',
  isOpen: false,
  userFilterActive: true,
  rdataLoadedNames: {},
  systemNames: [],
  envPlacement: {},

  // Every path that re-reads the session goes through here — the panel's
  // refresh, an AI action, a project load — which makes it the one place that
  // can notice the environment the console was working in has been removed.
  setEnvironments: (environments) => {
    pruneWorkingEnv(environments.map((e) => e.name)
      .concat(environments.flatMap((e) =>
        e.objects.filter((o) => o.isEnvironment).map((o) => o.name))))
    return set({ environments })
  },
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
  setSystemNames: (systemNames) => set({ systemNames }),
  setEnvPlacements: (envPlacement) => set({ envPlacement }),
  // The choice persists: an environment name outlives the session it was made
  // in (open the same project tomorrow and `scratch` is `scratch` again), so a
  // panel that forgot where the user put it would ask them again every launch.
  setEnvPlacement: (name, placement) => set((s) => {
    const envPlacement = { ...s.envPlacement }
    if (placement === DEFAULT_PLACEMENT) delete envPlacement[name]
    else envPlacement[name] = placement
    void saveEnvironmentPreferences({ envPlacement })
    return { envPlacement }
  }),
  addRdataLoadedNames: (envName, names) => set((s) => ({
    rdataLoadedNames: {
      ...s.rdataLoadedNames,
      [envName]: [...new Set([...(s.rdataLoadedNames[envName] ?? []), ...names])]
    }
  })),
}))
