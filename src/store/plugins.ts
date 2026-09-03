// What the renderer knows about installed plugins.
//
// The contribution registries (actions, connectors, toolbox tools, themes) are
// plain mutable objects whose identity never changes — that is deliberate, so
// the forty-odd `THEMES[id]`-style lookups scattered through the app keep
// working — but it means React cannot subscribe to one. A component that read
// `actionList()` at render time would never re-render when a plugin was
// enabled, because nothing it depends on changed.
//
// So this store carries the change signal. `revision` is bumped once per
// registration pass; anything that renders a registry reads it and re-renders.
// It is the same device `useThemeStore.revision` uses for the Theme Studio.

import { create } from 'zustand'

/** How a plugin ended up in whatever state it is in. */
export type PluginStatus = 'enabled' | 'disabled' | 'error'

export interface PluginSummary {
  id: string
  name: string
  version: string
  status: PluginStatus
  /** Present when `status === 'error'` — shown in full in the Plugin Manager,
   *  because a truncated stack is a bug report nobody can act on. */
  error?: string
}

interface PluginState {
  plugins: PluginSummary[]
  /** Bumped after every registration pass. Read it to re-render a registry. */
  revision: number

  setPlugins: (plugins: PluginSummary[]) => void
  /** Call once after a full pass of `registerPlugin*`, never per registration —
   *  a bump per contribution would re-render the app N times for one reload. */
  bumpRevision: () => void
}

export const usePluginStore = create<PluginState>((set) => ({
  plugins: [],
  revision: 0,

  setPlugins: (plugins) => set({ plugins }),
  bumpRevision: () => set((s) => ({ revision: s.revision + 1 })),
}))

/** The revision, for a component that renders a live registry. Subscribing to
 *  this is what makes `actionList()` / `providerList()` / `categoryList()`
 *  honest inside React. */
export function usePluginRevision(): number {
  return usePluginStore((s) => s.revision)
}
