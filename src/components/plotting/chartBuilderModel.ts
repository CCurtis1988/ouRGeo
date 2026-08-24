// ── Chart Builder: model (types, presets, codegen) ───────────────────────────
import type { ColumnInfo } from '@/lib/r-client'

// ── Variable type system ───────────────────────────────────────────────────────

export type VarType = 'num' | 'int' | 'chr' | 'fct' | 'date' | 'lgl' | 'oth'

export function getVarType(type: string): VarType {
  const t = type.toLowerCase()
  if (t === 'numeric' || t === 'double') return 'num'
  if (t === 'integer') return 'int'
  if (t === 'character') return 'chr'
  if (t === 'factor' || t === 'ordered') return 'fct'
  if (t.includes('date') || t.includes('posix') || t.includes('time')) return 'date'
  if (t === 'logical') return 'lgl'
  return 'oth'
}

export const TYPE_BADGE: Record<VarType, string> = {
  num:  'bg-blue-500/20 text-blue-400',
  int:  'bg-blue-500/20 text-blue-400',
  chr:  'bg-orange-500/20 text-orange-400',
  fct:  'bg-orange-500/20 text-orange-400',
  date: 'bg-green-500/20 text-green-400',
  lgl:  'bg-purple-500/20 text-purple-400',
  oth:  'bg-[#21262d] text-[#8b949e]',
}

export function isNumericType(vt: VarType | null): boolean {
  return vt === 'num' || vt === 'int' || vt === 'date'
}
export function isCatType(vt: VarType | null): boolean {
  return vt === 'chr' || vt === 'fct' || vt === 'lgl'
}

// ── State types ────────────────────────────────────────────────────────────────

export interface AesMap {
  x: string; y: string; colour: string; fill: string
  size: string; shape: string; alpha: string
  facetRow: string; facetCol: string; group: string
}

export interface CustomizeState {
  alphaFixed: number
  position: 'stack' | 'dodge' | 'fill' | 'identity'
  pointSize: number
  jitter: boolean
  linewidth: number
  linetype: 'solid' | 'dashed' | 'dotted' | 'dotdash' | 'longdash' | 'twodash'
  bins: number
  smoothMethod: 'auto' | 'lm' | 'loess' | 'gam'
  smoothSe: boolean
  colorFixed: string
  fillFixed: string
}

export interface LabelsState {
  title: string; subtitle: string; caption: string
  xLabel: string; yLabel: string
  colourLabel: string; fillLabel: string
}

export interface ThemeState {
  base: string
  legendPosition: 'right' | 'left' | 'top' | 'bottom' | 'none'
  xAngle: 0 | 45 | 90
  yAngle: 0 | 45 | 90
  baseFontSize: number
  panelGrid: 'both' | 'major' | 'none'
}

export interface GeomLayer {
  id: string
  geomType: string
  customize: CustomizeState
  visible: boolean
}

export interface ChartBuilderState {
  dataset: string
  layers: GeomLayer[]
  aes: AesMap
  labels: LabelsState
  theme: ThemeState
}

export const DEFAULT_AES: AesMap = {
  x: '', y: '', colour: '', fill: '', size: '', shape: '',
  alpha: '', facetRow: '', facetCol: '', group: '',
}
export const DEFAULT_CUSTOMIZE: CustomizeState = {
  alphaFixed: 1, position: 'stack', pointSize: 2, jitter: false,
  linewidth: 0.8, linetype: 'solid', bins: 30,
  smoothMethod: 'auto', smoothSe: true, colorFixed: '', fillFixed: '',
}
export const DEFAULT_LABELS: LabelsState = {
  title: '', subtitle: '', caption: '', xLabel: '', yLabel: '', colourLabel: '', fillLabel: '',
}
export const DEFAULT_THEME: ThemeState = {
  base: 'ggplot2::theme_minimal', legendPosition: 'right', xAngle: 0, yAngle: 0, baseFontSize: 11, panelGrid: 'both',
}

// ID generation for layers
let _idCounter = 0
export function generateId(): string { return `layer_${Date.now()}_${++_idCounter}` }
export function newLayer(geomType = 'point'): GeomLayer {
  return { id: generateId(), geomType, customize: { ...DEFAULT_CUSTOMIZE }, visible: true }
}
export function makeDefaultState(): ChartBuilderState {
  return {
    dataset: '',
    layers: [newLayer('point')],
    aes: { ...DEFAULT_AES },
    labels: { ...DEFAULT_LABELS },
    theme: { ...DEFAULT_THEME },
  }
}

