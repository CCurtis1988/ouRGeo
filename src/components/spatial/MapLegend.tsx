import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import React from 'react'
import { useSpatialStore } from '@/store/spatial'
import type { SpatialLayer, LegendSettings, RasterLayerInfo } from '@/store/spatial'
import { getEffectiveSym } from '@/lib/layer-symbology'
import { RASTER_RAMPS } from '@/lib/raster-layers'
import {
  SEQUENTIAL_SCALES,
  CATEGORICAL_PALETTES,
  getColumnInfo,
} from '@/lib/color-scales'

// ── Helpers ────────────────────────────────────────────────────────

function overlayStyle(
  position: LegendSettings['position'],
  offsetX: number,
  offsetY: number,
): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 10,
    ...(position.includes('top') ? { top: offsetY } : { bottom: offsetY }),
    ...(position.includes('left') ? { left: offsetX } : { right: offsetX }),
  }
}

function hexWithOpacity(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${opacity})`
}

// ── Main component ─────────────────────────────────────────────────

export function MapLegend(
  { layers: shown }: { layers?: SpatialLayer[] } = {},
): React.ReactElement | null {
  // The legend describes the map it is drawn on. Given no list it falls back
  // to every layer, which is what it always did and is still right for the
  // single-map case and for the export renderer.
  const allLayers = useSpatialStore((s) => s.layers)
  const layers = (shown ?? allLayers).filter((l) => l.visible)
  const ls = useSpatialStore((s) => s.legendSettings)

  if (layers.length === 0) return null

  return (
    <div
      className="shadow-lg overflow-hidden"
      style={{
        ...overlayStyle(ls.position, ls.offsetX, ls.offsetY),
        maxWidth: ls.maxWidth,
        backgroundColor: hexWithOpacity(ls.bgColor, ls.bgOpacity),
        border: ls.showBorder
          ? `${ls.borderWidth}px solid ${ls.borderColor}`
          : 'none',
        borderRadius: ls.borderRadius,
      }}
    >
      {ls.showTitle && (
        <div
          className="px-3 py-1.5"
          style={{
            borderBottom: ls.showBorder
              ? `${ls.borderWidth}px solid ${ls.borderColor}`
              : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span
            className="font-semibold uppercase tracking-widest text-geo-muted"
            style={{ fontSize: ls.titleSize }}
          >
            {ls.title}
          </span>
        </div>
      )}
      <div
        className="px-3 py-2 space-y-3 overflow-y-auto"
        style={{ maxHeight: ls.maxHeight }}
      >
        {layers.map((layer) => (
          <LegendEntry key={layer.id} layer={layer} settings={ls} />
        ))}
      </div>
    </div>
  )
}

// ── Layer entry ────────────────────────────────────────────────────

function LegendEntry({
  layer,
  settings,
}: {
  layer: SpatialLayer
  settings: LegendSettings
}): React.ReactElement {
  if (layer.kind === 'raster' && layer.raster) {
    return (
      <div className="space-y-1">
        <p
          className="font-medium text-foreground truncate"
          title={layer.name}
          style={{ fontSize: settings.itemFontSize }}
        >
          {layer.name}
        </p>
        <RasterLegend info={layer.raster} fontSize={settings.itemFontSize} maxCategories={settings.maxCategories} />
      </div>
    )
  }

  const s = getEffectiveSym(layer)
  const feats = layer.geojson.features
  const binding = s.fillColorBinding ?? s.borderColorBinding ?? null

  return (
    <div className="space-y-1">
      <p
        className="font-medium text-foreground truncate"
        title={layer.name}
        style={{ fontSize: settings.itemFontSize }}
      >
        {layer.name}
      </p>

      {!binding ? (
        <FixedSwatch layer={layer} sym={s} fontSize={settings.itemFontSize} />
      ) : binding.type === 'numeric' ? (
        <NumericRamp column={binding.column} scale={binding.scale} features={feats} fontSize={settings.itemFontSize} />
      ) : (
        <CategoricalDots
          column={binding.column}
          scale={binding.scale}
          features={feats}
          maxCategories={settings.maxCategories}
          catColumns={settings.catColumns}
          fontSize={settings.itemFontSize}
        />
      )}
    </div>
  )
}

// ── Raster legend ──────────────────────────────────────────────────

function RasterLegend({
  info,
  fontSize,
  maxCategories,
}: {
  info: RasterLayerInfo
  fontSize: number
  maxCategories: number
}): React.ReactElement {
  const sym = info.symbology
  const fmt = (v: number) =>
    Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')

  if (sym.mode === 'rgb') {
    const [r, g, b] = sym.bands
    const bandName = (i: number) => info.meta.bands[i - 1]?.name ?? `band ${i}`
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex flex-shrink-0 rounded-sm overflow-hidden">
          <div className="w-2 h-3.5" style={{ backgroundColor: '#e05252' }} />
          <div className="w-2 h-3.5" style={{ backgroundColor: '#52b552' }} />
          <div className="w-2 h-3.5" style={{ backgroundColor: '#5277e0' }} />
        </div>
        <span
          className="text-geo-muted truncate"
          style={{ fontSize: fontSize - 1 }}
          title={`R: ${bandName(r)} · G: ${bandName(g)} · B: ${bandName(b)}`}
        >
          RGB ({bandName(r)}, {bandName(g)}, {bandName(b)})
        </span>
      </div>
    )
  }

  if (sym.mode === 'categorical') {
    const cats = sym.categories ?? info.meta.bands[sym.bands[0] - 1]?.levels ?? []
    const shown = cats.slice(0, maxCategories)
    const overflow = cats.length - shown.length
    return (
      <div className="space-y-0.5">
        {shown.map((cat) => (
          <div key={cat.value} className="flex items-center gap-1.5 min-w-0">
            <div
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: cat.color }}
            />
            <span className="text-foreground truncate" title={cat.label} style={{ fontSize: fontSize - 1 }}>
              {cat.label || cat.value}
            </span>
          </div>
        ))}
        {overflow > 0 && (
          <span className="text-geo-muted" style={{ fontSize: fontSize - 1 }}>+ {overflow} more</span>
        )}
      </div>
    )
  }

  // Singleband pseudocolor / grayscale: continuous ramp + resolved range.
  const colors = [...(RASTER_RAMPS[sym.ramp] ?? RASTER_RAMPS.viridis)]
  if (sym.invertRamp) colors.reverse()
  const gradient = `linear-gradient(to right, ${colors.join(', ')})`
  const band = info.meta.bands[sym.bands[0] - 1]
  const lo = info.stretchRange?.lo?.[0]
  const hi = info.stretchRange?.hi?.[0]

  return (
    <div className="space-y-0.5">
      {band && (
        <p className="text-geo-muted truncate" title={band.name} style={{ fontSize: fontSize - 1 }}>
          {band.name}
        </p>
      )}
      <div className="h-3 rounded-sm w-full" style={{ background: gradient }} />
      <div className="flex justify-between text-geo-muted tabular-nums" style={{ fontSize: fontSize - 2 }}>
        <span>{lo !== undefined ? fmt(lo) : band ? fmt(band.min) : ''}</span>
        <span>{hi !== undefined ? fmt(hi) : band ? fmt(band.max) : ''}</span>
      </div>
    </div>
  )
}

// ── Fixed swatch ───────────────────────────────────────────────────

function FixedSwatch({
  layer,
  sym,
  fontSize,
}: {
  layer: SpatialLayer
  sym: ReturnType<typeof getEffectiveSym>
  fontSize: number
}): React.ReactElement {
  const gt = layer.geometryType.toUpperCase()
  const isPoly = familyIsPolygon(gt)
  const isLine = familyIsLine(gt) && !isPoly

  if (isPoly) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          className="w-5 h-5 rounded-sm border flex-shrink-0"
          style={{
            backgroundColor: sym.fillColor,
            opacity: sym.fillOpacity + 0.4,
            borderColor: sym.borderColor,
            borderWidth: Math.min(sym.borderWidth, 2),
          }}
        />
        <span className="text-geo-muted" style={{ fontSize: fontSize - 1 }}>Fixed color</span>
      </div>
    )
  }

  if (isLine) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          className="w-5 flex-shrink-0"
          style={{ height: Math.max(2, Math.min(sym.lineWidth, 4)), backgroundColor: sym.fillColor, borderRadius: 1 }}
        />
        <span className="text-geo-muted" style={{ fontSize: fontSize - 1 }}>Fixed color</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="rounded-full flex-shrink-0 border"
        style={{
          width: Math.min(sym.pointSize * 2, 14),
          height: Math.min(sym.pointSize * 2, 14),
          backgroundColor: sym.fillColor,
          borderColor: sym.borderColor,
          borderWidth: 1,
        }}
      />
      <span className="text-geo-muted" style={{ fontSize: fontSize - 1 }}>Fixed color</span>
    </div>
  )
}

// ── Numeric ramp ───────────────────────────────────────────────────

function NumericRamp({
  column,
  scale,
  features,
  fontSize,
}: {
  column: string
  scale: string
  features: GeoJSON.Feature[]
  fontSize: number
}): React.ReactElement {
  const colors = SEQUENTIAL_SCALES[scale] ?? SEQUENTIAL_SCALES.viridis
  const info = getColumnInfo(features, column)
  const gradient = `linear-gradient(to right, ${colors.join(', ')})`

  const fmt = (v: number) =>
    Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')

  return (
    <div className="space-y-0.5">
      <p className="text-geo-muted truncate" title={column} style={{ fontSize: fontSize - 1 }}>
        {column}
      </p>
      <div className="h-3 rounded-sm w-full" style={{ background: gradient }} />
      <div className="flex justify-between text-geo-muted tabular-nums" style={{ fontSize: fontSize - 2 }}>
        <span>{info.min !== undefined ? fmt(info.min) : ''}</span>
        <span>{info.max !== undefined ? fmt(info.max) : ''}</span>
      </div>
    </div>
  )
}

// ── Categorical dots ───────────────────────────────────────────────

function CategoricalDots({
  column,
  scale,
  features,
  maxCategories,
  catColumns,
  fontSize,
}: {
  column: string
  scale: string
  features: GeoJSON.Feature[]
  maxCategories: number
  catColumns: 1 | 2
  fontSize: number
}): React.ReactElement {
  const palette = CATEGORICAL_PALETTES[scale] ?? CATEGORICAL_PALETTES.tableau10
  const info = getColumnInfo(features, column)
  const cats = info.categories ?? []
  const shown = cats.slice(0, maxCategories)
  const overflow = cats.length - shown.length

  return (
    <div className="space-y-0.5">
      <p className="text-geo-muted truncate" title={column} style={{ fontSize: fontSize - 1 }}>
        {column}
      </p>
      <div
        className={catColumns === 2 ? 'grid grid-cols-2 gap-x-3 gap-y-0.5' : 'space-y-0.5'}
      >
        {shown.map((cat, i) => (
          <div key={cat} className="flex items-center gap-1.5 min-w-0">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: palette[i % palette.length] }}
            />
            <span className="text-foreground truncate" title={cat} style={{ fontSize: fontSize - 1 }}>
              {cat}
            </span>
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <span className="text-geo-muted" style={{ fontSize: fontSize - 1 }}>+ {overflow} more</span>
      )}
    </div>
  )
}
