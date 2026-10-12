// ── Themed scene illustrations ────────────────────────────────────────────
// Shipped themes use bundled cinematic paintings. Keep the palette-based SVG
// generator for custom themes so their existing artwork never changes.

import { THEMES, type ThemeDef } from './themes'

// Static URLs let Vite package the images for offline Electron use. Deliberately
// keyed by shipped id only: custom themes must not inherit these via basedOn.
const BUILTIN_ART: Readonly<Record<string, string>> = {
  dark: new URL('../assets/themes/dark.webp', import.meta.url).href,
  bespin: new URL('../assets/themes/bespin.webp', import.meta.url).href,
  neonLights: new URL('../assets/themes/neonLights.webp', import.meta.url).href,
  forest: new URL('../assets/themes/forest.webp', import.meta.url).href,
  midnightDream: new URL('../assets/themes/midnightDream.webp', import.meta.url).href,
  candyAddiction: new URL('../assets/themes/candyAddiction.webp', import.meta.url).href,
  heaven: new URL('../assets/themes/heaven.webp', import.meta.url).href,
  volcanic: new URL('../assets/themes/volcanic.webp', import.meta.url).href,
  arctic: new URL('../assets/themes/arctic.webp', import.meta.url).href,
  retroTerminal: new URL('../assets/themes/retroTerminal.webp', import.meta.url).href,
}

export interface ScenePalette {
  bg: string
  accent: string
  /** The theme's brightest "detail" colour (icy white on dark themes). */
  fg: string
  success: string
  /** A contrasting warm colour (the theme's error hue). */
  warm: string
  muted: string
}

function pal(t: ThemeDef): ScenePalette {
  return {
    bg: t.swatches[0],
    accent: t.palette.accent,
    fg: t.swatches[2],
    success: t.palette.success,
    warm: t.palette.error,
    muted: t.palette.muted,
  }
}

// ── small drawing helpers ──────────────────────────────────────────────────
const dots = (pts: [number, number, number][], color: string, opacity = 1): string =>
  pts
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${opacity}"/>`)
    .join('')

const cloud = (x: number, y: number, color: string, opacity = 0.85): string =>
  `<g fill="${color}" opacity="${opacity}"><ellipse cx="${x}" cy="${y}" rx="16" ry="7"/>` +
  `<ellipse cx="${x - 10}" cy="${y + 2}" rx="10" ry="6"/>` +
  `<ellipse cx="${x + 11}" cy="${y + 2}" rx="11" ry="6"/></g>`

const crescent = (x: number, y: number, r: number, bg: string, color: string): string =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.92"/>` +
  `<circle cx="${x - r * 0.4}" cy="${y - r * 0.3}" r="${r}" fill="${bg}"/>`

const skyGrad = (id: string, top: string, bottom: string, bottomOpacity = 1): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${top}"/>` +
  `<stop offset="1" stop-color="${bottom}" stop-opacity="${bottomOpacity}"/></linearGradient>`

type SceneFn = (p: ScenePalette, id: string) => string