export type AesKey = keyof AesMap

// ── Geom configuration ─────────────────────────────────────────────────────────

export const GEOM_FN: Record<string, string> = {
  point:     'geom_point',
  line:      'geom_line',
  bar:       'geom_bar',
  col:       'geom_col',
  histogram: 'geom_histogram',
  boxplot:   'geom_boxplot',
  density:   'geom_density',
  violin:    'geom_violin',
  area:      'geom_area',
  smooth:    'geom_smooth',
}

export const GEOMS = ['point', 'line', 'bar', 'col', 'histogram', 'boxplot', 'density', 'violin', 'area', 'smooth'] as const
export const GEOM_LABELS: Record<string, string> = {
  point: 'Scatter', line: 'Line', bar: 'Bar', col: 'Column',
  histogram: 'Histogram', boxplot: 'Box Plot', density: 'Density',
  violin: 'Violin', area: 'Area', smooth: 'Smooth',
}

// Count-stat geoms: conflict with global Y mapping or identity-stat layers
export const COUNT_STAT_GEOMS = new Set(['bar', 'histogram', 'density'])

// ── Conflict detection ─────────────────────────────────────────────────────────

export function getConflictingLayerIds(layers: GeomLayer[], globalY: string): Set<string> {
  const conflicting = new Set<string>()
  const hasGlobalY = !!globalY
  const hasIdentityInVisible = layers.some(l => l.visible && !COUNT_STAT_GEOMS.has(l.geomType))

  for (const layer of layers) {
    if (!COUNT_STAT_GEOMS.has(layer.geomType)) continue
    // count-stat geom conflicts when y is globally mapped OR mixed with identity-stat layers
    if (hasGlobalY || hasIdentityInVisible) conflicting.add(layer.id)
  }
  return conflicting
}

// ── Smart geom availability ────────────────────────────────────────────────────

export type GeomState = 'recommended' | 'available' | 'dim'

export function geomAvailability(aes: AesMap, cols: ColumnInfo[]): Record<string, GeomState> {
  const colMap = new Map(cols.map(c => [c.name, getVarType(c.type)]))
  const xType = aes.x ? (colMap.get(aes.x) ?? null) : null
  const yType = aes.y ? (colMap.get(aes.y) ?? null) : null
  const hasX = !!aes.x, hasY = !!aes.y
  const xNum = isNumericType(xType), xCat = isCatType(xType)
  const yNum = isNumericType(yType)

  return {
    point:     hasX && hasY && xNum && yNum ? 'recommended' : hasX && hasY ? 'available' : 'dim',
    line:      hasX && hasY && xNum ? 'recommended' : hasX && hasY ? 'available' : 'dim',
    smooth:    hasX && hasY && xNum && yNum ? 'recommended' : hasX && hasY ? 'available' : 'dim',
    bar:       hasX && !hasY ? 'recommended' : 'available',
    col:       hasX && hasY && xCat && yNum ? 'recommended' : hasX && hasY ? 'available' : 'dim',
    histogram: hasX && xNum && !hasY ? 'recommended' : hasX && !hasY ? 'available' : 'dim',
    density:   hasX && xNum && !hasY ? 'recommended' : 'dim',
    boxplot:   hasX && hasY && xCat && yNum ? 'recommended' : hasX && hasY ? 'available' : 'dim',
    violin:    hasX && hasY && xCat && yNum ? 'recommended' : hasX && hasY ? 'available' : 'dim',
    area:      hasX && hasY && xNum ? 'recommended' : hasX && hasY ? 'available' : 'dim',
  }
}

// ── Per-layer geom params ──────────────────────────────────────────────────────

