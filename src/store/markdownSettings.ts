import { create } from 'zustand'

/**
 * Which generator the R Markdown map chunks use.
 *
 * `auto` follows whichever "Export to …" dialog the Spatial Editor was last
 * opened with (`spatialSettings.lastExportMode`), so a user who works in ggplot
 * gets ggplot chunks without changing a setting. `tmap` is the default because
 * tmap's output needs no extra scale plumbing to look like the map on screen.
 */
export type MapChunkEngine = 'tmap' | 'ggplot' | 'auto'

interface MarkdownSettingsState {
  mapChunkEngine: MapChunkEngine
  setMapChunkEngine: (v: MapChunkEngine) => void
}

export const useMarkdownSettingsStore = create<MarkdownSettingsState>((set) => ({
  mapChunkEngine: 'tmap',
  setMapChunkEngine: (mapChunkEngine) => set({ mapChunkEngine }),
}))
