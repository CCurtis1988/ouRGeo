import { create } from 'zustand'
import { rClient, type RLibrary } from '@/lib/r-client'

interface PackagesState {
  libraries: RLibrary[]
  isLoading: boolean
  error: string | null
  searchQuery: string
  isOpen: boolean
  loadingPackages: Set<string>

  setLibraries: (libs: RLibrary[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setSearchQuery: (query: string) => void
  toggleOpen: () => void
  addLoadingPackage: (name: string) => void
  removeLoadingPackage: (name: string) => void
  refreshPackages: () => Promise<void>
}

export const usePackagesStore = create<PackagesState>((set) => ({
  libraries: [],
  isLoading: false,
  error: null,
  searchQuery: '',
  isOpen: false,
  loadingPackages: new Set(),

  setLibraries: (libraries) => set({ libraries }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  addLoadingPackage: (name) =>
    set((s) => ({ loadingPackages: new Set(s.loadingPackages).add(name) })),

  removeLoadingPackage: (name) =>
    set((s) => {
      const next = new Set(s.loadingPackages)
      next.delete(name)
      return { loadingPackages: next }
    }),

  refreshPackages: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await rClient.listPackages()
      if (res.success) set({ libraries: res.libraries })
      else set({ error: res.error ?? 'Failed to load packages' })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load packages' })
    } finally {
      set({ isLoading: false })
    }
  }
}))