const SCENES: Record<string, SceneFn> = {
  arctic: (p, id) => `
    <defs>${skyGrad(`${id}-sky`, p.bg, p.accent, 0.35)}</defs>
    <rect width="160" height="90" fill="url(#${id}-sky)"/>
    ${dots([[20, 14, 0.8], [42, 9, 0.6], [130, 12, 0.8], [110, 20, 0.5], [70, 8, 0.6]], p.fg)}
    <path d="M0 40 Q 30 22 60 34 T 120 30 T 160 40 L160 60 L0 60Z" fill="${p.accent}" opacity="0.18"/>
    <path d="M0 46 Q 40 30 80 42 T 160 40 L160 62 L0 62Z" fill="${p.success}" opacity="0.16"/>
    <polygon points="0,74 34,46 60,74" fill="${p.muted}" opacity="0.55"/>
    <polygon points="40,74 78,40 120,74" fill="${p.fg}" opacity="0.85"/>
    <polygon points="100,74 130,50 160,74" fill="${p.muted}" opacity="0.6"/>
    <polygon points="68,50 78,40 88,50" fill="#ffffff" opacity="0.75"/>
    <rect y="72" width="160" height="18" fill="${p.fg}" opacity="0.9"/>`,

  forest: (p, id) => `
    <defs>${skyGrad(`${id}-sky`, p.bg, p.success, 0.4)}</defs>
    <rect width="160" height="90" fill="url(#${id}-sky)"/>
    <circle cx="128" cy="22" r="18" fill="${p.accent}" opacity="0.2"/>
    <circle cx="128" cy="22" r="11" fill="${p.accent}" opacity="0.85"/>
    <path d="M0 60 Q 40 44 80 58 T 160 56 L160 90 L0 90Z" fill="${p.muted}" opacity="0.35"/>
    ${[10, 30, 50, 70, 90, 110, 130, 150]
      .map((x) => `<polygon points="${x - 6},70 ${x},48 ${x + 6},70" fill="${p.success}" opacity="0.5"/>`)
      .join('')}
    ${[0, 20, 40, 60, 80, 100, 120, 140, 160]
      .map((x) => `<polygon points="${x - 8},84 ${x},54 ${x + 8},84" fill="${p.accent}" opacity="0.9"/>`)
      .join('')}
    <rect y="82" width="160" height="8" fill="${p.success}" opacity="0.6"/>`,

  volcanic: (p, id) => `
    <defs><radialGradient id="${id}-glow" cx="0.5" cy="0.25" r="0.7">
      <stop offset="0" stop-color="${p.accent}" stop-opacity="0.7"/>
      <stop offset="1" stop-color="${p.bg}" stop-opacity="0"/></radialGradient></defs>
    <rect width="160" height="90" fill="${p.bg}"/>
    <rect width="160" height="62" fill="url(#${id}-glow)"/>
    ${dots([[16, 12, 0.7], [140, 10, 0.7], [58, 8, 0.5]], p.fg)}
    <polygon points="30,90 80,28 130,90" fill="${p.muted}" opacity="0.75"/>
    <polygon points="66,44 80,28 94,44 88,52 72,52" fill="${p.warm}"/>
    <path d="M78 46 Q 74 66 82 90 L92 90 Q 86 64 84 46Z" fill="${p.accent}"/>
    ${dots([[80, 20, 1.7], [72, 16, 1], [90, 18, 1.2], [84, 10, 0.9], [76, 8, 0.7]], p.accent)}
    <ellipse cx="80" cy="88" rx="72" ry="6" fill="${p.warm}" opacity="0.25"/>`,

  bespin: (p, id) => `
    <defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.bg}"/>
      <stop offset="0.6" stop-color="${p.accent}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${p.warm}" stop-opacity="0.6"/></linearGradient></defs>
    <rect width="160" height="90" fill="url(#${id}-sky)"/>
    <circle cx="80" cy="72" r="44" fill="${p.accent}" opacity="0.2"/>
    <circle cx="80" cy="72" r="34" fill="${p.accent}" opacity="0.9"/>
    <ellipse cx="58" cy="30" rx="55" ry="4" fill="${p.fg}" opacity="0.5"/>
    <ellipse cx="110" cy="42" rx="46" ry="4" fill="${p.warm}" opacity="0.45"/>
    <ellipse cx="40" cy="52" rx="40" ry="3.5" fill="${p.fg}" opacity="0.4"/>
    <ellipse cx="120" cy="60" rx="38" ry="3.5" fill="${p.warm}" opacity="0.4"/>`,

  neonLights: (p, _id) => {
    const buildings: [number, number][] = [
      [6, 40], [24, 55], [40, 30], [54, 60], [70, 44],
      [86, 64], [104, 36], [120, 58], [136, 48], [150, 68],
    ]
    const win: string[] = []
    buildings.forEach(([x, h], i) => {
      for (let yy = 90 - h + 4; yy < 86; yy += 8) {
        for (let xx = x + 2; xx < x + 10; xx += 4) {
          if ((xx + yy + i) % 3 === 0) {
            win.push(`<rect x="${xx}" y="${yy}" width="2" height="2" fill="${i % 2 ? p.accent : p.warm}"/>`)
          }
        }
      }
    })
    return `
    <rect width="160" height="90" fill="${p.bg}"/>
    <ellipse cx="80" cy="90" rx="90" ry="30" fill="${p.accent}" opacity="0.12"/>
    ${buildings.map(([x, h]) => `<rect x="${x}" y="${90 - h}" width="12" height="${h}" fill="#000000" opacity="0.55"/>`).join('')}
    ${win.join('')}`
  },

  dark: (p, id) => `
    <defs>${skyGrad(`${id}-sky`, p.bg, p.accent, 0.18)}</defs>
    <rect width="160" height="90" fill="url(#${id}-sky)"/>
    ${crescent(120, 26, 13, p.bg, p.fg)}
    ${dots([[20, 16, 0.8], [40, 28, 0.6], [60, 12, 0.7], [80, 22, 0.5], [100, 10, 0.6], [140, 44, 0.6], [30, 46, 0.5]], p.fg)}
    <path d="M0 66 Q 40 52 80 64 T 160 62 L160 90 L0 90Z" fill="${p.muted}" opacity="0.3"/>
    <path d="M0 76 Q 50 64 100 74 T 160 74 L160 90 L0 90Z" fill="${p.accent}" opacity="0.25"/>`,

  midnightDream: (p, id) => `
    <defs>${skyGrad(`${id}-sky`, p.bg, p.accent, 0.4)}</defs>
    <rect width="160" height="90" fill="url(#${id}-sky)"/>
    ${crescent(34, 26, 11, p.bg, p.fg)}
    ${dots([[70, 14, 0.7], [90, 24, 0.6], [110, 12, 0.8], [130, 28, 0.6], [60, 32, 0.5], [100, 40, 0.5], [145, 18, 0.7], [80, 8, 0.6]], p.fg)}
    <path d="M96 20 L112 12" stroke="${p.fg}" stroke-width="1" opacity="0.7"/>
    <path d="M0 60 Q 40 46 80 58 T 160 56 L160 90 L0 90Z" fill="${p.accent}" opacity="0.3"/>
    <path d="M0 72 Q 50 60 100 70 T 160 70 L160 90 L0 90Z" fill="${p.muted}" opacity="0.35"/>`,

  candyAddiction: (p, id) => `
    <defs>${skyGrad(`${id}-sky`, p.bg, p.accent, 0.5)}</defs>
    <rect width="160" height="90" fill="url(#${id}-sky)"/>
    ${dots([[24, 18, 4], [60, 12, 3], [100, 20, 3.5], [136, 14, 4], [44, 30, 2.5], [120, 32, 2.5]], p.warm)}
    ${dots([[24, 18, 2], [100, 20, 1.6], [136, 14, 2]], p.fg)}
    <path d="M0 66 Q 30 48 60 66 T 120 66 T 180 66 L180 90 L0 90Z" fill="${p.warm}" opacity="0.6"/>
    <path d="M-20 78 Q 20 62 60 78 T 140 78 T 200 78 L200 90 L-20 90Z" fill="${p.accent}" opacity="0.7"/>
    <path d="M0 84 Q 40 74 80 84 T 160 84 L160 90 L0 90Z" fill="${p.success}" opacity="0.55"/>`,

  heaven: (p, id) => {
    const rays = Array.from({ length: 12 })
      .map((_, i) => {
        const a = (i * Math.PI) / 6
        const x1 = (80 + Math.cos(a) * 16).toFixed(1)
        const y1 = (34 + Math.sin(a) * 16).toFixed(1)
        const x2 = (80 + Math.cos(a) * 24).toFixed(1)
        const y2 = (34 + Math.sin(a) * 24).toFixed(1)
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.accent}" stroke-width="1.5" opacity="0.45"/>`
      })
      .join('')
    return `
    <defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.accent}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${p.bg}"/></linearGradient></defs>
    <rect width="160" height="90" fill="url(#${id}-sky)"/>
    ${rays}
    <circle cx="80" cy="34" r="12" fill="${p.accent}"/>
    ${cloud(30, 58, '#ffffff')}
    ${cloud(112, 50, '#ffffff')}
    ${cloud(72, 76, '#ffffff')}`
  },

  retroTerminal: (p, id) => {
    const scan = Array.from({ length: 22 })
      .map((_, i) => `<rect x="0" y="${i * 4}" width="160" height="2" fill="${p.accent}" opacity="0.06"/>`)
      .join('')
    const code: [number, number, number][] = [
      [14, 14, 40], [24, 26, 22], [50, 26, 70], [14, 38, 30],
      [24, 50, 54], [82, 50, 60], [14, 62, 20], [24, 74, 46],
    ]
    const lines = code
      .map(([x, y, w], i) => `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1" fill="${p.accent}" opacity="${(0.5 - (i % 3) * 0.08).toFixed(2)}"/>`)
      .join('')
    return `
    <defs><radialGradient id="${id}-vig" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stop-color="${p.bg}" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.6"/></radialGradient></defs>
    <rect width="160" height="90" fill="${p.bg}"/>
    ${scan}
    ${lines}
    <rect x="14" y="82" width="8" height="5" fill="${p.success}"/>
    <rect width="160" height="90" fill="url(#${id}-vig)"/>`
  },
}

