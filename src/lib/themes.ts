export interface ThemeDef {
  id: string
  label: string
  isDark: boolean
  /** Monaco's workbench colours for this theme. The EDITOR themes (see
   *  `editor-themes.ts`) supply token colours only — the surface the code sits
   *  on is the system theme's business, so switching a code or markdown theme
   *  can never move the background or the scene art. */
  editorChrome: EditorChrome
  /** Which code / markdown theme this app theme starts from. Switching the app
   *  theme resets both to these (see `setTheme` in `src/store/theme.ts`). */
  defaultCodeTheme: string
  defaultMarkdownTheme: string
  /** Historic. MapView resolves its basemap through `themeDefaultBasemap()` in
   *  `basemaps.ts`, not from here; kept because the shipped themes carry it. */
  mapStyle?: string
  palette: { accent: string; error: string; success: string; muted: string }
  vars: Record<string, string>
  swatches: [string, string, string]

  // ── User themes ────────────────────────────────────────────────────────
  // Everything below is absent on the shipped themes and present on themes
  // built in the Theme Studio (`src/lib/custom-themes.ts`). Keeping them on
  // ThemeDef rather than on a subtype is deliberate: every consumer already
  // looks a theme up by id and reads fields off the result, so a user theme
  // has to BE a ThemeDef or each of those call sites grows a branch.

  /** Marks a theme the user made. Drives the "Custom" badge and Delete. */
  custom?: true
  /** Original palette/SVG version, kept in the collapsed legacy collection. */
  legacy?: true
  /** The shipped theme this one was started from. Supplies the generated scene
   *  art when the user has not uploaded a background image of their own. */
  basedOn?: string
  /** Basemap id (see `BASEMAPS_BY_ID`) the Spatial Editor opens with. */
  defaultBasemap?: string
  /** A `data:` URI. Replaces the generated scene behind the code editor. */
  backgroundImage?: string | null
  /** How strongly that backdrop is painted, 0–1. Generated scenes default to 0.15. */
  backgroundOpacity?: number
  /** Whether the backdrop is grey-scaled. Generated scenes are; paintings retain colour. */
  backgroundGrayscale?: boolean
  /** A `data:` URI shown on the theme's card in the App Theme picker. Falls
   *  back to the background image, then to the generated scene. */
  iconImage?: string | null
}

/** The six hexes Monaco needs for the editor surface. Hex, not the HSL triples
 *  in `vars`, because Monaco's theme API takes colour literals. */
export interface EditorChrome {
  panel: string
  bg: string
  border: string
  accent: string
  muted: string
  fg: string
}

const themeVars = (
  bg: string, panel: string, border: string,
  accent: string, accentHover: string, muted: string,
  success: string, warning: string, error: string, fg: string
): Record<string, string> => ({
  '--geo-bg': bg,
  '--geo-panel': panel,
  '--geo-border': border,
  '--geo-accent': accent,
  '--geo-accent-hover': accentHover,
  '--geo-muted': muted,
  '--geo-success': success,
  '--geo-warning': warning,
  '--geo-error': error,
  '--geo-fg': fg,
})

const CARTO = 'https://basemaps.cartocdn.com/gl'

const chrome = (
  panel: string, bg: string, border: string, accent: string, muted: string, fg: string
): EditorChrome => ({ panel, bg, border, accent, muted, fg })

