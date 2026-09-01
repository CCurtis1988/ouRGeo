// ── Theme Studio: the user's own themes ───────────────────────────────────
//
// Three independent axes ship as data tables (`themes.ts`, `editor-themes.ts`).
// This module lets the user add to all three, and it is deliberately the ONLY
// place that knows a theme can be user-made: everything downstream — Monaco's
// theme builder, the scene art, the map's basemap, the pickers — goes on
// reading a `ThemeDef` / `SyntaxPalette` / `MarkdownPalette` out of a registry
// by id and cannot tell the difference.
//
// Two conversions live here and nowhere else.
//
//  1. **Hex in, HSL out.** A user picks colours in an `<input type="color">`,
//     which speaks six-digit hex and nothing else. `ThemeDef.vars` holds bare
//     HSL triples ("220 30% 7%") because `globals.css` composes them with
//     alpha — `hsl(var(--geo-accent) / 0.4)` — and a hex there would make the
//     whole declaration invalid. So the authoring model is hex and `vars` is
//     derived, never edited.
//
//  2. **A file is not a theme.** Import runs `classifyThemeFile` first, which
//     answers "what kind of theme file is this" BEFORE anything is validated
//     as a palette. That is what lets the code-theme importer say "this is an
//     App theme file" instead of "expected `keyword` to be a hex colour", and
//     it is why the envelope carries `kind` as its own field rather than being
//     inferred from the shape of the payload.
//
// Colours are validated on the way in, not on the way out. Monaco's
// `ColorMap.getId` THROWS on anything that is not /^#?[0-9A-Fa-f]{6,8}$/ — a
// three-digit `#a33` in a hand-edited theme file would take the entire editor
// down at `defineTheme` time, with no stack that points here. Every colour in
// an imported file is therefore normalised to six digits or the import fails
// with the offending field named.

import {
  THEMES, BUILTIN_THEMES, registerCustomThemes,
  type ThemeDef, type EditorChrome,
} from './themes'
import {
  CODE_THEMES, MARKDOWN_THEMES, BUILTIN_CODE_THEMES, BUILTIN_MARKDOWN_THEMES,
  registerCustomEditorThemes,
  type SyntaxPalette, type MarkdownPalette,
} from './editor-themes'

// ── Colour helpers ────────────────────────────────────────────────────────

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

// ── The authoring model ───────────────────────────────────────────────────

/** The ten `--geo-*` colours, as hex. Same order the interface reads them in. */
export interface SystemColors {
  bg: string
  panel: string
  border: string
  accent: string
  accentHover: string
  muted: string
  success: string
  warning: string
  error: string
  fg: string
}

export const SYSTEM_COLOR_KEYS = [
  'bg', 'panel', 'border', 'accent', 'accentHover', 'muted',
  'success', 'warning', 'error', 'fg',
] as const

export const CHROME_KEYS = ['panel', 'bg', 'border', 'accent', 'muted', 'fg'] as const

export const CODE_COLOR_KEYS = [
  'fg', 'comment', 'keyword', 'constant', 'string', 'number',
  'operator', 'fn', 'tag', 'delimiter', 'error',
] as const

export const MD_COLOR_KEYS = [
  'text', 'heading', 'emphasis', 'link', 'code', 'quote', 'meta', 'html', 'escape',
] as const

/**
 * A user's app theme, as authored.
 *
 * `vars`, `palette` and `swatches` are NOT here — they are computed by
 * `systemThemeToDef`. Storing derived values would let a hand-edited file
 * disagree with itself (a `vars` triple that is not the hex beside it), and
 * the disagreement would show up as a control painted one colour and its
 * hover state another.
 */
export interface CustomSystemTheme {
  id: string
  label: string
  isDark: boolean
  /** The shipped theme this was started from. Supplies the generated scene art
   *  when no background image is set, so a new theme is never blank. */
  basedOn: string
  colors: SystemColors
  /** The editor surface. Independent of `colors` on purpose — the shipped
   *  themes' editor panels are not simply their interface panels (Volcanic's
   *  editor is warmer than its chrome), and the studio's "match interface"
   *  button is how you opt out of the distinction. */
  chrome: EditorChrome
  defaultCodeTheme: string
  defaultMarkdownTheme: string
  /** A `BASEMAPS_BY_ID` id. */
  defaultBasemap: string
  backgroundImage: string | null
  backgroundOpacity: number
  backgroundGrayscale: boolean
  iconImage: string | null
}

