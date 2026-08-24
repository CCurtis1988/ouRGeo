export type TextAlign       = 'left' | 'center' | 'right'
export type FontFace        = 'plain' | 'bold' | 'italic' | 'bold.italic'
export type MapPosition      = 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'
export type SideJustification = 'left' | 'center' | 'right' | 'top' | 'bottom'
export type TmapCompassType  = 'arrow' | '4star' | '8star' | 'radar' | 'rose'
export type LegendOrientation = 'portrait' | 'landscape'

// ---- ggplot-specific types ----
export type GgplotTheme           = 'void' | 'minimal' | 'classic' | 'bw' | 'gray' | 'linedraw' | 'light' | 'dark'
export type GgplotLegendPos       = 'right' | 'left' | 'top' | 'bottom' | 'none'
export type GgplotLegendDir       = 'vertical' | 'horizontal'
export type GgplotScaleStyle      = 'ticks' | 'bar'
export type GgplotUnitCategory    = 'metric' | 'imperial'
export type GgplotCornerPos       = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type GgplotNorthArrowStyle = 'open' | 'simple' | 'dot' | 'split'

export interface MapAnnotations {
  // Title
  showTitle:     boolean
  titleText:     string
  titleSize:     number
  titleFace:     FontFace
  titleColor:    string
  titleAlign:    TextAlign

  // Subtitle
  showSubtitle:  boolean
  subtitleText:  string
  subtitleSize:  number
  subtitleFace:  FontFace
  subtitleColor: string
  subtitleAlign: TextAlign

  // Caption / source
  showCaption:   boolean
  captionText:   string
  captionSize:   number
  captionFace:   FontFace
  captionColor:  string
  captionAlign:  TextAlign

  // Text justification — separate from *Align fields (which control placement side)
  titleJust:    TextAlign
  subtitleJust: TextAlign
  captionJust:  TextAlign

  // Map layout
  bgColor:         string
  showFrame:       boolean   // tmap only
  frameColor:      string    // tmap only, default '#000000'
  frameLwd:        number    // tmap only, default 1.0
  fontFamily:      string
  baseFontSize:    number

  // Margins (stored as %, divided by 100 in R code; 0 = tmap default)
  outerMarginTop:    number
  outerMarginRight:  number
  outerMarginBottom: number
  outerMarginLeft:   number
  innerMarginTop:    number
  innerMarginRight:  number
  innerMarginBottom: number
  innerMarginLeft:   number

  // Text-element placement (inside vs outside map frame)
  titlePosition:    'outside' | 'inside'
  subtitlePosition: 'outside' | 'inside'
  captionPosition:  'outside' | 'inside'

  // Legend — export-specific, pre-filled from spatial editor on dialog open
  showLegendExport:           boolean
  legendExportPosition:       MapPosition
  legendExportPositionIn:     boolean
  legendExportJustification:  SideJustification
  legendExportOrientation:    LegendOrientation
  legendExportTitle:       string
  legendExportTitleSize:   number
  legendExportTitleColor:  string
  legendExportTitleFace:   FontFace
  legendExportTextSize:    number
  legendExportTextColor:   string
  legendExportBgColor:     string
  legendExportBgAlpha:     number
  legendExportFrame:       boolean

  // Compass — export-specific, pre-filled from spatial editor on dialog open
  showCompassExport:           boolean
  compassExportType:           TmapCompassType
  compassExportPosition:       MapPosition
  compassExportPositionIn:     boolean
  compassExportJustification:  SideJustification
  compassExportSize:           number
  compassExportShowLabels:  boolean
  compassExportTextSize:    number
  compassExportColorDark:   string
  compassExportColorLight:  string

  // Scale bar
  showScalebar:          boolean
  scalebarPosition:      MapPosition
  scalebarPositionIn:    boolean
  scalebarJustification: SideJustification
  scalebarBreaks:        string
  scalebarTextSize:   number
  scalebarColorDark:  string
  scalebarColorLight: string
  scalebarLwd:        number

