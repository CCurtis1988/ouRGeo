import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import React from 'react'
import { SpatialLayer, useSpatialStore } from '@/store/spatial'
import { getEffectiveSym } from '@/lib/layer-symbology'
import { RASTER_RAMPS } from '@/lib/raster-layers'

interface LayerPreviewProps {
  layer: SpatialLayer
  onClick: (e: React.MouseEvent) => void
}

const DASH_PREVIEW: Record<string, string | undefined> = {
  solid: undefined,
  dashed: '5 2.5',
  dotted: '1.5 2.5',
}

function PointPreview({ layer }: { layer: SpatialLayer }) {
  const sym = getEffectiveSym(layer)
  const cx = 16, cy = 9
  const r = Math.min(7, 2 + sym.pointSize * 0.35)
  const sw = Math.min(3, sym.borderWidth * 0.7)
  const filterId = `halo-pt-${layer.id}`

  const shapeProps = {
    fill: sym.fillColor,
    stroke: sym.borderColor,
    strokeWidth: sw,
  }

  function renderShape() {
    switch (sym.pointShape) {
      case 'square':
        return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} {...shapeProps} />
      case 'triangle':
        return (
          <polygon
            points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`}
            {...shapeProps}
          />
        )
      case 'cross': {
        const t = r * 0.35
        const d = [
          `M ${cx - t} ${cy - r}`, `L ${cx + t} ${cy - r}`,
          `L ${cx + t} ${cy - t}`, `L ${cx + r} ${cy - t}`,
          `L ${cx + r} ${cy + t}`, `L ${cx + t} ${cy + t}`,
          `L ${cx + t} ${cy + r}`, `L ${cx - t} ${cy + r}`,
          `L ${cx - t} ${cy + t}`, `L ${cx - r} ${cy + t}`,
          `L ${cx - r} ${cy - t}`, `L ${cx - t} ${cy - t}`, 'Z',
        ].join(' ')
        return <path d={d} {...shapeProps} />
      }
      case 'diamond':
        return (
          <polygon
            points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
            {...shapeProps}
          />
        )
      default:
        return <circle cx={cx} cy={cy} r={r} {...shapeProps} />
    }
  }

  return (
    <>
      {sym.haloStrength > 0 && (
        <defs>
          <filter id={filterId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
      )}
      {sym.haloStrength > 0 && (
        <circle
          cx={cx} cy={cy}
          r={r + Math.min(sym.haloStrength * 0.5, 5)}
          fill={sym.haloColor}
          filter={`url(#${filterId})`}
          opacity={0.55}
        />
      )}
      {renderShape()}
    </>
  )
}

function LinePreview({ layer }: { layer: SpatialLayer }) {
  const sym = getEffectiveSym(layer)
  const lw = Math.min(6, sym.lineWidth * 0.6)
  const filterId = `halo-ln-${layer.id}`
  const dashArray = DASH_PREVIEW[sym.lineDash]

  return (
    <>
      {sym.haloStrength > 0 && (
        <defs>
          <filter id={filterId} x="-50%" y="-200%" width="200%" height="500%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
      )}
      {sym.haloStrength > 0 && (
        <line x1={3} y1={9} x2={29} y2={9}
          stroke={sym.haloColor}
          strokeWidth={lw + Math.min(sym.haloStrength * 0.5, 5)}
          filter={`url(#${filterId})`}
          opacity={0.5}
        />
      )}
      {sym.borderWidth > 0 && (
        <line x1={3} y1={9} x2={29} y2={9}
          stroke={sym.borderColor}
          strokeWidth={lw + sym.borderWidth * 0.8}
        />
      )}
      <line x1={3} y1={9} x2={29} y2={9}
        stroke={sym.fillColor}
        strokeWidth={Math.max(1, lw)}
        strokeDasharray={dashArray}
        strokeLinecap="round"
      />
    </>
  )
}

function PolygonPreview({ layer }: { layer: SpatialLayer }) {
  const sym = getEffectiveSym(layer)
  const bw = Math.min(4, sym.borderWidth * 0.9)
  const filterId = `halo-pg-${layer.id}`

  return (
    <>
      {sym.haloStrength > 0 && (
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
      )}
      {sym.haloStrength > 0 && (
        <rect x={4} y={3} width={24} height={12}
          fill="none"
          stroke={sym.haloColor}
          strokeWidth={bw + Math.min(sym.haloStrength * 0.6, 6)}
          filter={`url(#${filterId})`}
          opacity={0.5}
        />
      )}
      <rect x={4} y={3} width={24} height={12}
        fill={sym.fillColor}
        fillOpacity={sym.fillOpacity}
      />
      <rect x={4} y={3} width={24} height={12}
        fill="none"
        stroke={sym.borderColor}
        strokeWidth={bw}
      />
    </>
  )
}

function RasterPreview({ layer }: { layer: SpatialLayer }) {
  const sym = layer.raster?.symbology
  const gradId = `raster-prev-${layer.id}`

  if (sym?.mode === 'rgb') {
    return (
      <>
        <rect x={4} y={3} width={8} height={12} fill="#e05252" />
        <rect x={12} y={3} width={8} height={12} fill="#52b552" />
        <rect x={20} y={3} width={8} height={12} fill="#5277e0" />
        <rect x={4} y={3} width={24} height={12} fill="none" stroke="#21262d" strokeWidth={1} />
      </>
    )
  }

  if (sym?.mode === 'categorical') {
    const cats = sym.categories ?? layer.raster?.meta.bands[0]?.levels ?? []
    const shown = cats.slice(0, 4)
    const w = shown.length > 0 ? 24 / shown.length : 24
    return (
      <>
        {shown.map((c, i) => (
          <rect key={c.value} x={4 + i * w} y={3} width={w} height={12} fill={c.color} />
        ))}
        <rect x={4} y={3} width={24} height={12} fill="none" stroke="#21262d" strokeWidth={1} />
      </>
    )
  }

  const colors = [...(RASTER_RAMPS[sym?.ramp ?? 'viridis'] ?? RASTER_RAMPS.viridis)]
  if (sym?.invertRamp) colors.reverse()
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          {colors.map((c, i) => (
            <stop key={i} offset={`${(i / (colors.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <rect x={4} y={3} width={24} height={12} fill={`url(#${gradId})`} />
      <rect x={4} y={3} width={24} height={12} fill="none" stroke="#21262d" strokeWidth={1} />
    </>
  )
}

export function LayerPreview({ layer: layerProp, onClick }: LayerPreviewProps): React.ReactElement {
  // Subscribe directly to the store so this re-renders immediately when symbology
  // is updated, regardless of whether the parent has re-rendered yet.
  const layer = useSpatialStore(
    (s) => s.layers.find((l) => l.id === layerProp.id) ?? layerProp
  )
  const gt = layer.geometryType.toUpperCase()
  const isRaster = layer.kind === 'raster'
  const isPoly = familyIsPolygon(gt)
  const isLine = familyIsLine(gt) && !isPoly

  return (
    <button
      className="flex-shrink-0 rounded-sm cursor-pointer hover:opacity-80"
      style={{ lineHeight: 0 }}
      title="Edit Symbology"
      onClick={onClick}
    >
      <svg
        width={32}
        height={18}
        viewBox="0 0 32 18"
        xmlns="http://www.w3.org/2000/svg"
        overflow="visible"
        style={{ display: 'block' }}
      >
        {isRaster ? <RasterPreview  layer={layer} /> :
         isPoly   ? <PolygonPreview layer={layer} /> :
         isLine   ? <LinePreview    layer={layer} /> :
                    <PointPreview   layer={layer} />}
      </svg>
    </button>
  )
}