export type CustomCodeTheme = SyntaxPalette
export type CustomMarkdownTheme = MarkdownPalette

export type ThemeKind = 'system' | 'code' | 'markdown'

export const KIND_LABEL: Record<ThemeKind, string> = {
  system: 'App theme',
  code: 'Code theme',
  markdown: 'Markdown theme',
}

export interface CustomThemeBundle {
  system: CustomSystemTheme[]
  code: CustomCodeTheme[]
  markdown: CustomMarkdownTheme[]
}

export const EMPTY_BUNDLE: CustomThemeBundle = { system: [], code: [], markdown: [] }

// ── Artwork ───────────────────────────────────────────────────────────────

/**
 * What the file picker will take, and what it is for.
 *
 * The size caps are not arbitrary. Every image is inlined as a `data:` URI in
 * `custom-themes.json`, which is read synchronously-ish at boot before the
 * first paint of the theme; a 20 MB photograph would push a visible delay in
 * front of every launch, and base64 costs another third on top. The dimensions
 * are what the surfaces actually measure at.
 */
export interface ImageSpec {
  label: string
  /** Extensions the dialog offers, in the order a user would think of them. */
  formats: string[]
  mimes: string[]
  maxBytes: number
  /** Human sentence shown under the control. */
  guidance: string
}

const IMAGE_MIMES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
  'image/gif', 'image/avif',
]

export const BACKGROUND_SPEC: ImageSpec = {
  label: 'Editor backdrop',
  formats: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif'],
  mimes: IMAGE_MIMES,
  maxBytes: 4 * 1024 * 1024,
  guidance:
    'PNG, JPEG, WebP, SVG, GIF or AVIF, up to 4 MB. Scaled to cover the ' +
    'editor panel, so a wide 16:9 image around 1600 × 900 fills it without ' +
    'the middle being cropped out. It sits under the text at low opacity — a ' +
    'calm, low-contrast image reads far better here than a busy one.',
}

export const ICON_SPEC: ImageSpec = {
  label: 'Theme card',
  formats: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif'],
  mimes: IMAGE_MIMES,
  maxBytes: 1024 * 1024,
  guidance:
    'PNG, JPEG, WebP, SVG, GIF or AVIF, up to 1 MB. Shown on this theme\'s ' +
    'card in the App Theme picker, cropped to 16:9 — 320 × 180 is plenty. ' +
    'Leave it empty and the card uses the backdrop, or the generated scene.',
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', gif: 'image/gif', avif: 'image/avif',
}

export function mimeForPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? null
}

