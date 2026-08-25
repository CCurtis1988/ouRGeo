export interface MonacoThemeDef {
  base: 'vs' | 'vs-dark'
  colors: Record<string, string>
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>
}

export interface ThemeDef {
  id: string
  label: string
  isDark: boolean
  monacoTheme: string
  monacoThemeDef: MonacoThemeDef
  mapStyle: string
  palette: { accent: string; error: string; success: string; muted: string }
  vars: Record<string, string>
  swatches: [string, string, string]
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

function mkMonaco(
  base: 'vs' | 'vs-dark',
  panel: string, bg: string, border: string,
  accent: string, muted: string, fg: string,
  str: string, cmt: string, kw: string, num: string, fn: string
): MonacoThemeDef {
  const strip = (h: string) => h.replace('#', '')
  return {
    base,
    colors: {
      'editor.background': panel,
      'editor.foreground': fg,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': fg,
      'editor.lineHighlightBackground': bg,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': accent + '40',
      'editorGutter.background': panel,
      'scrollbarSlider.background': border + '80',
      'editorIndentGuide.background1': border,
      'editorIndentGuide.activeBackground1': muted,
    },
    rules: [
      { token: 'string', foreground: strip(str) },
      { token: 'comment', foreground: strip(cmt), fontStyle: 'italic' },
      { token: 'keyword', foreground: strip(kw), fontStyle: 'bold' },
      { token: 'number', foreground: strip(num) },
      { token: 'identifier.function', foreground: strip(fn) },
      { token: 'type.identifier', foreground: strip(fn) },
      // Markdown / R Markdown. Monaco's markdown Monarch emits these tokens;
      // without rules they'd fall back to plain foreground and a .md would look
      // like undifferentiated text in every theme.
      { token: 'strong', foreground: strip(fg), fontStyle: 'bold' },
      { token: 'emphasis', foreground: strip(fg), fontStyle: 'italic' },
      { token: 'meta.separator', foreground: strip(cmt) },
      { token: 'keyword.table.header', foreground: strip(kw) },
      { token: 'keyword.table.left', foreground: strip(cmt) },
      { token: 'keyword.table.middle', foreground: strip(cmt) },
      { token: 'keyword.table.right', foreground: strip(cmt) },
      // Fenced-code bodies whose language isn't embedded (the chunk fallback).
      { token: 'variable.source', foreground: strip(fg) },
      { token: 'string.link', foreground: strip(accent) },
      { token: 'string.escape', foreground: strip(num) },
    ],
  }
}

export const THEMES: Record<string, ThemeDef> = {
  dark: {
    id: 'dark', label: 'Dark', isDark: true, monacoTheme: 'ourgeo-dark',
    vars: themeVars('220 30% 7%', '215 25% 11%', '214 17% 15%', '213 91% 62%', '212 100% 71%', '213 9% 59%', '131 48% 48%', '43 70% 47%', '1 92% 63%', '0 0% 93%'),
    swatches: ['#0f1117', '#4493f8', '#ededed'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#4493f8', error: '#f85149', success: '#3fb950', muted: '#8b949e' },
    monacoThemeDef: mkMonaco('vs-dark', '#161b22', '#0f1117', '#21262d', '#4493f8', '#8b949e', '#ededed',
      '#e6c47a', '#5c7a9e', '#79c9d9', '#f0a070', '#b088d8'),
  },
  bespin: {
    id: 'bespin', label: 'Bespin', isDark: true, monacoTheme: 'ourgeo-bespin',
    vars: themeVars('25 20% 12%', '25 17% 18%', '25 15% 28%', '37 92% 66%', '37 100% 75%', '30 22% 58%', '80 38% 55%', '37 80% 55%', '14 60% 55%', '35 50% 85%'),
    swatches: ['#231a10', '#f4a83a', '#dac9a5'],
    mapStyle: `${CARTO}/voyager-gl-style/style.json`,
    palette: { accent: '#f4a83a', error: '#c97850', success: '#8fa85e', muted: '#9a8060' },
    monacoThemeDef: mkMonaco('vs-dark', '#2d2015', '#231a10', '#4a3420', '#f4a83a', '#9a8060', '#dcc9a5',
      '#d4a96a', '#7d8a4f', '#f4a83a', '#d4b880', '#d88a50'),
  },
  neonLights: {
    id: 'neonLights', label: 'Neon Lights', isDark: true, monacoTheme: 'ourgeo-neon-lights',
    vars: themeVars('0 0% 5%', '0 0% 8%', '0 0% 18%', '180 100% 50%', '180 100% 60%', '0 0% 50%', '112 100% 54%', '50 100% 50%', '330 100% 50%', '0 0% 93%'),
    swatches: ['#0d0d0d', '#00ffff', '#ededed'],
    mapStyle: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
    palette: { accent: '#00ffff', error: '#ff0066', success: '#29fa1c', muted: '#808080' },
    monacoThemeDef: mkMonaco('vs-dark', '#141414', '#0d0d0d', '#2e2e2e', '#00ffff', '#808080', '#ededed',
      '#ff0088', '#006666', '#00ff88', '#ffff00', '#ff00ff'),
  },
  forest: {
    id: 'forest', label: 'Forest', isDark: true, monacoTheme: 'ourgeo-forest',
    vars: themeVars('138 30% 7%', '135 25% 11%', '135 22% 17%', '138 45% 42%', '138 45% 55%', '130 15% 55%', '120 45% 65%', '43 70% 47%', '5 70% 55%', '130 20% 88%'),
    swatches: ['#0b1a0d', '#3d8f42', '#d4e8d5'],
    mapStyle: `${CARTO}/voyager-gl-style/style.json`,
    palette: { accent: '#3d8f42', error: '#d44040', success: '#79c47e', muted: '#7a9a7e' },
    monacoThemeDef: mkMonaco('vs-dark', '#121e14', '#0b1a0d', '#1e3020', '#3d8f42', '#7a9a7e', '#d4e8d5',
      '#a8cc80', '#4a6e4e', '#5eaa62', '#c9b850', '#5abf88'),
  },
  midnightDream: {
    id: 'midnightDream', label: 'Midnight Dream', isDark: true, monacoTheme: 'ourgeo-midnight-dream',
    vars: themeVars('240 50% 6%', '240 40% 10%', '240 35% 18%', '260 80% 70%', '260 90% 80%', '240 20% 55%', '160 55% 55%', '45 85% 60%', '0 80% 65%', '240 50% 92%'),
    swatches: ['#060619', '#9966e6', '#dde0f5'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#9966e6', error: '#e04040', success: '#3db899', muted: '#7878a8' },
    monacoThemeDef: mkMonaco('vs-dark', '#0f0f2e', '#060619', '#1e1e4a', '#9966e6', '#7878a8', '#dde0f5',
      '#b899dd', '#4456aa', '#9966e6', '#55ccbb', '#6699ff'),
  },
  candyAddiction: {
    id: 'candyAddiction', label: 'Candy Addiction', isDark: true, monacoTheme: 'ourgeo-candy',
    vars: themeVars('285 40% 8%', '285 35% 13%', '285 30% 22%', '340 100% 60%', '340 100% 70%', '285 35% 55%', '145 85% 50%', '47 100% 60%', '15 100% 55%', '300 50% 92%'),
    swatches: ['#18091f', '#ff1a66', '#f0d5f7'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#ff1a66', error: '#ff5219', success: '#12e64a', muted: '#9966b3' },
    monacoThemeDef: mkMonaco('vs-dark', '#281033', '#18091f', '#432157', '#ff1a66', '#9966b3', '#f0d5f7',
      '#ff88aa', '#6633aa', '#ff1a66', '#ffcc00', '#cc66ff'),
  },
  heaven: {
    id: 'heaven', label: 'Heaven', isDark: false, monacoTheme: 'ourgeo-heaven',
    vars: themeVars('210 100% 97%', '0 0% 100%', '210 45% 80%', '210 80% 45%', '210 80% 35%', '215 25% 55%', '145 50% 40%', '43 80% 45%', '5 70% 52%', '215 35% 20%'),
    swatches: ['#f0f8ff', '#1a6fc7', '#2a3d57'],
    mapStyle: `${CARTO}/positron-gl-style/style.json`,
    palette: { accent: '#1a6fc7', error: '#cc3d32', success: '#33994f', muted: '#7a8fa8' },
    monacoThemeDef: mkMonaco('vs', '#ffffff', '#f0f8ff', '#a8c8e8', '#1a6fc7', '#7a8fa8', '#2a3d57',
      '#1a5599', '#7a8fa8', '#1a8080', '#cc5500', '#4455aa'),
  },
  volcanic: {
    id: 'volcanic', label: 'Volcanic', isDark: true, monacoTheme: 'ourgeo-volcanic',
    vars: themeVars('15 40% 5%', '15 35% 9%', '20 40% 16%', '22 100% 50%', '22 100% 60%', '20 18% 52%', '140 40% 45%', '38 85% 55%', '5 85% 55%', '30 45% 88%'),
    swatches: ['#130a05', '#ff6600', '#e0c9b0'],
    mapStyle: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
    palette: { accent: '#ff6600', error: '#e03c29', success: '#47a85e', muted: '#9a7f6e' },
    monacoThemeDef: mkMonaco('vs-dark', '#231009', '#130a05', '#3d1f0f', '#ff6600', '#9a7f6e', '#e9d3b8',
      '#ff9940', '#6e4020', '#ff6600', '#ffc040', '#e08030'),
  },
  arctic: {
    id: 'arctic', label: 'Arctic', isDark: true, monacoTheme: 'ourgeo-arctic',
    vars: themeVars('210 45% 8%', '210 40% 12%', '210 35% 20%', '195 85% 60%', '195 85% 70%', '210 25% 52%', '170 55% 52%', '45 75% 55%', '340 70% 58%', '205 60% 93%'),
    swatches: ['#0b1520', '#29c4e6', '#d4ecf7'],
    mapStyle: `${CARTO}/dark-matter-gl-style/style.json`,
    palette: { accent: '#29c4e6', error: '#d64070', success: '#35b89c', muted: '#7090a8' },
    monacoThemeDef: mkMonaco('vs-dark', '#112233', '#0b1520', '#1f3347', '#29c4e6', '#7090a8', '#d4ecf7',
      '#88d8ee', '#3a7088', '#29c4e6', '#aa88cc', '#35b8b8'),
  },
  retroTerminal: {
    id: 'retroTerminal', label: 'Retro Terminal', isDark: true, monacoTheme: 'ourgeo-retro-terminal',
    vars: themeVars('130 80% 3%', '130 60% 5%', '130 50% 12%', '120 100% 50%', '120 100% 65%', '130 40% 30%', '120 100% 50%', '45 100% 50%', '15 100% 55%', '120 60% 70%'),
    swatches: ['#030f03', '#00ff00', '#66cc66'],
    mapStyle: `${CARTO}/dark-matter-nolabels-gl-style/style.json`,
    palette: { accent: '#00ff00', error: '#ff5219', success: '#00ff00', muted: '#2d5c30' },
    monacoThemeDef: mkMonaco('vs-dark', '#051205', '#030f03', '#0f2e0f', '#00ff00', '#2d5c30', '#66cc66',
      '#00ff00', '#2d5c30', '#aaff00', '#ffff00', '#00ff88'),
  },
}

export const THEME_LIST: ThemeDef[] = Object.values(THEMES)

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
