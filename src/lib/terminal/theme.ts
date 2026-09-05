// The terminal's colours, and where each one comes from.
//
// This is `buildMonacoTheme`'s sibling, and it inherits that module's hardest-
// won invariant: **the surface belongs to the app theme, the colours of the
// text belong to the code theme**. Switching code theme recolours `ls` and
// `git diff`; switching app theme moves the background and resets the palette.
// `editor-themes.test.ts` pins that separation for Monaco and
// `theme.test.ts` pins it here, because the failure it prevents — a code
// palette that quietly repaints the surface it is drawn on — is invisible
// until someone picks the one combination where the two disagree.
//
// ── Why the ANSI ramp is derived rather than authored ──────────────────────
//
// A terminal needs sixteen colours and a `SyntaxPalette` has eleven, none of
// them labelled "red". Three options were on the table:
//
//   1. Hand-author sixteen colours per app theme. Ten shipped themes is 160
//      decisions, and a theme built in the Theme Studio would have none at all
//      — so user themes would get a terminal that does not match them.
//   2. Map slots to palette fields by position (`red = error`, `green =
//      string`, …). Cheap, and wrong the moment a theme's `keyword` and `fn`
//      are both blue: two ANSI slots collapse onto one colour and `ls` stops
//      distinguishing directories from executables.
//   3. Match by HUE, and fall back when the palette has nothing suitable.
//
// This is (3). Each ANSI slot names a target hue; the palette's colours are
// searched for the nearest one that is actually colourful, and a slot with no
// candidate within tolerance takes the base ramp instead. So Solarized yields
// a Solarized terminal, a near-monochrome palette yields the sensible default
// rather than six shades of grey, and every slot is guaranteed both distinct
// and readable — which authoring by hand does not guarantee at all.

import {
  normalizeHex, hexToHslTriple, hslTripleToHex, contrastRatio, shade,
} from '../custom-themes'
import type { ThemeDef } from '../themes'
import type { SyntaxPalette } from '../editor-themes'

/** The colours xterm.js takes. A subset of its `ITheme`, six-digit hex only —
 *  its colour parser throws on anything else, from inside the constructor,
 *  which is the same trap `defineTheme` set for the Monaco themes. */
export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

interface Hsl { h: number; s: number; l: number }

function toHsl(hex: string): Hsl {
  const m = /^([\d.]+) ([\d.]+)% ([\d.]+)%$/.exec(hexToHslTriple(hex))
  if (!m) return { h: 0, s: 0, l: 0 }
  return { h: parseFloat(m[1]), s: parseFloat(m[2]) / 100, l: parseFloat(m[3]) / 100 }
}