/** Base64 payload → decoded byte count, without decoding it. */
export function base64Bytes(b64: string): number {
  const body = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0
  return Math.floor((body.length * 3) / 4) - pad
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** A `data:` URI this app is willing to paint, or a sentence saying why not. */
export function validateImageDataUri(
  uri: unknown, spec: ImageSpec,
): { ok: true; uri: string } | { ok: false; error: string } {
  if (typeof uri !== 'string' || !uri.startsWith('data:')) {
    return { ok: false, error: `${spec.label}: not an embedded image.` }
  }
  const mime = uri.slice(5, uri.indexOf(';') === -1 ? 5 : uri.indexOf(';'))
  if (!spec.mimes.includes(mime)) {
    return {
      ok: false,
      error: `${spec.label}: ${mime || 'unknown type'} is not a supported image ` +
        `format. Use ${spec.formats.join(', ')}.`,
    }
  }
  const bytes = base64Bytes(uri)
  if (bytes > spec.maxBytes) {
    return {
      ok: false,
      error: `${spec.label}: ${formatBytes(bytes)} exceeds the ` +
        `${formatBytes(spec.maxBytes)} limit.`,
    }
  }
  return { ok: true, uri }
}

// ── Authoring model → registry entry ──────────────────────────────────────

/** Compose the derived halves of a `ThemeDef` from the authored hexes. */
export function systemThemeToDef(t: CustomSystemTheme): ThemeDef {
  const c = t.colors
  return {
    id: t.id,
    label: t.label,
    isDark: t.isDark,
    defaultCodeTheme: t.defaultCodeTheme,
    defaultMarkdownTheme: t.defaultMarkdownTheme,
    vars: {
      '--geo-bg': hexToHslTriple(c.bg),
      '--geo-panel': hexToHslTriple(c.panel),
      '--geo-border': hexToHslTriple(c.border),
      '--geo-accent': hexToHslTriple(c.accent),
      '--geo-accent-hover': hexToHslTriple(c.accentHover),
      '--geo-muted': hexToHslTriple(c.muted),
      '--geo-success': hexToHslTriple(c.success),
      '--geo-warning': hexToHslTriple(c.warning),
      '--geo-error': hexToHslTriple(c.error),
      '--geo-fg': hexToHslTriple(c.fg),
    },
    // The card's three dots and the map overlays read hex directly, so these
    // stay in the authored space rather than round-tripping through HSL.
    swatches: [t.chrome.bg, t.chrome.accent, t.chrome.fg],
    palette: {
      accent: c.accent, error: c.error, success: c.success, muted: c.muted,
    },
    editorChrome: { ...t.chrome },
    custom: true,
    basedOn: t.basedOn,
    defaultBasemap: t.defaultBasemap,
    backgroundImage: t.backgroundImage,
    backgroundOpacity: t.backgroundOpacity,
    backgroundGrayscale: t.backgroundGrayscale,
    iconImage: t.iconImage,
  }
}

/**
 * Install a whole bundle into the three live registries.
 *
 * Order matters: the editor palettes go first, because a system theme's
 * `defaultCodeTheme` may name one of the user's own and `resolveCodeTheme`
 * would otherwise fall through to Dark for the length of one render.
 */
export function installBundle(bundle: CustomThemeBundle): void {
  registerCustomEditorThemes(bundle.code, bundle.markdown)
  registerCustomThemes(bundle.system.map(systemThemeToDef))
}

// ── Ids ───────────────────────────────────────────────────────────────────

/** A registry key derived from the label — readable in `theme.json`, and in
 *  the AI assistant's `ui:theme` receipts, which is why it is not a uuid. */
export function slugify(label: string): string {
  const base = label
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'theme'
}

/** A slug not already taken, in ANY registry of that kind — shipped included,
 *  since a user id that collided with `dark` would simply be dropped. */
export function uniqueThemeId(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = `my-${slugify(label)}`
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
}

export const takenSystemIds = (): string[] => Object.keys(THEMES)
export const takenCodeIds = (): string[] => Object.keys(CODE_THEMES)
export const takenMarkdownIds = (): string[] => Object.keys(MARKDOWN_THEMES)

// ── Templates ─────────────────────────────────────────────────────────────

/** The authored hexes behind a `ThemeDef`'s HSL triples. The inverse of the
 *  `vars` half of `systemThemeToDef`, used to seed the studio from a shipped
 *  theme and to paint the preview for the code/markdown editors. */
export function systemColorsFromDef(t: ThemeDef): SystemColors {
  const v = (k: string): string => hslTripleToHex(t.vars[k] ?? '0 0% 0%')
  return {
    bg: v('--geo-bg'),
    panel: v('--geo-panel'),
    border: v('--geo-border'),
    accent: v('--geo-accent'),
    accentHover: v('--geo-accent-hover'),
    muted: v('--geo-muted'),
    success: v('--geo-success'),
    warning: v('--geo-warning'),
    error: v('--geo-error'),
    fg: v('--geo-fg'),
  }
}

/** Start a new app theme from an existing one — shipped or the user's own. */
export function systemThemeFromTemplate(
  templateId: string, label: string, id: string,
): CustomSystemTheme {
  const t = THEMES[templateId] ?? THEMES.dark
  return {
    id,
    label,
    isDark: t.isDark,
    // A theme derived from a user theme inherits the SHIPPED ancestor, so the
    // generated scene keeps working however long the chain gets.
    basedOn: t.custom ? (t.basedOn ?? 'dark') : t.id,
    colors: systemColorsFromDef(t),
    chrome: { ...t.editorChrome },
    defaultCodeTheme: t.defaultCodeTheme,
    defaultMarkdownTheme: t.defaultMarkdownTheme,
    defaultBasemap: t.defaultBasemap ?? '',
    backgroundImage: t.backgroundImage ?? null,
    backgroundOpacity: t.backgroundOpacity ?? 0.15,
    backgroundGrayscale: t.backgroundGrayscale ?? true,
    iconImage: t.iconImage ?? null,
  }
}

export function codeThemeFromTemplate(
  templateId: string, label: string, id: string,
): CustomCodeTheme {
  const base = CODE_THEMES[templateId] ?? CODE_THEMES.dark
  return { ...base, id, label, custom: true, basedOn: base.basedOn ?? base.id }
}

export function markdownThemeFromTemplate(
  templateId: string, label: string, id: string,
): CustomMarkdownTheme {
  const base = MARKDOWN_THEMES[templateId] ?? MARKDOWN_THEMES.dark
  return { ...base, id, label, custom: true, basedOn: base.basedOn ?? base.id }
}

// ── The file format ───────────────────────────────────────────────────────

export const THEME_FILE_VERSION = 1

/**
 * An exported theme file.
 *
 * `kind` is a field, not something to be inferred from the payload's shape.
 * Inference is exactly what fails the user here: a code palette and a markdown
 * palette are both a flat map of colour names, and a mis-guess would either
 * import silently as the wrong kind or reject with a message about a missing
 * property. With `kind` declared, the importer for the other axis can say what
 * the file actually is and offer to open the right editor.
 */
export interface ThemeFile {
  ourgeoTheme: number
  kind: ThemeKind
  app: 'ouRGeo'
  exported: string
  themes: unknown[]
}

export function buildThemeFile(kind: ThemeKind, themes: unknown[]): string {
  const file: ThemeFile = {
    ourgeoTheme: THEME_FILE_VERSION,
    kind,
    app: 'ouRGeo',
    exported: new Date().toISOString(),
    themes,
  }
  return JSON.stringify(file, null, 2)
}

export type ClassifyResult =
  | { ok: true; kind: ThemeKind; themes: unknown[] }
  /** It is a theme file — `kind` says which — but not the one asked for. */
  | { ok: false; kind: ThemeKind; error: string }
  /** Not an ouRGeo theme file at all. */
  | { ok: false; kind: null; error: string }

/**
 * Read a theme file's envelope. Nothing inside `themes` is validated here —
 * this answers only "what is this, and is it the kind you wanted".
 *
 * Passing `expected` is what turns a wrong-axis import into a sentence the
 * user can act on. Omit it to accept any kind (the Import button on the
 * studio's header, which routes by whatever comes back).
 */
export function classifyThemeFile(text: string, expected?: ThemeKind): ClassifyResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {
      ok: false, kind: null,
      error: 'That file is not valid JSON, so it is not an ouRGeo theme file.',
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false, kind: null,
      error: 'That file does not contain an ouRGeo theme.',
    }
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj.ourgeoTheme !== 'number') {
    // Name the two files a user is most likely to have reached for by mistake,
    // because both live beside theme files in the same app-data folder and
    // both are JSON that opens without complaint.
    const hint =
      'ui' in obj && 'databases' in obj
        ? ' That looks like an ouRGeo project manifest — open it with the project dropdown instead.'
        : 'theme' in obj || 'codeTheme' in obj || 'uiScale' in obj
          ? ' That looks like ouRGeo\'s saved settings (theme.json), which records which themes are selected — not a theme you can import.'
          : ''
    return {
      ok: false, kind: null,
      error: `That file is not an ouRGeo theme file.${hint}`,
    }
  }
  if (obj.ourgeoTheme > THEME_FILE_VERSION) {
    return {
      ok: false, kind: null,
      error: `That theme file was written by a newer version of ouRGeo ` +
        `(format ${String(obj.ourgeoTheme)}, this build reads ${THEME_FILE_VERSION}).`,
    }
  }
  const kind = obj.kind
  if (kind !== 'system' && kind !== 'code' && kind !== 'markdown') {
    return {
      ok: false, kind: null,
      error: 'That theme file does not say what kind of theme it holds.',
    }
  }
  if (!Array.isArray(obj.themes) || obj.themes.length === 0) {
    return { ok: false, kind, error: 'That theme file contains no themes.' }
  }
  if (expected && kind !== expected) {
    return {
      ok: false, kind,
      error:
        `That is an ${KIND_LABEL[kind]} file (${describeThemeFile(obj.themes)}), ` +
        `and this is the ${KIND_LABEL[expected].toLowerCase()} list. ` +
        `Import it from the ${TAB_LABEL[kind]} tab.`,
    }
  }
  return { ok: true, kind, themes: obj.themes }
}