const ORIGINAL_THEMES: Record<string, ThemeDef> = {
  dark: {
    id: 'dark', label: 'Dark', isDark: true,
    defaultCodeTheme: 'dark', defaultMarkdownTheme: 'dark',
    vars: themeVars('220 30% 7%', '215 25% 11%', '214 17% 15%', '213 91% 62%', '212 100% 71%', '213 9% 59%', '131 48% 48%', '43 70% 47%', '1 92% 63%', '0 0% 93%'),
    swatches: ['#0f1117', '#4493f8', '#ededed'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#4493f8', error: '#f85149', success: '#3fb950', muted: '#8b949e' },
    editorChrome: chrome('#161b22', '#0f1117', '#21262d', '#4493f8', '#8b949e', '#ededed'),
  },
  bespin: {
    id: 'bespin', label: 'Bespin', isDark: true,
    defaultCodeTheme: 'bespin', defaultMarkdownTheme: 'bespin',
    vars: themeVars('25 20% 12%', '25 17% 18%', '25 15% 28%', '37 92% 66%', '37 100% 75%', '30 22% 58%', '80 38% 55%', '37 80% 55%', '14 60% 55%', '35 50% 85%'),
    swatches: ['#231a10', '#f4a83a', '#dac9a5'],
    mapStyle: `${CARTO}/voyager-gl-style/style.json`,
    palette: { accent: '#f4a83a', error: '#c97850', success: '#8fa85e', muted: '#9a8060' },
    editorChrome: chrome('#2d2015', '#231a10', '#4a3420', '#f4a83a', '#9a8060', '#dcc9a5'),
  },
  neonLights: {
    id: 'neonLights', label: 'Neon Lights', isDark: true,
    defaultCodeTheme: 'neonLights', defaultMarkdownTheme: 'neonLights',
    vars: themeVars('0 0% 5%', '0 0% 8%', '0 0% 18%', '180 100% 50%', '180 100% 60%', '0 0% 50%', '112 100% 54%', '50 100% 50%', '330 100% 50%', '0 0% 93%'),
    swatches: ['#0d0d0d', '#00ffff', '#ededed'],
    mapStyle: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
    palette: { accent: '#00ffff', error: '#ff0066', success: '#29fa1c', muted: '#808080' },
    editorChrome: chrome('#141414', '#0d0d0d', '#2e2e2e', '#00ffff', '#808080', '#ededed'),
  },
  forest: {
    id: 'forest', label: 'Forest', isDark: true,
    defaultCodeTheme: 'forest', defaultMarkdownTheme: 'forest',
    vars: themeVars('138 30% 7%', '135 25% 11%', '135 22% 17%', '138 45% 42%', '138 45% 55%', '130 15% 55%', '120 45% 65%', '43 70% 47%', '5 70% 55%', '130 20% 88%'),
    swatches: ['#0b1a0d', '#3d8f42', '#d4e8d5'],
    mapStyle: `${CARTO}/voyager-gl-style/style.json`,
    palette: { accent: '#3d8f42', error: '#d44040', success: '#79c47e', muted: '#7a9a7e' },
    editorChrome: chrome('#121e14', '#0b1a0d', '#1e3020', '#3d8f42', '#7a9a7e', '#d4e8d5'),
  },
  midnightDream: {
    id: 'midnightDream', label: 'Midnight Dream', isDark: true,
    defaultCodeTheme: 'midnightDream', defaultMarkdownTheme: 'midnightDream',
    vars: themeVars('240 50% 6%', '240 40% 10%', '240 35% 18%', '260 80% 70%', '260 90% 80%', '240 20% 55%', '160 55% 55%', '45 85% 60%', '0 80% 65%', '240 50% 92%'),
    swatches: ['#060619', '#9966e6', '#dde0f5'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#9966e6', error: '#e04040', success: '#3db899', muted: '#7878a8' },
    editorChrome: chrome('#0f0f2e', '#060619', '#1e1e4a', '#9966e6', '#7878a8', '#dde0f5'),
  },
  candyAddiction: {
    id: 'candyAddiction', label: 'Candy Addiction', isDark: true,
    defaultCodeTheme: 'candyAddiction', defaultMarkdownTheme: 'candyAddiction',
    vars: themeVars('285 40% 8%', '285 35% 13%', '285 30% 22%', '340 100% 60%', '340 100% 70%', '285 35% 55%', '145 85% 50%', '47 100% 60%', '15 100% 55%', '300 50% 92%'),
    swatches: ['#18091f', '#ff1a66', '#f0d5f7'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#ff1a66', error: '#ff5219', success: '#12e64a', muted: '#9966b3' },
    editorChrome: chrome('#281033', '#18091f', '#432157', '#ff1a66', '#9966b3', '#f0d5f7'),
  },
  heaven: {
    id: 'heaven', label: 'Heaven', isDark: false,
    defaultCodeTheme: 'heaven', defaultMarkdownTheme: 'heaven',
    vars: themeVars('210 100% 97%', '0 0% 100%', '210 45% 80%', '210 80% 45%', '210 80% 35%', '215 25% 55%', '145 50% 40%', '43 80% 45%', '5 70% 52%', '215 35% 20%'),
    swatches: ['#f0f8ff', '#1a6fc7', '#2a3d57'],
    mapStyle: `${CARTO}/positron-gl-style/style.json`,
    palette: { accent: '#1a6fc7', error: '#cc3d32', success: '#33994f', muted: '#7a8fa8' },
    editorChrome: chrome('#ffffff', '#f0f8ff', '#a8c8e8', '#1a6fc7', '#7a8fa8', '#2a3d57'),
  },
  volcanic: {
    id: 'volcanic', label: 'Volcanic', isDark: true,
    defaultCodeTheme: 'volcanic', defaultMarkdownTheme: 'volcanic',
    vars: themeVars('15 40% 5%', '15 35% 9%', '20 40% 16%', '22 100% 50%', '22 100% 60%', '20 18% 52%', '140 40% 45%', '38 85% 55%', '5 85% 55%', '30 45% 88%'),
    swatches: ['#130a05', '#ff6600', '#e0c9b0'],
    mapStyle: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
    palette: { accent: '#ff6600', error: '#e03c29', success: '#47a85e', muted: '#9a7f6e' },
    editorChrome: chrome('#231009', '#130a05', '#3d1f0f', '#ff6600', '#9a7f6e', '#e9d3b8'),
  },
  arctic: {
    id: 'arctic', label: 'Arctic', isDark: true,
    defaultCodeTheme: 'arctic', defaultMarkdownTheme: 'arctic',
    vars: themeVars('210 45% 8%', '210 40% 12%', '210 35% 20%', '195 85% 60%', '195 85% 70%', '210 25% 52%', '170 55% 52%', '45 75% 55%', '340 70% 58%', '205 60% 93%'),
    swatches: ['#0b1520', '#29c4e6', '#d4ecf7'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#29c4e6', error: '#d64070', success: '#35b89c', muted: '#7090a8' },
    editorChrome: chrome('#112233', '#0b1520', '#1f3347', '#29c4e6', '#7090a8', '#d4ecf7'),
  },
  retroTerminal: {
    id: 'retroTerminal', label: 'Retro Terminal', isDark: true,
    defaultCodeTheme: 'retroTerminal', defaultMarkdownTheme: 'retroTerminal',
    vars: themeVars('130 80% 3%', '130 60% 5%', '130 50% 12%', '120 100% 50%', '120 100% 65%', '130 40% 30%', '120 100% 50%', '45 100% 50%', '15 100% 55%', '120 60% 70%'),
    swatches: ['#030f03', '#00ff00', '#66cc66'],
    mapStyle: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
    palette: { accent: '#00ff00', error: '#ff5219', success: '#00ff00', muted: '#2d5c30' },
    editorChrome: chrome('#051205', '#030f03', '#0f2e0f', '#00ff00', '#2d5c30', '#66cc66'),
  },
}

// Stable existing ids keep the painted themes. Legacy variants retain the
// original surfaces, generated scenes and syntax defaults under separate ids.
const BUILTIN: Record<string, ThemeDef> = {
  ...ORIGINAL_THEMES,
  heaven: { ...ORIGINAL_THEMES.heaven, backgroundOpacity: 0.30 },
  ...Object.fromEntries(Object.values(ORIGINAL_THEMES).map(theme => [
    `legacy-${theme.id}`,
    { ...theme, id: `legacy-${theme.id}`, label: `${theme.label} (Legacy)`, legacy: true as const, basedOn: theme.id },
  ])),
}

/** The themes ouRGeo ships. Never mutated. */
export const BUILTIN_THEMES: Readonly<Record<string, ThemeDef>> = BUILTIN

/** The themes ouRGeo ships, in menu order. */
export const BUILTIN_THEME_LIST: ThemeDef[] = Object.values(BUILTIN)

/**
 * The LIVE registry: the shipped themes plus whatever the user has built in
 * the Theme Studio. Mutable on purpose — every `THEMES[id]` lookup in the app
 * (the map, the drawing layer, Monaco's chrome, the scene art) has to see a
 * user theme the moment it is registered, and rewriting forty call sites to
 * ask a resolver instead would have been the same thing with more ceremony.
 *
 * Only `registerCustomThemes` writes to it. Because the object identity never
 * changes, React components must not read the list from here — they subscribe
 * to `useCustomThemeStore` and call `themeList()`.
 */
export const THEMES: Record<string, ThemeDef> = { ...BUILTIN }

/** The live list, shipped first then the user's. Call this, don't cache it. */
export function themeList(): ThemeDef[] {
  return Object.values(THEMES)
}

/**
 * Replace every user theme in the registry with `custom`, in one pass.
 *
 * Deleting first is what makes this idempotent: the store re-registers the
 * whole set after every edit, so a theme the user renamed or removed has to
 * leave the registry, and a diff would have to track ids it does not own.
 * Shipped ids are never touched — a user theme that somehow carried the id
 * `dark` is dropped rather than allowed to shadow it.
 */
export function registerCustomThemes(custom: ThemeDef[]): void {
  for (const id of Object.keys(THEMES)) {
    if (!(id in BUILTIN)) delete THEMES[id]
  }
  for (const t of custom) {
    if (t.id in BUILTIN) continue
    THEMES[t.id] = t
  }
}

export function applyTheme(id: string): void {
  const t = THEMES[id] ?? THEMES.dark
  const root = document.documentElement
  for (const [k, v] of Object.entries(t.vars)) {
    root.style.setProperty(k, v)
  }
  root.classList.toggle('dark', t.isDark)

  // Update shadcn base variables for light theme compatibility
  if (!t.isDark) {
    root.style.setProperty('--background', t.vars['--geo-bg'])
    root.style.setProperty('--foreground', t.vars['--geo-fg'])
    root.style.setProperty('--border', t.vars['--geo-border'])
  } else {
    root.style.removeProperty('--background')
    root.style.removeProperty('--foreground')
    root.style.removeProperty('--border')
  }
}
