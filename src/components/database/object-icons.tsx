import React from 'react'
import {
  Table, Table2, Sheet, Grid3x3, Image as ImageIcon, FileQuestion,
  FunctionSquare, Boxes, Grid2x2, Variable, Package
} from 'lucide-react'
import type { RgeoObjectKind } from '@/lib/r-client'

const SF_COLOR = '#7CC4FF'
const GEOS_COLOR = '#FFA94D'

interface IconProps {
  size?: number
  className?: string
}

// ── Geometry glyphs (sized 16×16 by default, color via fill/stroke) ───────

function PointGlyph({ color, size = 14 }: { color: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="3.5" fill={color} />
    </svg>
  )
}

function MultiPointGlyph({ color, size = 14 }: { color: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="4" cy="5"  r="2" fill={color} />
      <circle cx="12" cy="6" r="2" fill={color} />
      <circle cx="7"  cy="12" r="2" fill={color} />
    </svg>
  )
}

function LineGlyph({ color, size = 14 }: { color: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <polyline points="2,12 6,4 10,10 14,3" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MultiLineGlyph({ color, size = 14 }: { color: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <polyline points="2,5 6,2 9,6" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="6,14 10,9 14,12" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PolygonGlyph({ color, size = 14 }: { color: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <polygon points="8,2 14,6 12,13 4,13 2,6" fill={color} fillOpacity="0.55" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

function MultiPolygonGlyph({ color, size = 14 }: { color: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <polygon points="2,4 7,2 8,8 3,9" fill={color} fillOpacity="0.55" stroke={color} strokeWidth="1.4" />
      <polygon points="8,7 14,6 13,13 7,14" fill={color} fillOpacity="0.55" stroke={color} strokeWidth="1.4" />
    </svg>
  )
}

// ── Resolver ───────────────────────────────────────────────────────────────

function geomGlyph(geometryType: string | null | undefined, color: string, size?: number): React.ReactElement {
  const t = (geometryType ?? '').toUpperCase()
  // The server may return a comma-separated list ("POINT, MULTIPOINT") — pick the first.
  const first = t.split(',')[0].trim()
  switch (first) {
    case 'POINT':              return <PointGlyph color={color} size={size} />
    case 'MULTIPOINT':         return <MultiPointGlyph color={color} size={size} />
    case 'LINESTRING':         return <LineGlyph color={color} size={size} />
    case 'MULTILINESTRING':    return <MultiLineGlyph color={color} size={size} />
    case 'POLYGON':            return <PolygonGlyph color={color} size={size} />
    case 'MULTIPOLYGON':       return <MultiPolygonGlyph color={color} size={size} />
    case 'GEOMETRYCOLLECTION': return <MultiPolygonGlyph color={color} size={size} />
    default:                   return <PolygonGlyph color={color} size={size} />
  }
}

const VECTOR_CLASSES = new Set(['numeric', 'integer', 'character', 'logical', 'factor', 'complex'])

function rdsGlyph(rClass: string | null | undefined, size: number): React.ReactElement {
  const c = (rClass ?? '').toLowerCase()
  if (c === 'function')                      return <FunctionSquare size={size} className="text-geo-accent" />
  if (c === 'list' || c === 'environment')   return <Boxes          size={size} className="text-geo-muted" />
  if (c === 'matrix' || c === 'array')       return <Grid2x2        size={size} className="text-geo-muted" />
  if (VECTOR_CLASSES.has(c))                 return <Variable       size={size} className="text-geo-muted" />
  return <Package size={size} className="text-geo-muted" />
}

export function getObjectIcon(
  kind: RgeoObjectKind,
  geometryType?: string | null,
  size = 14,
  rClass?: string | null,
): React.ReactElement {
  switch (kind) {
    case 'sf':         return geomGlyph(geometryType, SF_COLOR, size)
    case 'geos':       return geomGlyph(geometryType, GEOS_COLOR, size)
    case 'data.frame': return <Table     size={size} className="text-geo-muted" />
    case 'tibble':     return <Table2    size={size} className="text-geo-muted" />
    case 'data.table': return <Sheet     size={size} className="text-geo-muted" />
    case 'raster':     return <Grid3x3   size={size} className="text-geo-success" />
    case 'image':      return <ImageIcon size={size} style={{ color: '#A78BFA' }} />
    case 'rds':        return rdsGlyph(rClass, size)
    default:           return <FileQuestion size={size} className="text-geo-muted" />
  }
}

export function ObjectIcon({
  kind,
  geometryType,
  rClass,
  size = 14,
}: { kind: RgeoObjectKind; geometryType?: string | null; rClass?: string | null } & IconProps): React.ReactElement {
  return <span className="inline-flex items-center justify-center" style={{ width: size, height: size }}>{getObjectIcon(kind, geometryType, size, rClass)}</span>
}
