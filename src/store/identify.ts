import { create } from 'zustand'
import type { IdentifyTarget } from '@/lib/identify-targets'

export interface IdentifyState {
  targets: IdentifyTarget[]
  index: number
  anchor: { x: number; y: number } // map-container-relative px
  lngLat: { lng: number; lat: number } // for raster pixel extract
}

interface IdentifyStore {
  identify: IdentifyState | null
  openIdentify: (state: IdentifyState) => void
  closeIdentify: () => void
  setIdentifyIndex: (i: number) => void
}

export const useIdentifyStore = create<IdentifyStore>((set) => ({
  identify: null,
  openIdentify: (state) => set({ identify: state }),
  closeIdentify: () => set({ identify: null }),
  setIdentifyIndex: (i) =>
    set((s) => {
      if (!s.identify) return s
      const index = Math.max(0, Math.min(i, s.identify.targets.length - 1))
      return { identify: { ...s.identify, index } }
    }),
}))
