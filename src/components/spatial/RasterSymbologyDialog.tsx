import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2 } from 'lucide-react'
import { useSpatialStore } from '@/store/spatial'
import type { RasterSymbology, RasterBandInfo } from '@/store/spatial'
import { rClient } from '@/lib/r-client'
import { registerRaster, defaultRasterSymbology, RASTER_RAMPS } from '@/lib/raster-layers'
import { cn } from '@/lib/utils'

interface RasterSymbologyDialogProps {
  layerId: string | null
  onClose: () => void
}

// ---------- Small controls ----------

function Slider({
  label, value, min, max, step = 0.05, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-geo-muted w-28 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-geo-accent h-1"
      />
      <span className="text-xs text-foreground w-10 text-right tabular-nums">
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

function NumberField({
  label, value, onChange, step = 1, width = 'w-16',
}: {
  label: string; value: number | ''; onChange: (v: number) => void
  step?: number; width?: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-geo-muted">
      {label}
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className={cn(
          width,
          'bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs',
          'text-foreground tabular-nums outline-none focus:border-geo-accent'
        )}
      />
    </label>
  )
}

function BandSelect({
  label, value, bands, onChange,
}: {
  label: string; value: number; bands: RasterBandInfo[]
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-geo-muted">
      <span className="w-6 flex-shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 bg-geo-bg border border-geo-border rounded px-1.5 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
      >
        {bands.map((b) => (
          <option key={b.index} value={b.index}>
            {b.index}: {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------- Ramp swatch strip ----------

function RampSwatch({
  colors, selected, onClick, title,
}: {
  colors: string[]; selected: boolean; onClick: () => void; title: string
}): React.ReactElement {
  const gradient = `linear-gradient(to right, ${colors.join(', ')})`
  return (
    <button
      className={cn(
        'h-5 rounded-sm border flex-1 min-w-0',
        selected ? 'border-geo-accent ring-1 ring-geo-accent' : 'border-geo-border hover:border-geo-muted'
      )}
      style={{ background: gradient }}
      onClick={onClick}
      title={title}
    />
  )
}

// ---------- Histogram ----------

function Histogram({
  breaks, counts, lo, hi,
}: {
  breaks: number[]; counts: number[]
  lo: number | undefined; hi: number | undefined
}): React.ReactElement | null {
  if (counts.length === 0 || breaks.length < 2) return null
  const W = 336
  const H = 64
  const maxC = Math.max(...counts, 1)
  const x0 = breaks[0]
  const x1 = breaks[breaks.length - 1]
  const span = x1 - x0 || 1
  const bw = W / counts.length

  const markX = (v: number | undefined) =>
    v === undefined ? null : Math.max(0, Math.min(W, ((v - x0) / span) * W))
  const loX = markX(lo)
  const hiX = markX(hi)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
      {counts.map((c, i) => {
        const h = (c / maxC) * (H - 4)
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={H - h}
            width={Math.max(bw - 1, 0.5)}
            height={h}
            className="fill-geo-muted/50"
          />
        )
      })}
      {loX !== null && (
        <line x1={loX} y1={0} x2={loX} y2={H} className="stroke-geo-accent" strokeWidth={1.5} />
      )}
      {hiX !== null && (
        <line x1={hiX} y1={0} x2={hiX} y2={H} className="stroke-geo-accent" strokeWidth={1.5} />
      )}
    </svg>
  )
}

// ---------- Main dialog ----------

export function RasterSymbologyDialog({
  layerId,
  onClose,
}: RasterSymbologyDialogProps): React.ReactElement {
  const layer = useSpatialStore((s) => s.layers.find((l) => l.id === layerId) ?? null)
  const updateRasterInfo = useSpatialStore((s) => s.updateRasterInfo)
  const setLayerOpacity = useSpatialStore((s) => s.setLayerOpacity)

  const [sym, setSym] = useState<RasterSymbology | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hist, setHist] = useState<{ breaks: number[]; counts: number[] } | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest requested symbology — a late response for an older style must not
  // clobber a newer one.
  const requestSeq = useRef(0)

  const info = layer?.raster ?? null
  const bands = info?.meta.bands ?? []
  const activeBand = sym?.mode === 'rgb' ? sym.bands[0] : sym?.bands[0] ?? 1
  const bandStats = bands[activeBand - 1]

  useEffect(() => {
    if (!layer?.raster) return
    setSym(layer.raster.symbology)
    setError(null)
    // Intentionally keyed on the dialog target — not on every raster update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId])

  // Histogram for the active band.
  useEffect(() => {
    if (!layerId || !layer || !sym) return
    let cancelled = false
    rClient
      .rasterHistogram(layer.name, layer.envName, activeBand)
      .then((res) => {
        if (!cancelled && res.success) setHist({ breaks: res.breaks, counts: res.counts })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, activeBand])

  const pushToServer = useCallback(
    (next: RasterSymbology) => {
      if (!layer?.raster) return
      const seq = ++requestSeq.current
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        setBusy(true)
        try {
          const reg = await registerRaster(
            layer.name,
            layer.envName,
            next,
            layer.raster!.layerId
          )
          if (seq !== requestSeq.current) return
          // Keep the richer meta from the original /raster/info call.
          updateRasterInfo(layer.id, { ...reg, meta: layer.raster!.meta })
          setError(null)
        } catch (e) {
          if (seq === requestSeq.current) {
            setError(e instanceof Error ? e.message : String(e))
          }
        } finally {
          if (seq === requestSeq.current) setBusy(false)
        }
      }, 350)
    },
    [layer, updateRasterInfo]
  )

  const apply = useCallback(
    (next: RasterSymbology) => {
      setSym(next)
      pushToServer(next)
    },
    [pushToServer]
  )

  const handleReset = () => {
    if (!info) return
    apply(defaultRasterSymbology({ nbands: info.meta.nbands, bands: info.meta.bands }))
  }

  if (!layer || !info || !sym) return <></>

  const categoricalAvailable = bands.some((b) => (b.levels?.length ?? 0) > 0)
  const stretchLo = info.stretchRange?.lo?.[0]
  const stretchHi = info.stretchRange?.hi?.[0]
  const fmt = (v: number) =>
    Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')

  const setMode = (mode: RasterSymbology['mode']) => {
    if (mode === sym.mode) return
    if (mode === 'rgb') {
      const n = info.meta.nbands
      apply({ ...sym, mode, bands: n >= 3 ? [1, 2, 3] : [1, 1, 1] })
    } else {
      apply({ ...sym, mode, bands: [sym.bands[0] ?? 1] })
    }
  }

  return (
    <Dialog.Root open={!!layerId} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[400px] max-h-[85vh] overflow-y-auto
            bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground flex items-center gap-2">
              Raster Symbology — {layer.name}
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-geo-muted" />}
            </Dialog.Title>
            <Dialog.Close className="text-geo-muted hover:text-foreground">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="p-4 space-y-4">
            {error && <p className="text-xs text-geo-error">{error}</p>}

            {/* Render mode */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-geo-muted uppercase tracking-wide">Render as</p>
              <div className="flex gap-1">
                {([
                  ['singleband', 'Singleband'],
                  ['rgb', 'RGB'],
                  ['categorical', 'Categories'],
                ] as const).map(([mode, label]) => {
                  const disabled =
                    (mode === 'rgb' && info.meta.nbands < 2) ||
                    (mode === 'categorical' && !categoricalAvailable)
                  return (
                    <button
                      key={mode}
                      disabled={disabled}
                      className={cn(
                        'flex-1 px-2 py-1 rounded text-xs border',
                        sym.mode === mode
                          ? 'bg-geo-accent/15 border-geo-accent text-foreground'
                          : 'border-geo-border text-geo-muted hover:text-foreground',
                        disabled && 'opacity-40 cursor-not-allowed'
                      )}
                      onClick={() => setMode(mode)}
                      title={
                        mode === 'categorical' && !categoricalAvailable
                          ? 'Requires a categorical (factor) band'
                          : undefined
                      }
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Band selection */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-geo-muted uppercase tracking-wide">
                {sym.mode === 'rgb' ? 'Band mapping' : 'Band'}
              </p>
              {sym.mode === 'rgb' ? (
                <div className="space-y-1">
                  {(['R', 'G', 'B'] as const).map((ch, i) => (
                    <BandSelect
                      key={ch}
                      label={ch}
                      value={sym.bands[i] ?? 1}
                      bands={bands}
                      onChange={(v) => {
                        const next = [...sym.bands]
                        next[i] = v
                        apply({ ...sym, bands: next })
                      }}
                    />
                  ))}
                </div>
              ) : (
                <BandSelect
                  label=""
                  value={sym.bands[0] ?? 1}
                  bands={sym.mode === 'categorical' ? bands.filter((b) => (b.levels?.length ?? 0) > 0) : bands}
                  onChange={(v) => apply({ ...sym, bands: [v] })}
                />
              )}
            </div>

            {/* Band stats + histogram */}
            {bandStats && (
              <div className="space-y-1.5 rounded border border-geo-border bg-geo-bg/50 p-2.5">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs font-medium text-foreground truncate" title={bandStats.name}>
                    {bandStats.name}
                  </p>
                  <p className="text-[10px] text-geo-muted">
                    {info.meta.dtype}
                    {info.meta.approx ? ' · sampled' : ''}
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[10px] text-geo-muted tabular-nums">
                  <span>min {fmt(bandStats.min)}</span>
                  <span>max {fmt(bandStats.max)}</span>
                  <span>μ {fmt(bandStats.mean)}</span>
                  <span>σ {fmt(bandStats.sd)}</span>
                </div>
                {hist && sym.mode !== 'categorical' && (
                  <Histogram
                    breaks={hist.breaks}
                    counts={hist.counts}
                    lo={sym.mode === 'singleband' ? stretchLo : undefined}
                    hi={sym.mode === 'singleband' ? stretchHi : undefined}
                  />
                )}
              </div>
            )}

            {/* Stretch */}
            {sym.mode !== 'categorical' && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-geo-muted uppercase tracking-wide">Stretch</p>
                <select
                  value={sym.stretch.type}
                  onChange={(e) =>
                    apply({
                      ...sym,
                      stretch: {
                        ...sym.stretch,
                        type: e.target.value as RasterSymbology['stretch']['type'],
                        ...(e.target.value === 'custom' && bandStats
                          ? {
                              min: sym.stretch.min ?? [stretchLo ?? bandStats.min],
                              max: sym.stretch.max ?? [stretchHi ?? bandStats.max],
                            }
                          : {}),
                      },
                    })
                  }
                  className="w-full bg-geo-bg border border-geo-border rounded px-1.5 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
                >
                  <option value="minmax">Minimum – Maximum</option>
                  <option value="percent">Percent Clip</option>
                  <option value="stddev">Standard Deviations</option>
                  <option value="custom">Custom Range</option>
                </select>

                {sym.stretch.type === 'percent' && (
                  <div className="flex gap-3">
                    <NumberField
                      label="Low %"
                      value={sym.stretch.pLow}
                      step={0.5}
                      onChange={(v) => apply({ ...sym, stretch: { ...sym.stretch, pLow: v } })}
                    />
                    <NumberField
                      label="High %"
                      value={sym.stretch.pHigh}
                      step={0.5}
                      onChange={(v) => apply({ ...sym, stretch: { ...sym.stretch, pHigh: v } })}
                    />
                  </div>
                )}
                {sym.stretch.type === 'stddev' && (
                  <NumberField
                    label="± n std dev"
                    value={sym.stretch.nStd}
                    step={0.5}
                    onChange={(v) => apply({ ...sym, stretch: { ...sym.stretch, nStd: v } })}
                  />
                )}
                {sym.stretch.type === 'custom' && (
                  <div className="flex gap-3">
                    <NumberField
                      label="Min"
                      value={sym.stretch.min?.[0] ?? ''}
                      width="w-20"
                      onChange={(v) => apply({ ...sym, stretch: { ...sym.stretch, min: [v] } })}
                    />
                    <NumberField
                      label="Max"
                      value={sym.stretch.max?.[0] ?? ''}
                      width="w-20"
                      onChange={(v) => apply({ ...sym, stretch: { ...sym.stretch, max: [v] } })}
                    />
                  </div>
                )}
                {sym.mode === 'singleband' && stretchLo !== undefined && stretchHi !== undefined && (
                  <p className="text-[10px] text-geo-muted tabular-nums">
                    Rendering {fmt(stretchLo)} – {fmt(stretchHi)}
                  </p>
                )}
              </div>
            )}

            {/* Color ramp */}
            {sym.mode === 'singleband' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-geo-muted uppercase tracking-wide">Color ramp</p>
                  <label className="flex items-center gap-1.5 text-xs text-geo-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sym.invertRamp}
                      onChange={(e) => apply({ ...sym, invertRamp: e.target.checked })}
                      className="accent-geo-accent"
                    />
                    Invert
                  </label>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {Object.entries(RASTER_RAMPS).map(([key, colors]) => (
                    <RampSwatch
                      key={key}
                      colors={sym.invertRamp ? [...colors].reverse() : colors}
                      selected={sym.ramp === key}
                      onClick={() => apply({ ...sym, ramp: key })}
                      title={key}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Category list (read-only summary) */}
            {sym.mode === 'categorical' && bandStats?.levels && (
              <div className="space-y-1 rounded border border-geo-border bg-geo-bg/50 p-2.5 max-h-40 overflow-y-auto">
                {bandStats.levels.map((lv) => (
                  <div key={lv.value} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-geo-border"
                      style={{ backgroundColor: lv.color }}
                    />
                    <span className="text-foreground truncate">{lv.label || lv.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Rendering options */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-geo-muted uppercase tracking-wide">Rendering</p>
              <Slider
                label="Opacity"
                value={layer.opacity}
                min={0}
                max={1}
                onChange={(v) => setLayerOpacity(layer.id, v)}
              />
              <div className="flex items-center gap-3">
                <span className="text-xs text-geo-muted w-28 flex-shrink-0">Resampling</span>
                <div className="flex gap-1 flex-1">
                  {(['nearest', 'bilinear'] as const).map((r) => (
                    <button
                      key={r}
                      className={cn(
                        'flex-1 px-2 py-1 rounded text-xs border capitalize',
                        sym.resampling === r
                          ? 'bg-geo-accent/15 border-geo-accent text-foreground'
                          : 'border-geo-border text-geo-muted hover:text-foreground'
                      )}
                      onClick={() => apply({ ...sym, resampling: r })}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-geo-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={sym.nodataTransparent}
                  onChange={(e) => apply({ ...sym, nodataTransparent: e.target.checked })}
                  className="accent-geo-accent"
                />
                Render NoData as transparent
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-geo-border">
            <button
              className="text-xs text-geo-muted hover:text-foreground"
              onClick={handleReset}
            >
              Reset to defaults
            </button>
            <Dialog.Close asChild>
              <button className="text-xs px-3 py-1.5 rounded bg-geo-accent hover:bg-geo-accent/80 text-white">
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
