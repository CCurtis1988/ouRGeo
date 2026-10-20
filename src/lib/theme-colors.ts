// Shared opaque-colour conversions and contrast math. This leaf module has
// no theme registries or UI dependencies, so applying a theme can use the same
// calculations as the Studio without creating a registry import cycle.

/** `#abc` / `abc` / `#AABBCC` → `#aabbcc`. Null for anything else, INCLUDING
 *  8-digit hex: `vars` triples and Monaco rules both take opaque colours, and
 *  an alpha channel that silently vanished later would be worse than a refusal
 *  now. */
export function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const h = raw.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(h)) return `#${h.toLowerCase()}`
  return null
}

/** Hex → the bare `H S% L%` triple `globals.css` composes with alpha. */
export function hexToHslTriple(hex: string): string {
  const h = normalizeHex(hex) ?? '#000000'
  const r = parseInt(h.slice(1, 3), 16) / 255
  const g = parseInt(h.slice(3, 5), 16) / 255
  const b = parseInt(h.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let hue = 0
  let sat = 0
  if (d !== 0) {
    sat = d / (1 - Math.abs(2 * l - 1))
    if (max === r) hue = ((g - b) / d) % 6
    else if (max === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue *= 60
    if (hue < 0) hue += 360
  }
  const round = (n: number): number => Math.round(n * 10) / 10
  return `${round(hue)} ${round(sat * 100)}% ${round(l * 100)}%`
}

/** The inverse, so a shipped theme can seed the studio's colour inputs. */
export function hslTripleToHex(triple: string): string {
  const m = triple.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/)
  if (!m) return '#000000'
  const h = parseFloat(m[1])
  const s = parseFloat(m[2]) / 100
  const l = parseFloat(m[3]) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const mm = l - c / 2
  const seg = Math.floor(((h % 360) + 360) % 360 / 60)
  const rgb: [number, number, number] =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
    : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x]
  const hex = rgb
    .map((v) => Math.round((v + mm) * 255).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

/** Perceived luminance, 0–1. Used to guess `isDark` from a background colour
 *  so the studio's Dark/Light switch starts on the right answer. */
export function luminance(hex: string): number {
  const h = normalizeHex(hex) ?? '#000000'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (v: number): number =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio, 1–21. The studio warns below 4.5 for text on its
 *  surface — a theme whose foreground vanishes into its background is the one
 *  mistake a colour picker makes easy and a preview does not always reveal. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Contrast warning text for a foreground/background pair, or null when the
 *  pair clears WCAG AA for small text. Lives here rather than beside the
 *  control that renders it so the threshold is stated once. */
export function contrastWarning(fg: string, bg: string, what: string): string | null {
  const ratio = contrastRatio(fg, bg)
  if (ratio >= 4.5) return null
  return (
    `${what} contrast is ${ratio.toFixed(1)}:1 against the background — ` +
    `below the 4.5:1 that keeps small text readable.`
  )
}

/** Mix towards white/black by `amount`. Seeds derived colours (accent hover,
 *  a chrome border) so a new theme is coherent before the user touches it. */
export function shade(hex: string, amount: number): string {
  const h = normalizeHex(hex) ?? '#000000'
  const to = amount >= 0 ? 255 : 0
  const k = Math.abs(amount)
  const parts = [1, 3, 5].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16)
    return Math.round(v + (to - v) * k).toString(16).padStart(2, '0')
  })
  return `#${parts.join('')}`
}

