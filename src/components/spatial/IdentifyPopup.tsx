import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useIdentifyStore } from '@/store/identify'
import { useSpatialStore } from '@/store/spatial'
import { rClient } from '@/lib/r-client'
import { iconFor } from '@/lib/completion/icons'
import { isGeomColumn } from '@/components/editor/dataViewerShared'
import type { IdentifyTarget } from '@/lib/identify-targets'

interface Field {
  name: string
  type: string
  value: string | null
}

interface PaneData {
  loading: boolean
  error?: string
  fields?: Field[]
  gone?: boolean // layer/feature no longer present
}

/** Cache key for a target's fetched attributes. */
function targetKey(t: IdentifyTarget): string {
  return t.kind === 'vector'
    ? `v:${t.layerName}::${t.envName}#${t.featureIndex}`
    : `r:${t.layerName}::${t.envName}`
}

/**
 * Info/identify popup: one pane per feature (or raster layer) hit by an idle
 * single-click. Header pages between panes; each pane lists the row's fields
 * with a per-type glyph. Anchored at the click, rendered in the map container.
 */
export function IdentifyPopup(): React.ReactElement | null {
  const identify = useIdentifyStore((s) => s.identify)
  const closeIdentify = useIdentifyStore((s) => s.closeIdentify)
  const setIdentifyIndex = useIdentifyStore((s) => s.setIdentifyIndex)
  const layers = useSpatialStore((s) => s.layers)

  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const cacheRef = useRef<Map<string, PaneData>>(new Map())
  const [, forceRender] = useState(0)

  // Position at the click point, flipped/clamped to stay inside the map
  useLayoutEffect(() => {
    if (!identify || !ref.current) { setPos(null); return }
    const rect = ref.current.getBoundingClientRect()
    const parent = ref.current.parentElement
    const pw = parent?.clientWidth ?? window.innerWidth
    const ph = parent?.clientHeight ?? window.innerHeight
    let x = identify.anchor.x + 8
    let y = identify.anchor.y + 8
    if (x + rect.width > pw) x = Math.max(0, identify.anchor.x - rect.width - 8)
    if (y + rect.height > ph) y = Math.max(0, identify.anchor.y - rect.height - 8)
    setPos({ x, y })
  }, [identify])

  // Escape closes (canvas holds focus, so listen at window capture)
  useEffect(() => {
    if (!identify) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeIdentify()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [identify, closeIdentify])

  // Lazily fetch the active pane's data, cache by target key
  const target = identify ? identify.targets[identify.index] : null
  const lngLat = identify?.lngLat
  useEffect(() => {
    if (!target || !lngLat) return
    const key = targetKey(target)
    if (cacheRef.current.has(key)) return
    const layer = layers.find((l) => l.id === target.layerId)
    if (!layer) {
      cacheRef.current.set(key, { loading: false, gone: true })
      forceRender((n) => n + 1)
      return
    }
    cacheRef.current.set(key, { loading: true })
    forceRender((n) => n + 1)
    let cancelled = false
    const done = (data: PaneData) => {
      if (cancelled) return
      cacheRef.current.set(key, data)
      forceRender((n) => n + 1)
    }
    if (target.kind === 'vector') {
      const baseName = target.layerName.split(/[$[]/)[0]
      rClient
        .getObjectDataFrame(baseName, target.envName, target.layerName, target.featureIndex ?? 0, 1)
        .then((res) => {
          if (!res.success) return done({ loading: false, error: res.error ?? 'Failed to read row' })
          const fields: Field[] = res.columns
            .map((c, i) => ({ name: c.name, type: c.type, value: res.rows[0]?.[i] ?? null }))
            .filter((f) => !isGeomColumn(f.type))
          done({ loading: false, fields })
        })
        .catch((e) => done({ loading: false, error: String(e) }))
    } else {
      rClient
        .rasterValue(target.layerName, target.envName, lngLat.lng, lngLat.lat)
        .then((res) => {
          if (!res.success) return done({ loading: false, error: res.error ?? 'Failed to read raster' })
          const fields: Field[] = (res.bands ?? []).map((b) => ({
            name: b.name,
            type: 'numeric',
            value: b.value,
          }))
          done({ loading: false, fields })
        })
        .catch((e) => done({ loading: false, error: String(e) }))
    }
    return () => { cancelled = true }
  }, [target, lngLat, layers])

  if (!identify || !target) return null

  const n = identify.targets.length
  const pane = cacheRef.current.get(targetKey(target))

  return (
    <div
      ref={ref}
      className="absolute z-40 w-64 bg-geo-panel border border-geo-border rounded-lg shadow-xl p-3 flex flex-col gap-2"
      style={
        pos
          ? { left: pos.x, top: pos.y }
          : { left: identify.anchor.x + 8, top: identify.anchor.y + 8, visibility: 'hidden' }
      }
    >
      {/* Header / pager */}
      <div className="flex items-center gap-1">
        <button
          className="text-geo-muted hover:text-foreground disabled:opacity-30 disabled:hover:text-geo-muted"
          onClick={() => setIdentifyIndex(identify.index - 1)}
          disabled={identify.index === 0}
          title="Previous layer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <span className="text-[10px] text-geo-muted">Layer {identify.index + 1} of {n}</span>
          <div className="text-xs font-semibold text-geo-accent truncate" title={target.layerName}>
            {target.layerName}
            {target.kind === 'raster' && <span className="text-geo-muted font-normal"> (raster)</span>}
          </div>
        </div>
        <button
          className="text-geo-muted hover:text-foreground disabled:opacity-30 disabled:hover:text-geo-muted"
          onClick={() => setIdentifyIndex(identify.index + 1)}
          disabled={identify.index >= n - 1}
          title="Next layer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          className="text-geo-muted hover:text-foreground ml-1"
          onClick={closeIdentify}
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
        {!pane || pane.loading ? (
          <span className="text-xs text-geo-muted py-2">Loading…</span>
        ) : pane.gone ? (
          <span className="text-xs text-geo-muted py-2">Layer no longer available.</span>
        ) : pane.error ? (
          <span className="text-xs text-geo-error py-2">{pane.error}</span>
        ) : pane.fields && pane.fields.length > 0 ? (
          pane.fields.map((f) => {
            const icon = iconFor('column', f.type)
            const isNA = f.value === null || f.value === 'NA'
            return (
              <div key={f.name} className="flex items-baseline gap-2 text-xs">
                <span
                  className="w-3.5 flex-shrink-0 text-center leading-none"
                  style={{ color: icon.color }}
                  title={icon.tip}
                >
                  {icon.glyph}
                </span>
                <span className="w-20 flex-shrink-0 truncate text-geo-muted" title={`${f.name} (${f.type})`}>
                  {f.name}
                </span>
                <span className={`flex-1 min-w-0 break-words ${isNA ? 'text-geo-muted italic' : 'text-foreground'}`}>
                  {target.kind === 'raster' && isNA ? 'no data' : isNA ? 'NA' : f.value}
                </span>
              </div>
            )
          })
        ) : (
          <span className="text-xs text-geo-muted py-2">No attributes.</span>
        )}
      </div>
    </div>
  )
}