export function geomParamsForLayer(geom: string, c: CustomizeState, aes: AesMap): string[] {
  const fixedParts: string[] = []
  if (!aes.alpha && c.alphaFixed !== 1) fixedParts.push(`alpha = ${c.alphaFixed}`)
  if (!aes.colour && c.colorFixed)      fixedParts.push(`colour = "${c.colorFixed}"`)
  if (!aes.fill   && c.fillFixed)       fixedParts.push(`fill = "${c.fillFixed}"`)

  switch (geom) {
    case 'point': {
      const p = [...fixedParts]
      if (c.pointSize !== 2) p.push(`size = ${c.pointSize}`)
      if (c.jitter) p.push(`position = ggplot2::position_jitter(width = 0.2, height = 0)`)
      return p
    }
    case 'line': {
      const p = [...fixedParts]
      if (c.linewidth !== 0.8) p.push(`linewidth = ${c.linewidth}`)
      if (c.linetype !== 'solid') p.push(`linetype = "${c.linetype}"`)
      return p
    }
    case 'bar': {
      const p = [...fixedParts]
      p.unshift('stat = "count"')
      if (c.position !== 'stack') p.push(`position = "${c.position}"`)
      return p
    }
    case 'col': {
      const p = [...fixedParts]
      if (c.position !== 'stack') p.push(`position = "${c.position}"`)
      return p
    }
    case 'histogram': {
      const p = [...fixedParts]
      p.unshift(`bins = ${c.bins}`)
      if (c.position !== 'stack') p.push(`position = "${c.position}"`)
      return p
    }
    case 'smooth': {
      const p = [...fixedParts]
      if (c.smoothMethod !== 'auto') p.push(`method = "${c.smoothMethod}"`)
      if (!c.smoothSe) p.push(`se = FALSE`)
      return p
    }
    case 'area': {
      const p = [...fixedParts]
      if (c.linewidth !== 0.8) p.push(`linewidth = ${c.linewidth}`)
      return p
    }
    default:
      return [...fixedParts]
  }
}

// ── Code generation ────────────────────────────────────────────────────────────

export function buildGgplotCode(s: ChartBuilderState): string {
  const visibleLayers = s.layers.filter(l => l.visible)
  if (!s.dataset || visibleLayers.length === 0) return ''

  const a = s.aes
  const t = s.theme

  const aesParts: string[] = []
  if (a.x)      aesParts.push(`x = ${a.x}`)
  if (a.y)      aesParts.push(`y = ${a.y}`)
  if (a.colour) aesParts.push(`colour = ${a.colour}`)
  if (a.fill)   aesParts.push(`fill = ${a.fill}`)
  if (a.size)   aesParts.push(`size = ${a.size}`)
  if (a.shape)  aesParts.push(`shape = ${a.shape}`)
  if (a.alpha)  aesParts.push(`alpha = ${a.alpha}`)
  if (a.group)  aesParts.push(`group = ${a.group}`)

  const lines: string[] = [
    `ggplot2::ggplot(${s.dataset}, ggplot2::aes(${aesParts.join(', ')}))`,
  ]

  for (const layer of visibleLayers) {
    const gp = geomParamsForLayer(layer.geomType, layer.customize, a)
    lines.push(`  ggplot2::${GEOM_FN[layer.geomType]}(${gp.join(', ')})`)
  }

  // labs
  const labParts: string[] = []
  const lb = s.labels
  if (lb.title)       labParts.push(`title = "${lb.title}"`)
  if (lb.subtitle)    labParts.push(`subtitle = "${lb.subtitle}"`)
  if (lb.caption)     labParts.push(`caption = "${lb.caption}"`)
  if (lb.xLabel)      labParts.push(`x = "${lb.xLabel}"`)
  if (lb.yLabel)      labParts.push(`y = "${lb.yLabel}"`)
  if (lb.colourLabel) labParts.push(`colour = "${lb.colourLabel}"`)
  if (lb.fillLabel)   labParts.push(`fill = "${lb.fillLabel}"`)
  if (labParts.length) lines.push(`  ggplot2::labs(${labParts.join(', ')})`)

  // facets
  if (a.facetRow || a.facetCol) {
    lines.push(`  ggplot2::facet_grid(${a.facetRow || '.'} ~ ${a.facetCol || '.'})`)
  }

  // base theme
  if (t.base) {
    const sizeParam = t.base.startsWith('cowplot::') ? 'font_size' : 'base_size'
    const sizeArg = t.baseFontSize !== 11 ? `${sizeParam} = ${t.baseFontSize}` : ''
    lines.push(`  ${t.base}(${sizeArg})`)
  }

  // theme() overrides
  const themeArgs: string[] = []
  if (t.legendPosition !== 'right') themeArgs.push(`legend.position = "${t.legendPosition}"`)
  if (t.xAngle !== 0) themeArgs.push(`axis.text.x = ggplot2::element_text(angle = ${t.xAngle}, hjust = 1)`)
  if (t.yAngle !== 0) themeArgs.push(`axis.text.y = ggplot2::element_text(angle = ${t.yAngle}, hjust = 1)`)
  if (t.panelGrid === 'major') themeArgs.push(`panel.grid.minor = ggplot2::element_blank()`)
  if (t.panelGrid === 'none')  themeArgs.push(`panel.grid = ggplot2::element_blank()`)
  if (themeArgs.length) lines.push(`  ggplot2::theme(${themeArgs.join(',\n    ')})`)

  return lines.join(' +\n')
}

