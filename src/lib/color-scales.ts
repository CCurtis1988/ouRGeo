import type { ColorBinding } from '@/store/spatial'

// Sequential scales — for numeric columns (5 perceptually-ordered stops each)
export const SEQUENTIAL_SCALES: Record<string, string[]> = {
  viridis:  ['#440154', '#3b528b', '#21908d', '#5dc963', '#fde725'],
  plasma:   ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
  inferno:  ['#000004', '#51127c', '#b73779', '#fc8961', '#fcffa4'],
  blues:    ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5', '#084594'],
  reds:     ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'],
  greens:   ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'],
  oranges:  ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'],
  purples:  ['#fcfbfd', '#dadaeb', '#9e9ac8', '#6a51a3', '#3f007d'],
  RdYlGn:   ['#d73027', '#fc8d59', '#ffffbf', '#91cf60', '#1a9850'],
  RdBu:     ['#b2182b', '#ef8a62', '#fddbc7', '#67a9cf', '#2166ac'],
}

// Categorical palettes — for character/factor columns
export const CATEGORICAL_PALETTES: Record<string, string[]> = {
  tableau10: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
  set1:      ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#a65628', '#f781bf', '#999999'],
  set2:      ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
  pastel:    ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec'],
  dark2:     ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
}

export const ALL_SCALE_KEYS = Object.keys(SEQUENTIAL_SCALES)
export const ALL_PALETTE_KEYS = Object.keys(CATEGORICAL_PALETTES)

/**
 * Builds a MapLibre GL expression (or static hex) for data-driven coloring.
 * Returns a string for fixed/degenerate cases, an expression array otherwise.
 */
export function buildColorExpression(
  binding: ColorBinding,
  features: GeoJSON.Feature[],
  fallback: string
): string | unknown[] {
  if (binding.type === 'numeric') {
    const vals = features
      .map((f) => f.properties?.[binding.column])
      .filter((v): v is number => typeof v === 'number')
    if (vals.length === 0) return fallback
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const colors = SEQUENTIAL_SCALES[binding.scale] ?? SEQUENTIAL_SCALES.viridis
    const n = colors.length
    if (min === max) return colors[Math.floor(n / 2)]
    const stops: (string | number)[] = []
    colors.forEach((c, i) => stops.push(min + (max - min) * (i / (n - 1)), c))
    return ['interpolate', ['linear'], ['get', binding.column], ...stops]
  } else {
    const cats = [
      ...new Set(
        features
          .map((f) => f.properties?.[binding.column])
          .filter((v) => v != null)
      ),
    ]
    const palette = CATEGORICAL_PALETTES[binding.scale] ?? CATEGORICAL_PALETTES.tableau10
    const matchArgs: unknown[] = ['match', ['get', binding.column]]
    cats.forEach((val, i) => matchArgs.push(String(val), palette[i % palette.length]))
    matchArgs.push(fallback)
    return matchArgs
  }
}

/**
 * Returns summary info about a column's values — used by MapLegend for display.
 */
export function getColumnInfo(
  features: GeoJSON.Feature[],
  column: string
): { type: 'numeric' | 'categorical'; min?: number; max?: number; categories?: string[] } {
  const vals = features.map((f) => f.properties?.[column]).filter((v) => v != null)
  if (vals.length === 0) return { type: 'categorical', categories: [] }
  if (typeof vals[0] === 'number') {
    const nums = vals as number[]
    return { type: 'numeric', min: Math.min(...nums), max: Math.max(...nums) }
  }
  return {
    type: 'categorical',
    categories: [...new Set(vals.map(String))].slice(0, 20),
  }
}
