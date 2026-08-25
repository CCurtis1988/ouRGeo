import { createJsonFileStore } from '@/lib/persistence'
import type { MapChunkEngine } from '@/store/markdownSettings'

const store = createJsonFileStore('markdown-settings.json', 'Markdown Settings')

export interface MarkdownSettings {
  mapChunkEngine: MapChunkEngine
}

const DEFAULTS: MarkdownSettings = { mapChunkEngine: 'tmap' }

const ENGINES: MapChunkEngine[] = ['tmap', 'ggplot', 'auto']

export async function loadMarkdownSettings(): Promise<MarkdownSettings> {
  const data = await store.read<{ mapChunkEngine?: unknown }>()
  const engine = data.mapChunkEngine
  return {
    mapChunkEngine: ENGINES.includes(engine as MapChunkEngine)
      ? (engine as MapChunkEngine)
      : DEFAULTS.mapChunkEngine,
  }
}

export async function saveMarkdownSettings(patch: Partial<MarkdownSettings>): Promise<void> {
  await store.merge(patch as Record<string, unknown>)
}