/** The tab a given kind is imported from — quoted in the mismatch message, so
 *  the sentence names a thing the user can actually click. */
export const TAB_LABEL: Record<ThemeKind, string> = {
  system: 'App Themes',
  code: 'Code Themes',
  markdown: 'Markdown Themes',
}

/** "Slate Blue", or "3 themes" — enough for the user to recognise the file. */
function describeThemeFile(themes: unknown[]): string {
  if (themes.length === 1) {
    const t = themes[0]
    const label =
      t !== null && typeof t === 'object' && typeof (t as { label?: unknown }).label === 'string'
        ? (t as { label: string }).label
        : null
    return label ? `“${label}”` : '1 theme'
  }
  return `${themes.length} themes`
}

// ── Payload validation ────────────────────────────────────────────────────

class Invalid extends Error {}

const str = (o: Record<string, unknown>, k: string, fallback?: string): string => {
  const v = o[k]
  if (typeof v === 'string' && v.trim()) return v
  if (fallback !== undefined) return fallback
  throw new Invalid(`missing “${k}”`)
}

const hex = (o: Record<string, unknown>, k: string, fallback?: string): string => {
  const v = normalizeHex(o[k])
  if (v) return v
  if (fallback !== undefined) return fallback
  throw new Invalid(
    o[k] === undefined
      ? `missing colour “${k}”`
      : `“${k}” is not a hex colour (got ${JSON.stringify(o[k])})`,
  )
}