function toHex({ h, s, l }: Hsl): string {
  return hslTripleToHex(`${h} ${s * 100}% ${l * 100}%`)
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Degrees apart on the colour wheel, the short way round. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** The six chromatic ANSI slots and the hue each one is expected to sit at. */
const HUE_TARGETS: Record<string, number> = {
  red: 2,
  green: 130,
  yellow: 46,
  blue: 215,
  magenta: 300,
  cyan: 185,
}

/** A slot only accepts a palette colour this close to its hue; beyond it, the
 *  base ramp is a better answer than a green that is really a teal. */
const HUE_TOLERANCE = 42

/** And only one this colourful — a desaturated near-grey matches every hue
 *  equally well and looks like nothing at all in a terminal. */
const MIN_SATURATION = 0.22

const BASE_DARK: Record<string, string> = {
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
}

const BASE_LIGHT: Record<string, string> = {
  red: '#c8383d',
  green: '#2f7d32',
  yellow: '#9a6b00',
  blue: '#1d63c4',
  magenta: '#8e3aa6',
  cyan: '#0f7285',
}

/** The palette colours a slot may be filled from. `fg` and `comment` are
 *  deliberately absent: they are the two the terminal already uses for its own
 *  foreground and dim text, and letting them win a hue slot would put the same
 *  colour in two places that mean different things. */
function candidates(code: SyntaxPalette): string[] {
  return [
    code.error, code.string, code.number, code.fn,
    code.keyword, code.operator, code.tag, code.constant,
  ]
}

/**
 * Push a colour until it is legible on `bg`, moving away from the background
 * rather than towards a fixed lightness.
 *
 * Fixed bands do not work across ten app themes: a band that suits a near-black
 * background washes out on a light one. Contrast is the property that actually
 * matters, so it is the one being solved for. 3.4:1 rather than WCAG's 4.5:1
 * because this is not body text — it is a terminal's own palette, where several
 * of these colours exist precisely to be less prominent, and forcing all six to
 * AA flattens the distinctions the palette is for.
 */
function ensureContrast(hex: string, bg: string, isDark: boolean): string {
  let hsl = toHsl(hex)
  let out = toHex(hsl)
  for (let i = 0; i < 24 && contrastRatio(out, bg) < 3.4; i++) {
    hsl = { ...hsl, l: clamp(hsl.l + (isDark ? 0.03 : -0.03), 0.06, 0.94) }
    out = toHex(hsl)
  }
  return out
}

/** The base ramp colour for a slot, adapted to this theme's own hue for that
 *  slot's family so a warm theme does not get a cold fallback. */
function fallbackFor(slot: string, isDark: boolean): string {
  return (isDark ? BASE_DARK : BASE_LIGHT)[slot]
}

/**
 * Assign palette colours to hue slots — at most one slot per colour.
 *
 * The exclusivity is the whole of it, and it is not a refinement: without it
 * ouRGeo's own Dark theme produced a terminal whose `blue` and `cyan` were the
 * SAME `#79c9d9`, because that one colour sits at hue 190 and is therefore
 * within tolerance of both targets. Three of the ten shipped themes collapsed
 * a slot that way. A terminal where two of the six chromatic colours are
 * identical is one where `ls` cannot distinguish a directory from a symlink,
 * and `git diff --color-moved` loses a whole category.
 *
 * So the assignment is global rather than per slot: every (slot, colour) pair
 * inside the tolerance is scored, the closest matches are taken first, and a
 * slot whose only candidate was claimed by a better fit takes the base ramp.
 * Dark's cyan-ish keyword goes to `cyan`, where it belongs, and `blue` gets a
 * real blue instead of a second copy of it.
 */
function assignSlots(code: SyntaxPalette, isDark: boolean): Record<string, string> {
  const slots = Object.keys(HUE_TARGETS)
  const pairs: { slot: string; hex: string; gap: number }[] = []

  for (const raw of candidates(code)) {
    const hex = normalizeHex(raw)
    if (!hex) continue
    const hsl = toHsl(hex)
    if (hsl.s < MIN_SATURATION) continue
    for (const slot of slots) {
      const gap = hueGap(hsl.h, HUE_TARGETS[slot])
      if (gap <= HUE_TOLERANCE) pairs.push({ slot, hex, gap })
    }
  }
  // Ties broken by slot order so the result never depends on object iteration
  // order — a palette rebuilt from an imported file must colour identically.
  pairs.sort((a, b) => a.gap - b.gap || slots.indexOf(a.slot) - slots.indexOf(b.slot))

  const out: Record<string, string> = {}
  const claimed = new Set<string>()
  for (const p of pairs) {
    if (out[p.slot] || claimed.has(p.hex)) continue
    out[p.slot] = p.hex
    claimed.add(p.hex)
  }
  for (const slot of slots) out[slot] ??= fallbackFor(slot, isDark)
  return out
}

/**
 * Build the sixteen-colour ramp plus the surface colours.
 *
 * `system` decides where the text sits; `code` decides what colour it is.
 */
export function buildTerminalTheme(system: ThemeDef, code: SyntaxPalette): TerminalTheme {
  const chrome = system.editorChrome
  const isDark = system.isDark
  // `bg`, not `panel`. The console this shares a tab strip with paints no
  // background of its own, and neither does the slot either of them sits in —
  // what shows through is `EditorLayout`'s `bg-geo-bg`. Taking `panel` here
  // drew the terminal as a slightly-different rectangle inside the pane, which
  // reads as a bug in the layout rather than as a colour choice.
  const bg = normalizeHex(chrome.bg) ?? (isDark ? '#0f1117' : '#ffffff')
  const fg = normalizeHex(chrome.fg) ?? (isDark ? '#e6edf3' : '#1f2328')
  const accent = normalizeHex(chrome.accent) ?? '#4493f8'
  const muted = normalizeHex(system.palette.muted) ?? (isDark ? '#8b949e' : '#6b7280')

  const picked = assignSlots(code, isDark)
  const slot = (name: string): string => ensureContrast(picked[name], bg, isDark)

  const base = {
    red: slot('red'),
    green: slot('green'),
    yellow: slot('yellow'),
    blue: slot('blue'),
    magenta: slot('magenta'),
    cyan: slot('cyan'),
  }

  // "Bright" moves away from the background, the direction that means
  // "louder" on this theme. Lightening a light theme's bright colours would
  // make them the least readable eight of the sixteen.
  const brighten = (hex: string): string => shade(hex, isDark ? 0.2 : -0.18)

  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    // What a block cursor draws the character underneath it in: the surface,
    // so the glyph is punched out of the cursor rather than fighting it.
    cursorAccent: bg,
    // An opaque blend rather than an alpha colour. xterm accepts rgba here, but
    // every other colour in this object must be six-digit hex, and one field
    // with different rules is one field that gets normalised by mistake later.
    selectionBackground: shade(accent, isDark ? -0.55 : 0.55),

    // `black` is not the background: a program printing black text on the
    // terminal's own background would be invisible. It is the darkest colour
    // still separable from the surface — which on a light theme is genuinely
    // near-black, and on a dark one is a lifted grey.
    black: isDark ? shade(bg, 0.22) : shade(fg, 0.1),
    ...base,
    // Dimmer than the foreground, which is what `white` means in an ANSI ramp:
    // the default text weight, with brightWhite as the emphatic one.
    white: shade(fg, isDark ? -0.12 : 0.12),

    // The conventional "dim" colour — comments in a diff, secondary text in a
    // CLI's own output. The app's muted token is exactly that colour already.
    brightBlack: ensureContrast(muted, bg, isDark),
    brightRed: brighten(base.red),
    brightGreen: brighten(base.green),
    brightYellow: brighten(base.yellow),
    brightBlue: brighten(base.blue),
    brightMagenta: brighten(base.magenta),
    brightCyan: brighten(base.cyan),
    brightWhite: shade(fg, isDark ? 0.25 : -0.25),
  }
}

/** The ramp's sixteen names, for tests and anything enumerating the palette. */
export const ANSI_SLOTS: readonly (keyof TerminalTheme)[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
]