// ── Dataset combobox ──────────────────────────────────────────────────────────

// ── Aesthetic slot (drop zone) ─────────────────────────────────────────────────

export const AES_LABELS: Partial<Record<AesKey, string>> = {
  x: 'X Axis', y: 'Y Axis', colour: 'Colour', fill: 'Fill',
  size: 'Size', shape: 'Shape', alpha: 'Alpha',
  facetRow: 'Facet Row', facetCol: 'Facet Col', group: 'Group',
}

export const AES_ALLOWED: Record<AesKey, VarType[] | 'any'> = {
  x:        'any',
  y:        ['num', 'int'],
  colour:   'any',
  fill:     'any',
  size:     ['num', 'int'],
  shape:    ['chr', 'fct', 'lgl'],
  alpha:    ['num', 'int'],
  group:    'any',
  facetRow: ['chr', 'fct', 'lgl'],
  facetCol: ['chr', 'fct', 'lgl'],
}

export const AES_HINT: Record<AesKey, string> = {
  x: 'any type', y: 'numeric',
  colour: 'any type', fill: 'any type',
  size: 'numeric', shape: 'categorical',
  alpha: 'numeric', group: 'any type',
  facetRow: 'categorical', facetCol: 'categorical',
}

export function isCompatible(aesKey: AesKey, vt: VarType): boolean {
  const allowed = AES_ALLOWED[aesKey]
  return allowed === 'any' || (allowed as VarType[]).includes(vt)
}

// ── Theme data ────────────────────────────────────────────────────────────────

export interface ThemeConfig { id: string; label: string; bg: string; panel: string; border: string; grid: string }
export interface ThemePackage { name: string; themes: ThemeConfig[] }