const obj = (o: Record<string, unknown>, k: string): Record<string, unknown> => {
  const v = o[k]
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Invalid(`missing “${k}”`)
  }
  return v as Record<string, unknown>
}

const image = (
  o: Record<string, unknown>, k: string, spec: ImageSpec,
): string | null => {
  const v = o[k]
  if (v === undefined || v === null || v === '') return null
  const res = validateImageDataUri(v, spec)
  if (!res.ok) throw new Invalid(res.error)
  return res.uri
}

const asRecord = (t: unknown, index: number): Record<string, unknown> => {
  if (t === null || typeof t !== 'object' || Array.isArray(t)) {
    throw new Invalid(`entry ${index + 1} is not a theme object`)
  }
  return t as Record<string, unknown>
}

export type ParseResult<T> =
  | { ok: true; themes: T[] }
  | { ok: false; error: string }

function parseEach<T>(
  themes: unknown[], one: (o: Record<string, unknown>, i: number) => T,
): ParseResult<T> {
  const out: T[] = []
  for (let i = 0; i < themes.length; i++) {
    try {
      out.push(one(asRecord(themes[i], i), i))
    } catch (err) {
      const what = err instanceof Invalid ? err.message : 'is malformed'
      const rec = themes[i]
      const label =
        rec !== null && typeof rec === 'object' && typeof (rec as { label?: unknown }).label === 'string'
          ? `“${(rec as { label: string }).label}”`
          : `entry ${i + 1}`
      return { ok: false, error: `${label}: ${what}.` }
    }
  }
  return { ok: true, themes: out }
}

/** Parse the `themes` array of a `kind: 'system'` file. Ids are NOT trusted —
 *  the caller re-keys against the live registry so an import can never shadow
 *  a shipped theme or silently overwrite one the user already has. */
export function parseSystemThemes(themes: unknown[]): ParseResult<CustomSystemTheme> {
  return parseEach(themes, (o) => {
    const colors = obj(o, 'colors')
    const chrome = obj(o, 'chrome')
    const bg = hex(colors, 'bg')
    const accent = hex(colors, 'accent')
    const opacity = Number(o.backgroundOpacity)
    return {
      id: slugify(str(o, 'id', str(o, 'label'))),
      label: str(o, 'label'),
      isDark: typeof o.isDark === 'boolean' ? o.isDark : luminance(bg) < 0.35,
      basedOn: str(o, 'basedOn', 'dark'),
      colors: {
        bg,
        panel: hex(colors, 'panel'),
        border: hex(colors, 'border'),
        accent,
        accentHover: hex(colors, 'accentHover', shade(accent, 0.2)),
        muted: hex(colors, 'muted'),
        success: hex(colors, 'success'),
        warning: hex(colors, 'warning'),
        error: hex(colors, 'error'),
        fg: hex(colors, 'fg'),
      },
      chrome: {
        panel: hex(chrome, 'panel'),
        bg: hex(chrome, 'bg'),
        border: hex(chrome, 'border'),
        accent: hex(chrome, 'accent'),
        muted: hex(chrome, 'muted'),
        fg: hex(chrome, 'fg'),
      },
      defaultCodeTheme: str(o, 'defaultCodeTheme', 'dark'),
      defaultMarkdownTheme: str(o, 'defaultMarkdownTheme', 'dark'),
      defaultBasemap: str(o, 'defaultBasemap', ''),
      backgroundImage: image(o, 'backgroundImage', BACKGROUND_SPEC),
      backgroundOpacity: Number.isFinite(opacity)
        ? Math.min(1, Math.max(0, opacity)) : 0.15,
      backgroundGrayscale: o.backgroundGrayscale !== false,
      iconImage: image(o, 'iconImage', ICON_SPEC),
    }
  })
}