  // Graticules
  showGraticules:   boolean
  graticulesNX:     number
  graticulesNY:     number
  graticulesLabels: boolean
  graticulesLwd:    number
  graticulesColor:  string
  graticulesAlpha:  number

  // Layout additions
  outerBgColor: string   // '' = don't emit
  frameR:       number   // 0 = no rounding

  // ---- ggplot-specific export settings ----

  // Base theme
  ggplotTheme: GgplotTheme

  // Legend
  ggplotLegendPos:        GgplotLegendPos
  ggplotLegendDir:        GgplotLegendDir
  ggplotLegendTitle:      string   // '' = no override (column name used)
  ggplotLegendTitleSize:  number   // pt
  ggplotLegendTitleColor: string
  ggplotLegendTextSize:   number   // pt
  ggplotLegendTextColor:  string
  ggplotLegendBgColor:    string
  ggplotLegendBgAlpha:    number   // 0–1
  ggplotLegendFrame:      boolean

  // North arrow (export-specific override, pre-filled from store on dialog open)
  showNorthArrowExport:  boolean
  northArrowExportStyle: GgplotNorthArrowStyle
  northArrowExportPos:   GgplotCornerPos
  northArrowExportSize:  number    // cm

  // Scale bar (ggspatial::annotation_scale)
  showScalebarGgplot:      boolean
  scalebarGgplotPos:       GgplotCornerPos
  scalebarGgplotStyle:     GgplotScaleStyle
  scalebarGgplotUnits:     GgplotUnitCategory
  scalebarGgplotWidthHint: number   // 0.1–0.5
  scalebarGgplotTextCex:   number   // 0.3–2.0

  // Graticules (coord_sf datum + panel.grid.major)
  showGraticulesGgplot:   boolean
  graticulesGgplotColor:  string
  graticulesGgplotAlpha:  number   // 0–1
  graticulesGgplotLwd:    number   // pt

  // Panel frame (panel.border)
  showPanelBorder:  boolean
  panelBorderColor: string
  panelBorderLwd:   number   // pt
}

