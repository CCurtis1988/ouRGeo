import React, { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown, Image, Map, BarChart2 } from 'lucide-react'
import { ExportImgDialog } from './ExportImgDialog'
import { ExportCodeDialog } from './ExportCodeDialog'
import { cn } from '@/lib/utils'

interface ExportDropdownProps {
  mapContainerRef: React.RefObject<HTMLDivElement>
}

export function ExportDropdown({ mapContainerRef }: ExportDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [imgOpen, setImgOpen] = useState(false)
  const [tmapOpen, setTmapOpen] = useState(false)
  const [ggplotOpen, setGgplotOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      <button
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-xs rounded border',
          open
            ? 'bg-geo-bg border-geo-border text-foreground'
            : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg'
        )}
        onClick={() => setOpen((v) => !v)}
        title="Export"
      >
        <Download className="w-3 h-3" />
        <span>Export</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-44 bg-geo-panel border border-geo-border rounded shadow-lg z-50 py-1">
          <button
            onClick={() => { setImgOpen(true); setOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg"
          >
            <Image className="w-3 h-3 text-geo-muted" />
            Export to IMG
          </button>
          <button
            onClick={() => { setTmapOpen(true); setOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg"
          >
            <Map className="w-3 h-3 text-geo-muted" />
            Export to Tmap
          </button>
          <button
            onClick={() => { setGgplotOpen(true); setOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg"
          >
            <BarChart2 className="w-3 h-3 text-geo-muted" />
            Export to ggplot
          </button>
        </div>
      )}

      <ExportImgDialog
        open={imgOpen}
        onClose={() => setImgOpen(false)}
        mapContainerRef={mapContainerRef}
      />
      <ExportCodeDialog
        open={tmapOpen}
        onClose={() => setTmapOpen(false)}
        mode="tmap"
        mapContainerRef={mapContainerRef}
      />
      <ExportCodeDialog
        open={ggplotOpen}
        onClose={() => setGgplotOpen(false)}
        mode="ggplot"
        mapContainerRef={mapContainerRef}
      />
    </div>
  )
}