export function parseCodeThemes(themes: unknown[]): ParseResult<CustomCodeTheme> {
  return parseEach(themes, (o) => {
    const p: Record<string, string> = {}
    for (const k of CODE_COLOR_KEYS) p[k] = hex(o, k)
    return {
      id: slugify(str(o, 'id', str(o, 'label'))),
      label: str(o, 'label'),
      isDark: typeof o.isDark === 'boolean' ? o.isDark : luminance(p.fg) > 0.4,
      custom: true,
      basedOn: str(o, 'basedOn', 'dark'),
      ...p,
    } as CustomCodeTheme
  })
}

export function parseMarkdownThemes(themes: unknown[]): ParseResult<CustomMarkdownTheme> {
  return parseEach(themes, (o) => {
    const p: Record<string, string> = {}
    for (const k of MD_COLOR_KEYS) p[k] = hex(o, k)
    return {
      id: slugify(str(o, 'id', str(o, 'label'))),
      label: str(o, 'label'),
      isDark: typeof o.isDark === 'boolean' ? o.isDark : luminance(p.text) > 0.4,
      custom: true,
      basedOn: str(o, 'basedOn', 'dark'),
      ...p,
    } as CustomMarkdownTheme
  })
}

/**
 * Everything an import has to survive, in one call: the envelope check, the
 * kind check, and the payload parse. `expected` is the axis the user was
 * looking at — pass it and a wrong-kind file comes back as a sentence naming
 * the right tab rather than as a parse failure.
 */
export function parseThemeFile(
  text: string, expected?: ThemeKind,
):
  | { ok: true; kind: 'system'; themes: CustomSystemTheme[] }
  | { ok: true; kind: 'code'; themes: CustomCodeTheme[] }
  | { ok: true; kind: 'markdown'; themes: CustomMarkdownTheme[] }
  | { ok: false; kind: ThemeKind | null; error: string } {
  const head = classifyThemeFile(text, expected)
  if (!head.ok) return head
  const parsed =
    head.kind === 'system' ? parseSystemThemes(head.themes)
    : head.kind === 'code' ? parseCodeThemes(head.themes)
    : parseMarkdownThemes(head.themes)
  if (!parsed.ok) {
    return {
      ok: false, kind: head.kind,
      error: `That ${KIND_LABEL[head.kind].toLowerCase()} file could not be read — ${parsed.error}`,
    }
  }
  return { kind: head.kind, ok: true, themes: parsed.themes } as
    | { ok: true; kind: 'system'; themes: CustomSystemTheme[] }
    | { ok: true; kind: 'code'; themes: CustomCodeTheme[] }
    | { ok: true; kind: 'markdown'; themes: CustomMarkdownTheme[] }
}

// ── Export payloads ───────────────────────────────────────────────────────
// Written back in the same shape the parsers read, so an export/import round
// trip is lossless and a hand-edited file stays legible.

export const exportSystemTheme = (t: CustomSystemTheme): unknown => ({ ...t })

const pick = <T extends Record<string, unknown>>(
  t: T, keys: readonly string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {
    id: t.id, label: t.label, isDark: t.isDark, basedOn: t.basedOn ?? 'dark',
  }
  for (const k of keys) out[k] = t[k]
  return out
}

export const exportCodeTheme = (t: CustomCodeTheme): unknown =>
  pick(t as unknown as Record<string, unknown>, CODE_COLOR_KEYS)

export const exportMarkdownTheme = (t: CustomMarkdownTheme): unknown =>
  pick(t as unknown as Record<string, unknown>, MD_COLOR_KEYS)

// ── Shipped-theme guards ──────────────────────────────────────────────────

export const isBuiltinSystem = (id: string): boolean => id in BUILTIN_THEMES
export const isBuiltinCode = (id: string): boolean => id in BUILTIN_CODE_THEMES
export const isBuiltinMarkdown = (id: string): boolean => id in BUILTIN_MARKDOWN_THEMES
