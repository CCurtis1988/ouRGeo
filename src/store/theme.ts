import { create } from 'zustand'
import { THEMES, applyTheme } from '@/lib/themes'
import { applyEditorTheme } from '@/lib/editor-themes'
import { saveTheme, saveUiScale, saveCodeTheme, saveMarkdownTheme } from '@/lib/theme-persistence'
import { useBasemapStore } from './basemap'

const UI_SCALE_MIN = 0.5
const UI_SCALE_MAX = 2.0
const UI_SCALE_STEP = 0.1

export function applyUiScale(scale: number): void {
  document.documentElement.style.fontSize = `${16 * scale}px`
}

interface ThemeState {
  current: string
  /** Concrete ids, never null — `setTheme` writes the app theme's defaults. */
  codeTheme: string
  markdownTheme: string
  uiScale: number
  /**
   * Bumped whenever a theme's CONTENTS change under a stable id — which is the
   * normal case while the Theme Studio is open. Nothing reads it for a value;
   * it exists so effects keyed on `[current, codeTheme, markdownTheme]` (most
   * importantly Monaco's `defineTheme` in `CodeEditor`) have a fourth
   * dependency that moves when an edit lands. The studio commits on a debounce
   * so this stays a slow signal — see the note on that effect for why a
   * fast-changing dependency there would be a leak.
   */
  revision: number
  setTheme: (id: string) => void
  setCodeTheme: (id: string) => void
  setMarkdownTheme: (id: string) => void
  /** Re-apply the active themes from the registries and bump `revision`.
   *  Called by `useCustomThemeStore` after any edit to a user theme. */
  refresh: () => void
  zoomIn: () => void
  zoomOut: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  current: 'dark',
  codeTheme: 'dark',
  markdownTheme: 'dark',
  uiScale: 1.0,
  revision: 0,
  setTheme: (id) => {
    const t = THEMES[id] ?? THEMES.dark
    // Resolve through the registry, then persist what we RESOLVED to. A user
    // theme deleted in one window (or an id from an older config) must not be
    // written back to theme.json for the next launch to fail on again.
    id = t.id
    // Switching the app theme RESETS the editor themes to that theme's
    // defaults. Deliberate: an app theme is a coherent look, and carrying a
    // dark syntax palette onto a white background is not one. The editor
    // pickers are how you depart from the default, per app theme.
    const codeTheme = t.defaultCodeTheme
    const markdownTheme = t.defaultMarkdownTheme
    applyTheme(id)
    applyEditorTheme(id, codeTheme, markdownTheme)
    saveTheme(id)
    saveCodeTheme(codeTheme)
    saveMarkdownTheme(markdownTheme)
    set({ current: id, codeTheme, markdownTheme })
    useBasemapStore.getState().setOverride(null)
  },
  setCodeTheme: (id) => {
    applyEditorTheme(get().current, id, get().markdownTheme)
    saveCodeTheme(id)
    set({ codeTheme: id })
  },
  setMarkdownTheme: (id) => {
    applyEditorTheme(get().current, get().codeTheme, id)
    saveMarkdownTheme(id)
    set({ markdownTheme: id })
  },
  refresh: () => {
    const { current, codeTheme, markdownTheme, revision } = get()
    applyTheme(current)
    applyEditorTheme(current, codeTheme, markdownTheme)
    set({ revision: revision + 1 })
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
