import type { CompletionKind } from './types'

/** A monochrome-glyph badge: one typographic glyph tinted with a token color. */
export interface IconSpec {
  glyph: string
  color: string
  /** hover title / a11y label describing the type */
  tip: string
}

// Palette — GitHub-dark aligned, a superset of the geo design tokens so every
// R type gets a distinct, legible tint.
const C = {
  blue: '#4493f8', // geo-accent — numeric
  green: '#3fb950', // geo-success — character
  amber: '#d29922', // logical
  purple: '#bc8cff', // functions / factor
  orange: '#f0883e', // data frames
  cyan: '#39c5cf', // date / time
  pink: '#f778ba', // geometry
  muted: '#8b949e', // geo-muted — lists, keywords, misc
  red: '#f85149', // geo-error — reserved
} as const

/**
 * Resolve a display glyph for a completion. Container/object classes get
 * geometric glyphs; scalar column/vector types get compact typographic marks.
 * The mapping is intentionally comprehensive — every common R class lands on a
 * meaningful icon rather than a generic fallback.
 */
export function iconFor(kind: CompletionKind, rType?: string): IconSpec {
  const t = (rType || '').toLowerCase()

  // Geometry is meaningful across kinds (column OR object), so check first.
  if (
    t.startsWith('sfc_') ||
    t.startsWith('sfg') ||
    t === 'sfc' ||
    t === 'sf' ||
    t === 'geos_geometry' ||
    t === 'geometry' ||
    t.startsWith('spatvector') ||
    t.startsWith('spatraster')
  ) {
    return { glyph: '◈', color: C.pink, tip: rType || 'geometry' }
  }

  switch (kind) {
    case 'function':
      return { glyph: 'ƒ', color: C.purple, tip: 'function' }
    case 'argument':
      return { glyph: '⌥', color: C.muted, tip: 'argument' }
    case 'package':
      return { glyph: '▣', color: C.muted, tip: 'package' }
    case 'snippet':
      return { glyph: '❯', color: C.blue, tip: 'snippet' }
    case 'keyword':
      return { glyph: '◆', color: C.muted, tip: 'keyword' }
    default:
      break
  }

  // Columns and objects are typed by their R class.
  return iconForType(t, rType)
}

function iconForType(t: string, raw?: string): IconSpec {
  const label = raw || t

  // Scalar / column vector types
  if (t === 'numeric' || t === 'double' || t === 'integer' || t === 'int')
    return { glyph: '#', color: C.blue, tip: label }
  if (t === 'character' || t === 'string' || t === 'glue')
    return { glyph: 'A', color: C.green, tip: label }
  if (t === 'logical' || t === 'boolean')
    return { glyph: '⊤', color: C.amber, tip: label }
  if (t === 'factor' || t === 'ordered')
    return { glyph: 'ᖴ', color: C.purple, tip: label }
  if (t === 'complex') return { glyph: 'ℂ', color: C.blue, tip: label }
  if (t === 'raw') return { glyph: '▪', color: C.muted, tip: label }
  if (
    t === 'date' ||
    t === 'posixct' ||
    t === 'posixt' ||
    t === 'posixlt' ||
    t === 'idate' ||
    t.startsWith('hms') ||
    t === 'difftime' ||
    t === 'yearmon' ||
    t === 'yearqtr'
  )
    return { glyph: '◷', color: C.cyan, tip: label }
  if (t === 'formula') return { glyph: '~', color: C.muted, tip: 'formula' }

  // Container / object types
  if (t === 'data.frame') return { glyph: '▦', color: C.orange, tip: label }
  if (t === 'tbl_df' || t === 'tbl' || t === 'tibble' || t === 'grouped_df')
    return { glyph: '▦', color: C.cyan, tip: 'tibble' }
  if (t === 'data.table') return { glyph: '▦', color: C.green, tip: 'data.table' }
  if (t === 'tbl_dbi' || t === 'tbl_sql' || t === 'tbl_lazy')
    return { glyph: '▦', color: C.purple, tip: 'lazy table' }
  if (t === 'matrix') return { glyph: '⊞', color: C.blue, tip: 'matrix' }
  if (t === 'array') return { glyph: '⧉', color: C.blue, tip: 'array' }
  if (t === 'list') return { glyph: '☰', color: C.muted, tip: 'list' }
  if (t === 'environment') return { glyph: '❴❵', color: C.muted, tip: 'environment' }
  if (t === 'function') return { glyph: 'ƒ', color: C.purple, tip: 'function' }

  // Unknown / generic object
  return { glyph: '●', color: C.muted, tip: label }
}
