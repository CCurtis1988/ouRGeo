import { create } from 'zustand'
import { THEMES, applyTheme } from '@/lib/themes'
import { saveTheme, saveUiScale } from '@/lib/theme-persistence'
import { useBasemapStore } from './basemap'

const UI_SCALE_MIN = 0.5
const UI_SCALE_MAX = 2.0
const UI_SCALE_STEP = 0.1

export function applyUiScale(scale: number): void {
  document.documentElement.style.fontSize = `${16 * scale}px`
}

interface ThemeState {
  current: string
  monacoTheme: string
  uiScale: number
  setTheme: (id: string) => void
  zoomIn: () => void
  zoomOut: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  current: 'dark',
  monacoTheme: 'ourgeo-dark',
  uiScale: 1.0,
  setTheme: (id) => {
    const t = THEMES[id] ?? THEMES.dark
    applyTheme(id)
    saveTheme(id)
    set({ current: id, monacoTheme: t.monacoTheme })
    useBasemapStore.getState().setOverride(null)
  },
  zoomIn: () => {
    const next = Math.min(UI_SCALE_MAX, parseFloat((get().uiScale + UI_SCALE_STEP).toFixed(2)))
    applyUiScale(next)
    saveUiScale(next)
    set({ uiScale: next })
  },
  zoomOut: () => {
    const next = Math.max(UI_SCALE_MIN, parseFloat((get().uiScale - UI_SCALE_STEP).toFixed(2)))
    applyUiScale(next)
    saveUiScale(next)
    set({ uiScale: next })
  },
}))
