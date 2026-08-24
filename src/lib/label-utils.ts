import type { LabelSettings } from '@/store/spatial'

/**
 * Convert a {FIELD} template string to a MapLibre GL expression.
 * e.g. "{NAME}"            → ['get', 'NAME']
 *      "City: {NAME}"      → ['concat', 'City: ', ['get', 'NAME']]
 *      "{CITY} ({STATE})"  → ['concat', ['get', 'CITY'], ' (', ['get', 'STATE'], ')']
 */
export function parseFieldTemplate(template: string): string | unknown[] {
  if (!template.trim()) return ''

  const parts = template.split(/\{([^}]+)\}/)

  // No fields found — plain literal string
  if (parts.length === 1) return template

  // Single bare field: "{NAME}" → ['get', 'NAME']
  if (parts.length === 3 && parts[0] === '' && parts[2] === '')
    return ['get', parts[1]]

  // Mixed literal + fields → ['concat', ...]
  const expr: unknown[] = ['concat']
  parts.forEach((p, i) => {
    if (i % 2 === 0) {
      if (p) expr.push(p)
    } else {
      expr.push(['get', p])
    }
  })
  return expr
}

/**
 * Resolve font family + bold/italic to a MapLibre text-font array.
 * Uses CARTO/OpenMapTiles glyph names available in dark-matter, voyager, and positron styles.
 */
export function resolveFont(family: string, bold: boolean, italic: boolean): string[] {
  if (italic) {
    return [
      bold ? 'Klokantech Noto Sans Bold Italic' : 'Klokantech Noto Sans Italic',
      bold ? 'Arial Unicode MS Bold' : 'Arial Unicode MS Regular',
    ]
  }
  if (family === 'Arial Unicode MS')
    return [bold ? 'Arial Unicode MS Bold' : 'Arial Unicode MS Regular']
  if (family === 'Noto Sans')
    return [
      bold ? 'Klokantech Noto Sans Bold' : 'Klokantech Noto Sans Regular',
      'Arial Unicode MS Regular',
    ]
  // Open Sans (default)
  return [
    bold ? 'Open Sans Bold' : 'Open Sans Regular',
    'Arial Unicode MS Regular',
  ]
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  enabled: false,
  field: '',
  fontSize: 12,
  fontFamily: 'Open Sans',
  bold: false,
  italic: false,
  color: '#ffffff',
  opacity: 1,
  haloColor: '#000000',
  haloWidth: 1.5,
  haloBlur: 0.5,
  anchor: 'top',
  offsetX: 0,
  offsetY: 0.5,
  overlapStrategy: 'cooperative',
  textTransform: 'none',
  letterSpacing: 0,
  maxWidth: 10,
  symbolSpacing: 250,
  minZoom: 0,
}
