// What the Plugin Store dialog is looking at.
//
// Lifted out of the component for the reason `src/store/ui.ts` documents: the
// moment anything outside a component needs to read or set its state, a
// `useState` is the wrong home. Here that is the update badge — the Plugin
// Manager shows it, the store dialog acts on it, and the poll that fills it
// runs once at startup and belongs to neither.

import { create } from 'zustand'
import type { StoreCategory, StoreListing, StoreSort, StoreUpdate } from '@/lib/plugin-store/types'

interface PluginStoreState {
  /** Filters. Held here rather than in the component so a deep link — "open
   *  the store on the raster connectors" — has somewhere to land. */
  query: string
  category: string | null
  sort: StoreSort

  categories: StoreCategory[]
  listings: StoreListing[]
  loading: boolean
  error: string | null

  /** The slug whose detail pane is open, or null for the empty state. */
  selected: string | null

  /**
   * Available updates, by slug. Filled by one batched poll rather than a
   * request per plugin — a user with a dozen store plugins would otherwise
   * open a dozen connections on every launch.
   */
  updates: Record<string, StoreUpdate>

  setQuery: (query: string) => void
  setCategory: (category: string | null) => void
  setSort: (sort: StoreSort) => void
  setCategories: (categories: StoreCategory[]) => void
  setListings: (listings: StoreListing[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  select: (slug: string | null) => void
  setUpdates: (updates: StoreUpdate[]) => void
  clearUpdate: (slug: string) => void
}

export const usePluginStoreBrowser = create<PluginStoreState>((set) => ({
  query: '',
  category: null,
  sort: 'popular',
  categories: [],
  listings: [],
  loading: false,
  error: null,
  selected: null,
  updates: {},

  setQuery: (query) => set({ query }),
  setCategory: (category) => set({ category }),
  setSort: (sort) => set({ sort }),
  setCategories: (categories) => set({ categories }),
  setListings: (listings) => set({ listings }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  select: (selected) => set({ selected }),

  setUpdates: (list) => set({
    updates: Object.fromEntries(list.map((u) => [u.slug, u])),
  }),

  clearUpdate: (slug) => set((s) => {
    const next = { ...s.updates }
    delete next[slug]
    return { updates: next }
  }),
}))

/**
 * Whether one installed plugin has a newer approved version.
 *
 * A helper rather than a selector, because the answer needs the version the
 * user HAS, which lives on the plugin and not in this store — and comparing
 * strings for equality is right where comparing them for order would not be:
 * the store's newest approved version is the target whether it sorts above the
 * installed one or not. An author who yanks 2.0 and re-approves 1.9 means it.
 */
export function hasUpdate(update: StoreUpdate | undefined, installedVersion: string): boolean {
  return Boolean(update?.latestVersion) && update!.latestVersion !== installedVersion
}

/** A version the user has that the store has since withdrawn. */
export function isRevoked(update: StoreUpdate | undefined): boolean {
  return update?.installedStatus === 'revoked'
}
