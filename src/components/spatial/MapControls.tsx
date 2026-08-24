import React from 'react'
import { Plus, Minus, Maximize2 } from 'lucide-react'

interface MapControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitBounds: () => void
}

export function MapControls({ onZoomIn, onZoomOut, onFitBounds }: MapControlsProps): React.ReactElement {
  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col bg-geo-panel border border-geo-border rounded-md overflow-hidden">
      <button
        onClick={onZoomIn}
        title="Zoom in"
        className="p-1.5 text-geo-muted hover:text-geo-accent hover:bg-geo-bg transition-colors"
      >
        <Plus size={14} />
      </button>
      <div className="border-t border-geo-border" />
      <button
        onClick={onZoomOut}
        title="Zoom out"
        className="p-1.5 text-geo-muted hover:text-geo-accent hover:bg-geo-bg transition-colors"
      >
        <Minus size={14} />
      </button>
      <div className="border-t border-geo-border" />
      <button
        onClick={onFitBounds}
        title="Fit to layers"
        className="p-1.5 text-geo-muted hover:text-geo-accent hover:bg-geo-bg transition-colors"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  )
}