export const THEME_PACKAGES: ThemePackage[] = [
  {
    name: 'ggplot2',
    themes: [
      { id: '',                        label: 'Default',  bg: '#e8eaf0', panel: '#e8eaf0', border: '#888',    grid: '#cccccc' },
      { id: 'ggplot2::theme_gray',     label: 'Gray',     bg: '#ebebeb', panel: '#ebebeb', border: 'none',    grid: '#ffffff' },
      { id: 'ggplot2::theme_bw',       label: 'B & W',    bg: '#ffffff', panel: '#ffffff', border: '#333333', grid: '#dddddd' },
      { id: 'ggplot2::theme_linedraw', label: 'Linedraw', bg: '#ffffff', panel: '#ffffff', border: '#000000', grid: '#aaaaaa' },
      { id: 'ggplot2::theme_light',    label: 'Light',    bg: '#ffffff', panel: '#ffffff', border: '#cccccc', grid: '#eeeeee' },
      { id: 'ggplot2::theme_dark',     label: 'Dark',     bg: '#595959', panel: '#3a3a3a', border: '#595959', grid: '#424242' },
      { id: 'ggplot2::theme_minimal',  label: 'Minimal',  bg: '#ffffff', panel: '#ffffff', border: 'none',    grid: '#eeeeee' },
      { id: 'ggplot2::theme_classic',  label: 'Classic',  bg: '#ffffff', panel: '#ffffff', border: '#333333', grid: 'none'    },
      { id: 'ggplot2::theme_void',     label: 'Void',     bg: '#ffffff', panel: '#ffffff', border: 'none',    grid: 'none'    },
    ],
  },
  {
    name: 'ggthemes',
    themes: [
      { id: 'ggthemes::theme_economist',       label: 'Economist',   bg: '#d5e4eb', panel: '#d5e4eb', border: '#6794a7', grid: '#b2c4ce' },
      { id: 'ggthemes::theme_economist_white', label: 'Economist W', bg: '#ffffff', panel: '#ffffff', border: '#6794a7', grid: '#cbdde9' },
      { id: 'ggthemes::theme_fivethirtyeight', label: '538',         bg: '#f0f0f0', panel: '#f0f0f0', border: 'none',    grid: '#cbcbcb' },
      { id: 'ggthemes::theme_tufte',           label: 'Tufte',       bg: '#fffff8', panel: '#fffff8', border: 'none',    grid: 'none'    },
      { id: 'ggthemes::theme_wsj',             label: 'WSJ',         bg: '#f5efe1', panel: '#f5efe1', border: '#666666', grid: 'none'    },
      { id: 'ggthemes::theme_stata',           label: 'Stata',       bg: '#ebebeb', panel: '#ebebeb', border: '#888888', grid: '#ffffff' },
      { id: 'ggthemes::theme_excel_new',       label: 'Excel',       bg: '#ffffff', panel: '#ffffff', border: '#aeaaaa', grid: '#d6d6d6' },
      { id: 'ggthemes::theme_few',             label: 'Few',         bg: '#ffffff', panel: '#ffffff', border: '#333333', grid: '#e2e2e2' },
      { id: 'ggthemes::theme_gdocs',           label: 'Google',      bg: '#ffffff', panel: '#ffffff', border: '#999999', grid: '#dddddd' },
      { id: 'ggthemes::theme_hc',              label: 'Highcharts',  bg: '#ffffff', panel: '#ffffff', border: '#cccccc', grid: '#e6e6e6' },
      { id: 'ggthemes::theme_solarized',       label: 'Solarized',   bg: '#fdf6e3', panel: '#fdf6e3', border: '#93a1a1', grid: '#eee8d5' },
      { id: 'ggthemes::theme_pander',          label: 'Pander',      bg: '#ffffff', panel: '#ffffff', border: '#555555', grid: '#dddddd' },
      { id: 'ggthemes::theme_clean',           label: 'Clean',       bg: '#ffffff', panel: '#ffffff', border: '#333333', grid: '#bbbbbb' },
      { id: 'ggthemes::theme_base',            label: 'Base R',      bg: '#ffffff', panel: '#ffffff', border: '#333333', grid: '#ffffff' },
    ],
  },
  {
    name: 'hrbrthemes',
    themes: [
      { id: 'hrbrthemes::theme_ipsum',     label: 'ipsum',     bg: '#ffffff', panel: '#ffffff', border: 'none', grid: '#eeeeee' },
      { id: 'hrbrthemes::theme_ipsum_rc',  label: 'ipsum RC',  bg: '#f8f8f0', panel: '#f8f8f0', border: 'none', grid: '#e2e2e2' },
      { id: 'hrbrthemes::theme_ipsum_ps',  label: 'ipsum PS',  bg: '#ffffff', panel: '#ffffff', border: 'none', grid: '#eeeeee' },
      { id: 'hrbrthemes::theme_ipsum_pub', label: 'ipsum Pub', bg: '#ffffff', panel: '#ffffff', border: 'none', grid: '#eeeeee' },
      { id: 'hrbrthemes::theme_modern_rc', label: 'Modern RC', bg: '#252a32', panel: '#252a32', border: 'none', grid: '#3a3f4c' },
      { id: 'hrbrthemes::theme_ft_rc',     label: 'FT RC',     bg: '#1d2128', panel: '#1d2128', border: 'none', grid: '#2d3140' },
    ],
  },
  {
    name: 'cowplot',
    themes: [
      { id: 'cowplot::theme_cowplot',       label: 'Cowplot',   bg: '#ffffff', panel: '#ffffff', border: '#000000', grid: 'none'    },
      { id: 'cowplot::theme_minimal_grid',  label: 'Min. Grid', bg: '#ffffff', panel: '#ffffff', border: 'none',    grid: '#eeeeee' },
      { id: 'cowplot::theme_minimal_hgrid', label: 'H Grid',    bg: '#ffffff', panel: '#ffffff', border: 'none',    grid: '#eeeeee' },
      { id: 'cowplot::theme_minimal_vgrid', label: 'V Grid',    bg: '#ffffff', panel: '#ffffff', border: 'none',    grid: '#eeeeee' },
      { id: 'cowplot::theme_half_open',     label: 'Half Open', bg: '#ffffff', panel: '#ffffff', border: '#000000', grid: 'none'    },
    ],
  },
  {
    name: 'ggpubr',
    themes: [
      { id: 'ggpubr::theme_pubr',     label: 'Publication', bg: '#ffffff', panel: '#ffffff', border: '#000000', grid: 'none'    },
      { id: 'ggpubr::theme_pubclean', label: 'Pub Clean',   bg: '#ffffff', panel: '#ffffff', border: 'none',    grid: '#eeeeee' },
    ],
  },
]

// dark-panel themes need a lighter dot color so the scatter preview is visible
export const DARK_PANEL_THEMES = new Set(['ggplot2::theme_dark', 'hrbrthemes::theme_modern_rc', 'hrbrthemes::theme_ft_rc'])

