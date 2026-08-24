import { create } from 'zustand'
import { saveBasemap } from '@/lib/basemap-persistence'

interface BasemapState {
  overrideBasemapId: string | null
  setOverride: (id: string | null) => void
}

export const useBasemapStore = create<BasemapState>((set) => ({
  overrideBasemapId: null,
  setOverride: (id) => {
    set({ overrideBasemapId: id })
    saveBasemap(id)
  },
}))
