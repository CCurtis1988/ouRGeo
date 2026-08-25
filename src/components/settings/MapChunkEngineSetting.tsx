import React from 'react'
import { useMarkdownSettingsStore, type MapChunkEngine } from '@/store/markdownSettings'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { saveMarkdownSettings } from '@/lib/markdown-settings-persistence'
import { cn } from '@/lib/utils'

const OPTIONS: { id: MapChunkEngine; label: string; description: string }[] = [
  { id: 'tmap', label: 'tmap', description: 'Thematic maps — closest to what the Spatial Editor draws.' },
  { id: 'ggplot', label: 'ggplot2', description: 'geom_sf / tidyterra, for documents already built on ggplot2.' },
  {
    id: 'auto',
    label: 'Follow the export panel',
    description: 'Use whichever “Export to …” dialog you opened last.',
  },
]

/**
 * Which generator the R Markdown map chunks emit.
 *
 * The two ouRGeo chunk actions ("current map", "export current plot") generate
 * real code from the live map rather than scaffolding, so they need to know
 * which flavour to write.
 */
export function MapChunkEngineSetting(): React.ReactElement {
  const engine = useMarkdownSettingsStore((s) => s.mapChunkEngine)
  const setEngine = useMarkdownSettingsStore((s) => s.setMapChunkEngine)
  const lastExport = useSpatialSettingsStore((s) => s.lastExportMode)

  const choose = (id: MapChunkEngine): void => {
    setEngine(id)
    void saveMarkdownSettings({ mapChunkEngine: id })
  }

  return (
    <div className="flex flex-col gap-1.5">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => choose(o.id)}
          className={cn(
            'text-left rounded border px-2.5 py-1.5 transition-colors',
            engine === o.id
              ? 'border-geo-accent/50 bg-geo-accent/10'
              : 'border-geo-border bg-geo-bg hover:border-geo-muted'
          )}
        >
          <div className="text-xs text-foreground">
            {o.label}
            {o.id === 'auto' && (
              <span className="text-geo-muted"> — currently {lastExport === 'tmap' ? 'tmap' : 'ggplot2'}</span>
            )}
          </div>
          <div className="text-[11px] text-geo-muted">{o.description}</div>
        </button>
      ))}
    </div>
  )
}