/** Raw SVG markup for a theme's scene, drawn in that theme's own colours.
 *
 *  A user theme has no scene of its own, so it borrows the drawing of the
 *  shipped theme it was started from (`basedOn`) and gets it recoloured from
 *  its own palette — which is why a theme built on Arctic reads as a snowfield
 *  in the user's blues rather than as a blank card. */
export function sceneSvg(themeId: string): string {
  const t = THEMES[themeId] ?? THEMES.dark
  const fn = SCENES[themeId] ?? SCENES[t.basedOn ?? ''] ?? SCENES[THEMES[t.basedOn ?? '']?.basedOn ?? ''] ?? SCENES.dark
  const inner = fn(pal(t), themeId)
  return `<svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">${inner}</svg>`
}

/** The generated scene as a data URI. Ignores any uploaded artwork — callers
 *  that want "whatever this theme shows" want `themeBackdropUri`. */
export function generatedSceneUri(themeId: string): string {
  return `data:image/svg+xml,${encodeURIComponent(sceneSvg(themeId))}`
}

/** Uploaded artwork, a shipped painting, or a custom palette-based scene. */
export function sceneDataUri(themeId: string): string {
  return THEMES[themeId]?.backgroundImage || BUILTIN_ART[themeId] || generatedSceneUri(themeId)
}