export const DEFAULT_MAP_ANNOTATIONS: MapAnnotations = {
  showTitle:     false,
  titleText:     'Map Title',
  titleSize:     16,
  titleFace:     'bold',
  titleColor:    '#000000',
  titleAlign:    'center',

  showSubtitle:  false,
  subtitleText:  '',
  subtitleSize:  12,
  subtitleFace:  'plain',
  subtitleColor: '#555555',
  subtitleAlign: 'center',

  showCaption:   false,
  captionText:   'Source: ',
  captionSize:   9,
  captionFace:   'plain',
  captionColor:  '#777777',
  captionAlign:  'left',

  titleJust:    'center',
  subtitleJust: 'center',
  captionJust:  'left',

  bgColor:         '#ffffff',
  showFrame:       false,
  frameColor:      '#000000',
  frameLwd:        1.0,
  fontFamily:      'sans',
  baseFontSize:    12,

  outerMarginTop:    0,
  outerMarginRight:  0,
  outerMarginBottom: 0,
  outerMarginLeft:   0,
  innerMarginTop:    0,
  innerMarginRight:  0,
  innerMarginBottom: 0,
  innerMarginLeft:   0,

  titlePosition:    'outside',
  subtitlePosition: 'outside',
  captionPosition:  'inside',

  showLegendExport:           false,
  legendExportPosition:       'bottom-right',
  legendExportPositionIn:     true,
  legendExportJustification:  'center',
  legendExportOrientation:    'portrait',
  legendExportTitle:       '',
  legendExportTitleSize:   1.0,
  legendExportTitleColor:  '#000000',
  legendExportTitleFace:   'plain',
  legendExportTextSize:    0.8,
  legendExportTextColor:   '#000000',
  legendExportBgColor:     '#ffffff',
  legendExportBgAlpha:     0.7,
  legendExportFrame:       false,

  showCompassExport:           false,
  compassExportType:           'arrow',
  compassExportPosition:       'top-right',
  compassExportPositionIn:     true,
  compassExportJustification:  'center',
  compassExportSize:           1.0,
  compassExportShowLabels:  true,
  compassExportTextSize:    0.8,
  compassExportColorDark:   '#000000',
  compassExportColorLight:  '#ffffff',

  showScalebar:          false,
  scalebarPosition:      'bottom-left',
  scalebarPositionIn:    true,
  scalebarJustification: 'center',
  scalebarBreaks:        '',
  scalebarTextSize:   0.7,
  scalebarColorDark:  '#000000',
  scalebarColorLight: '#ffffff',
  scalebarLwd:        1.0,

  showGraticules:   false,
  graticulesNX:     5,
  graticulesNY:     5,
  graticulesLabels: true,
  graticulesLwd:    0.5,
  graticulesColor:  '#888888',
  graticulesAlpha:  0.4,

  outerBgColor: '',
  frameR:       0,

  ggplotTheme:              'void',
  ggplotLegendPos:          'right',
  ggplotLegendDir:          'vertical',
  ggplotLegendTitle:        '',
  ggplotLegendTitleSize:    11,
  ggplotLegendTitleColor:   '#000000',
  ggplotLegendTextSize:     9,
  ggplotLegendTextColor:    '#000000',
  ggplotLegendBgColor:      '#ffffff',
  ggplotLegendBgAlpha:      1.0,
  ggplotLegendFrame:        false,
  showNorthArrowExport:    false,
  northArrowExportStyle:   'split',
  northArrowExportPos:     'top-right',
  northArrowExportSize:    1.5,
  showScalebarGgplot:      false,
  scalebarGgplotPos:       'bottom-left',
  scalebarGgplotStyle:     'ticks',
  scalebarGgplotUnits:     'metric',
  scalebarGgplotWidthHint: 0.25,
  scalebarGgplotTextCex:   0.7,
  showGraticulesGgplot:    false,
  graticulesGgplotColor:   '#888888',
  graticulesGgplotAlpha:   0.5,
  graticulesGgplotLwd:     0.3,
  showPanelBorder:         false,
  panelBorderColor:        '#000000',
  panelBorderLwd:          0.5,
}

export const FONT_FAMILIES = [
  { value: 'sans',             label: 'Sans (default)' },
  { value: 'serif',            label: 'Serif' },
  { value: 'mono',             label: 'Monospace' },
  { value: 'Helvetica',        label: 'Helvetica' },
  { value: 'Arial',            label: 'Arial' },
  { value: 'Times New Roman',  label: 'Times New Roman' },
  { value: 'Courier',          label: 'Courier' },
  { value: 'Palatino',         label: 'Palatino' },
]

/** ggplot hjust value for align string */
export function alignToHjust(align: TextAlign): number {
  return align === 'left' ? 0 : align === 'right' ? 1 : 0.5
}

/** tmap horizontal position string */
export function alignToTmapPos(align: TextAlign): string {
  return align === 'left' ? '"left"' : align === 'right' ? '"right"' : '"center"'
}

/** Whether any layout option differs from defaults (drives tm_layout / theme emission) */
export function hasLayoutChanges(a: MapAnnotations): boolean {
  return (
    a.bgColor !== '#ffffff' ||
    a.showFrame ||
    a.fontFamily !== 'sans' ||
    a.baseFontSize !== 12 ||
    a.frameLwd !== 1.0 ||
    a.frameColor !== '#000000' ||
    a.outerMarginTop !== 0 || a.outerMarginRight !== 0 ||
    a.outerMarginBottom !== 0 || a.outerMarginLeft !== 0 ||
    a.innerMarginTop !== 0 || a.innerMarginRight !== 0 ||
    a.innerMarginBottom !== 0 || a.innerMarginLeft !== 0 ||
    a.outerBgColor !== '' ||
    a.frameR !== 0
  )
}