/** What the theme's card shows in the App Theme picker: an uploaded icon
 *  first, then the backdrop, then the generated scene. The fall-through is
 *  what makes both uploads optional without ever leaving a card empty. */
export function themeIconUri(themeId: string): string {
  const t = THEMES[themeId]
  return t?.iconImage || sceneDataUri(themeId)
}

/** The full backdrop declaration for the code editor's art layer.
 *
 *  Opacity and grey-scale are part of the theme rather than of the component
 *  because a photograph and a flat generated SVG do not want the same
 *  treatment. Shipped paintings retain their colour at a low opacity; custom
 *  themes keep their original defaults and any explicit artwork settings. */
export function sceneBackdropStyle(themeId: string): {
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
  filter: string
  opacity: number
} {
  const t = THEMES[themeId]
  const shipped = Object.prototype.hasOwnProperty.call(BUILTIN_ART, themeId)
  return {
    backgroundImage: `url("${sceneDataUri(themeId)}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: (t?.backgroundGrayscale ?? !shipped) ? 'grayscale(1)' : themeId === 'heaven' ? 'contrast(0.9) saturate(0.9)' : 'none',
    opacity: t?.backgroundOpacity ?? (shipped ? (t?.isDark ? 0.18 : 0.12) : 0.15),
  }
}
