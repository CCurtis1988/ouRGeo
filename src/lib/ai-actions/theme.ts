// Making and switching themes.
//
// Switching lives in `ui.ts` (`ui:theme`, `ui:codeTheme`, `ui:markdownTheme`) —
// it is a one-line interface action like toggling a panel. This module is the
// other half: authoring. It exists because a user can now ask for a theme in
// prose ("something warm, low contrast, easy on the eyes at night") and the
// assistant should be able to build the whole thing rather than describe where
// the Theme Studio is.
//
// Three rules shape the surface, and they are the same three the Studio's UI
// enforces:
//
//  1. **Shipped themes are read-only.** Every mutating action refuses one by
//     name and points at `theme:duplicate`. The alternative — letting the model
//     edit Dark in place — means an ouRGeo update silently reverting the user's
//     theme, with nothing to reset to.
//
//  2. **Colours are validated here, not by Monaco.** `defineTheme` throws on
//     anything that is not six or eight hex digits, and it throws deep in the
//     editor with no stack pointing at the cause. A model writing `"blue"` or
//     `"#a33"` must get a tool result, not a dead editor.
//
//  3. **An app theme's two colour sets are named separately.** `panel`, `bg`,
//     `border`, `accent`, `muted` and `fg` exist in BOTH the interface palette
//     and the editor surface, so a flat map would be ambiguous. `colors` and
//     `chrome` are separate parameters for that reason alone.

import {
  THEMES, BUILTIN_THEMES, themeList, type EditorChrome,
} from '@/lib/themes'
import {
  CODE_THEMES, MARKDOWN_THEMES, BUILTIN_CODE_THEMES, BUILTIN_MARKDOWN_THEMES,
  codeThemeList, markdownThemeList,
} from '@/lib/editor-themes'
import { BASEMAPS_BY_ID } from '@/lib/basemaps'
import {
  CODE_COLOR_KEYS, MD_COLOR_KEYS, SYSTEM_COLOR_KEYS, CHROME_KEYS,
  BACKGROUND_SPEC, ICON_SPEC, KIND_LABEL, TAB_LABEL,
  buildThemeFile, contrastRatio, exportCodeTheme, exportMarkdownTheme,
  exportSystemTheme, mimeForPath, normalizeHex, parseThemeFile,
  systemColorsFromDef, validateImageDataUri,
  type CustomCodeTheme, type CustomMarkdownTheme, type CustomSystemTheme,
  type SystemColors, type ThemeKind,
} from '@/lib/custom-themes'
import { useCustomThemeStore } from '@/store/custom-themes'
import { useThemeStore } from '@/store/theme'
import {
  argBool, argJson, argStr, fail, ok, type ActionResult, type UiAction,
} from './types'

const KINDS: readonly ThemeKind[] = ['system', 'code', 'markdown'] as const

/**
 * Resolve a theme argument the way a model actually writes one.
 *
 * An id first, then the display NAME — because a model that has just created
 * "Half-Life 2" reaches for that string before it reaches for
 * `my-half-life-2`, and being told "unknown theme" at that point reads as the
 * feature not existing. Normalising away case and punctuation also absorbs the
 * gap between a label and the slug derived from it.
 *
 * Exported because `ui:theme` and its two siblings live in `ui.ts` — switching
 * is a plain interface action; this module is authoring.
 */
export function resolveThemeArg<T extends { id: string; label: string }>(
  raw: string, registry: Record<string, T>,
): T | null {
  const want = raw.trim()
  if (!want) return null
  if (registry[want]) return registry[want]
  const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  const n = norm(want)
  const all = Object.values(registry)
  return all.find((t) => norm(t.id) === n)
    ?? all.find((t) => norm(t.label) === n)
    ?? null
}

const asKind = (raw: string): ThemeKind | null => {
  const k = raw.trim().toLowerCase()
  if (k === 'system' || k === 'app' || k === 'interface') return 'system'
  if (k === 'code' || k === 'syntax' || k === 'r') return 'code'
  if (k === 'markdown' || k === 'md' || k === 'prose') return 'markdown'
  return null
}

const registryFor = (kind: ThemeKind): Record<string, { id: string; label: string }> =>
  kind === 'system' ? THEMES : kind === 'code' ? CODE_THEMES : MARKDOWN_THEMES

const isShipped = (kind: ThemeKind, id: string): boolean =>
  kind === 'system' ? id in BUILTIN_THEMES
  : kind === 'code' ? id in BUILTIN_CODE_THEMES
  : id in BUILTIN_MARKDOWN_THEMES

/** The user's copy of a theme, or a message saying why there isn't one. */
function mine(kind: ThemeKind, id: string):
  | { ok: true; theme: CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme }
  | { ok: false; error: string } {
  const s = useCustomThemeStore.getState()
  const found =
    kind === 'system' ? s.system.find((t) => t.id === id)
    : kind === 'code' ? s.code.find((t) => t.id === id)
    : s.markdown.find((t) => t.id === id)
  if (found) return { ok: true, theme: found }
  if (isShipped(kind, id)) {
    const label = registryFor(kind)[id]?.label ?? id
    return {
      ok: false,
      error: `"${label}" ships with ouRGeo and cannot be edited — an update would ` +
        `overwrite the change. Run theme:duplicate with kind="${kind}", id="${id}" ` +
        `to get an editable copy, then edit that.`,
    }
  }
  return {
    ok: false,
    error: `No ${KIND_LABEL[kind].toLowerCase()} with id "${id}". ` +
      `Run theme:list to see what is installed.`,
  }
}

const save = (
  kind: ThemeKind,
  theme: CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme,
): void => {
  const s = useCustomThemeStore.getState()
  if (kind === 'system') s.saveSystem(theme as CustomSystemTheme)
  else if (kind === 'code') s.saveCode(theme as CustomCodeTheme)
  else s.saveMarkdown(theme as CustomMarkdownTheme)
}

/**
 * A `{key: hex}` map the model wrote, checked against `allowed`.
 *
 * Both halves matter. An unknown key is reported with the list of real ones —
 * a model that guessed `background` for `bg` corrects itself in one turn. And
 * a bad colour is caught here rather than at `defineTheme`.
 */
function readColors(
  raw: unknown, allowed: readonly string[], what: string,
): { ok: true; colors: Record<string, string> } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${what} must be an object of colour-name → hex.` }
  }
  const out: Record<string, string> = {}
  const bad: string[] = []
  const unknown: string[] = []
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(k)) { unknown.push(k); continue }
    const hex = normalizeHex(v)
    if (!hex) { bad.push(`${k}=${JSON.stringify(v)}`); continue }
    out[k] = hex
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `${what}: no such colour ${unknown.map((k) => `"${k}"`).join(', ')}. ` +
        `Valid names: ${allowed.join(', ')}.`,
    }
  }
  if (bad.length > 0) {
    return {
      ok: false,
      error: `${what}: not a hex colour — ${bad.join(', ')}. Use "#rrggbb" ` +
        `(three-digit "#abc" is accepted and expanded). Colour names are not.`,
    }
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: `${what} was empty — nothing to change.` }
  }
  return { ok: true, colors: out }
}

const hexes = (o: Record<string, unknown>, keys: readonly string[]): string =>
  keys.map((k) => `${k}=${String(o[k])}`).join(' ')

/** The contrast pairs worth reporting — the ones that make a theme unreadable
 *  when they go wrong, which is the failure a model cannot see. */
function contrastReport(
  pairs: Array<[string, string, string]>,
): string {
  return pairs
    .map(([label, fg, bg]) => {
      const r = contrastRatio(fg, bg)
      return `${label} ${r.toFixed(1)}:1${r < 4.5 ? ' (LOW — aim for 4.5:1)' : ''}`
    })
    .join(', ')
}

export const themeActions: UiAction[] = [
  {
    id: 'theme:list',
    group: 'theme',
    tier: 'always',
    summary:
      'List every installed theme on all three axes — the ones ouRGeo ships and the ones the user has built — with the id of each and which are in use. The switching actions accept any id listed here.',
    params: [],
    run: () => {
      const t = useThemeStore.getState()
      const line = (
        id: string, label: string, custom: boolean | undefined, active: string,
      ): string =>
        `  ${id === active ? '*' : ' '} ${id} — ${label}${custom ? " (the user's own)" : ''}`
      return ok(
        'Installed themes (* = in use).',
        [
          'Interface themes (ui:theme):',
          ...themeList().map((x) => line(x.id, x.label, x.custom, t.current)),
          'Code themes (ui:codeTheme):',
          ...codeThemeList().map((x) => line(x.id, x.label, x.custom, t.codeTheme)),
          'Markdown themes (ui:markdownTheme):',
          ...markdownThemeList().map((x) => line(x.id, x.label, x.custom, t.markdownTheme)),
        ].join('\n'),
      )
    },
  },

  {
    id: 'theme:inspect',
    group: 'theme',
    tier: 'always',
    summary:
      'Every colour in one theme, plus its contrast ratios. Use it to copy a look the user likes, or to check a theme you just built is readable.',
    params: [
      { name: 'kind', type: 'enum', values: KINDS, required: true, description: 'Which axis: system (the interface), code, or markdown.' },
      { name: 'id', type: 'string', required: true, description: 'Theme id, from theme:list.' },
    ],
    run: (args) => {
      const kind = asKind(argStr(args, 'kind'))
      if (!kind) return fail('kind must be system, code or markdown.')
      const id = argStr(args, 'id')
      if (kind === 'system') {
        const t = THEMES[id]
        if (!t) return fail(`No interface theme "${id}". Run theme:list.`)
        const c = systemColorsFromDef(t)
        const ch = t.editorChrome
        return ok(`${t.label} (${t.custom ? "the user's own" : 'ships with ouRGeo'}).`, [
          `id: ${t.id}   brightness: ${t.isDark ? 'dark' : 'light'}`,
          t.custom ? `started from: ${t.basedOn ?? 'dark'}` : '',
          `interface colours: ${hexes(c as unknown as Record<string, unknown>, SYSTEM_COLOR_KEYS)}`,
          `editor surface:    ${hexes(ch as unknown as Record<string, unknown>, CHROME_KEYS)}`,
          `defaults: code=${t.defaultCodeTheme} markdown=${t.defaultMarkdownTheme}` +
            (t.defaultBasemap ? ` basemap=${t.defaultBasemap}` : ''),
          `backdrop: ${t.backgroundImage ? `set, opacity ${t.backgroundOpacity ?? 0.15}` +
            `, ${(t.backgroundGrayscale ?? true) ? 'grey-scaled' : 'in colour'}` : 'none (generated scene)'}` +
            `   card image: ${t.iconImage ? 'set' : 'none'}`,
          `contrast: ${contrastReport([
            ['text on panel', c.fg, c.panel],
            ['muted on panel', c.muted, c.panel],
            ['accent on panel', c.accent, c.panel],
            ['editor text on editor', ch.fg, ch.panel],
            ['line numbers on editor', ch.muted, ch.panel],
          ])}`,
        ].filter(Boolean).join('\n'))
      }
      const reg = kind === 'code' ? CODE_THEMES : MARKDOWN_THEMES
      const keys = kind === 'code' ? CODE_COLOR_KEYS : MD_COLOR_KEYS
      const p = reg[id]
      if (!p) return fail(`No ${KIND_LABEL[kind].toLowerCase()} "${id}". Run theme:list.`)
      // A palette carries no background of its own, so it is only legible in
      // combination with one — judge it against the surface it is read on.
      const app = THEMES[useThemeStore.getState().current] ?? THEMES.dark
      const surface = app.editorChrome.panel
      return ok(`${p.label} (${p.custom ? "the user's own" : 'ships with ouRGeo'}).`, [
        `id: ${p.id}   listed for: ${p.isDark ? 'dark' : 'light'} app themes`,
        `colours: ${hexes(p as unknown as Record<string, unknown>, keys)}`,
        `contrast against ${app.label}'s editor background (${surface}): ` +
          contrastReport(keys.map((k) => [
            k, String((p as unknown as Record<string, string>)[k]), surface,
          ] as [string, string, string])),
      ].join('\n'))
    },
  },

  {
    id: 'theme:create',
    group: 'theme',
    tier: 'autopilot',
    summary:
      'Create a new theme for the user by copying an existing one. Every theme starts as a copy, so it is coherent before you change anything — then edit it with theme:setColors. Returns the new id.',
    params: [
      { name: 'kind', type: 'enum', values: KINDS, required: true, description: 'Which axis: system (the interface), code, or markdown.' },
      { name: 'name', type: 'string', required: true, description: 'What to call it, e.g. "Warm Night".' },
      { name: 'template', type: 'string', required: true, description: 'Id or name of the theme to copy — shipped or one of the user\'s. Pick the closest thing to what they asked for; theme:list has them all.' },
      { name: 'apply', type: 'boolean', required: false, default: false, description: 'Switch to it as soon as it is made. Saves a round trip when the user asked for a theme rather than for a theme file.' },
    ],
    run: (args) => {
      const kind = asKind(argStr(args, 'kind'))
      if (!kind) return fail('kind must be system, code or markdown.')
      const raw = argStr(args, 'template')
      const name = argStr(args, 'name').trim()
      if (!name) return fail('name is required.')
      const template = resolveThemeArg(raw, registryFor(kind))
      if (!template) {
        return fail(
          `No ${KIND_LABEL[kind].toLowerCase()} "${raw}" to copy. Run theme:list ` +
          `for the ids on this axis — a code theme cannot be the template for an app theme.`,
        )
      }
      const id = useCustomThemeStore.getState().createFrom(kind, template.id, name)
      const switcher =
        kind === 'system' ? 'ui:theme' : kind === 'code' ? 'ui:codeTheme' : 'ui:markdownTheme'
      if (argBool(args, 'apply')) {
        const t = useThemeStore.getState()
        if (kind === 'system') t.setTheme(id)
        else if (kind === 'code') t.setCodeTheme(id)
        else t.setMarkdownTheme(id)
        return ok(
          `Created "${name}" (id ${id}) as a copy of ${template.label}, and switched to it. ` +
          `Edit it with theme:setColors — changes show immediately while it is in use.`,
        )
      }
      return ok(
        `Created "${name}" (id ${id}) as a copy of ${template.label}. ` +
        `Edit it with theme:setColors, and switch to it with ` +
        `${switcher} theme="${id}".`,
      )
    },
  },

  {
    id: 'theme:setColors',
    group: 'theme',
    tier: 'autopilot',
    summary:
      "Change colours on one of the user's own themes. Pass only the ones you want to move — everything else is left alone. Takes effect immediately if the theme is in use.",
    params: [
      { name: 'kind', type: 'enum', values: KINDS, required: true, description: 'Which axis the theme is on.' },
      { name: 'id', type: 'string', required: true, description: "The theme's id. Must be one of the user's own — shipped themes are read-only." },
      {
        name: 'colors', type: 'json', required: false,
        description:
          'Object of colour-name → "#rrggbb". For system: ' + SYSTEM_COLOR_KEYS.join(', ') +
          ' (bg = deepest surface, panel = toolbars and dialogs, muted = secondary text, fg = primary text). ' +
          'For code: ' + CODE_COLOR_KEYS.join(', ') +
          '. For markdown: ' + MD_COLOR_KEYS.join(', ') + '.',
      },
      {
        name: 'chrome', type: 'json', required: false,
        description:
          'System themes only — the EDITOR surface, which is separate from the interface: ' +
          CHROME_KEYS.join(', ') + ' (panel = the editor background, bg = the current-line ' +
          'highlight, accent = caret and selection, muted = line numbers, fg = editor text).',
      },
    ],
    run: (args) => {
      const kind = asKind(argStr(args, 'kind'))
      if (!kind) return fail('kind must be system, code or markdown.')
      const id = argStr(args, 'id')
      const found = mine(kind, id)
      if (!found.ok) return fail(found.error)

      const rawColors = argJson(args, 'colors')
      const rawChrome = argJson(args, 'chrome')
      if (rawColors === undefined && rawChrome === undefined) {
        return fail('Pass "colors" (and, for a system theme, "chrome") — nothing to change.')
      }
      if (rawChrome !== undefined && kind !== 'system') {
        return fail('"chrome" applies only to a system theme; a palette has no surface of its own.')
      }

      const changed: string[] = []

      if (kind === 'system') {
        const t = { ...found.theme } as CustomSystemTheme
        if (rawColors !== undefined) {
          const res = readColors(rawColors, SYSTEM_COLOR_KEYS, 'colors')
          if (!res.ok) return fail(res.error)
          t.colors = { ...t.colors, ...res.colors } as SystemColors
          changed.push(...Object.keys(res.colors))
        }
        if (rawChrome !== undefined) {
          const res = readColors(rawChrome, CHROME_KEYS, 'chrome')
          if (!res.ok) return fail(res.error)
          t.chrome = { ...t.chrome, ...res.colors } as EditorChrome
          changed.push(...Object.keys(res.colors).map((k) => `editor.${k}`))
        }
        save(kind, t)
        return ok(
          `Updated ${t.label}: ${changed.join(', ')}.`,
          `contrast now: ${contrastReport([
            ['text on panel', t.colors.fg, t.colors.panel],
            ['muted on panel', t.colors.muted, t.colors.panel],
            ['accent on panel', t.colors.accent, t.colors.panel],
            ['editor text on editor', t.chrome.fg, t.chrome.panel],
          ])}`,
        )
      }

      const keys = kind === 'code' ? CODE_COLOR_KEYS : MD_COLOR_KEYS
      const res = readColors(rawColors, keys, 'colors')
      if (!res.ok) return fail(res.error)
      const t = { ...found.theme, ...res.colors } as CustomCodeTheme | CustomMarkdownTheme
      save(kind, t)
      const app = THEMES[useThemeStore.getState().current] ?? THEMES.dark
      return ok(
        `Updated ${t.label}: ${Object.keys(res.colors).join(', ')}.`,
        `contrast against ${app.label}'s editor background: ` +
          contrastReport(Object.entries(res.colors).map(([k, v]) =>
            [k, v, app.editorChrome.panel] as [string, string, string])),
      )
    },
  },

  {
    id: 'theme:configure',
    group: 'theme',
    tier: 'autopilot',
    summary:
      "Set an app theme's non-colour properties: its name, whether it counts as dark or light, which code and markdown palettes it defaults to, its basemap, and how strongly its backdrop image is painted.",
    params: [
      { name: 'id', type: 'string', required: true, description: "The app theme's id. Must be one of the user's own." },
      { name: 'name', type: 'string', required: false, description: 'Rename it.' },
      { name: 'isDark', type: 'boolean', required: false, description: 'Whether this is a dark theme. Chooses Monaco\'s base and which palettes the pickers list first.' },
      { name: 'codeTheme', type: 'string', required: false, description: 'Id of the code palette this theme starts with. Selecting the theme applies it.' },
      { name: 'markdownTheme', type: 'string', required: false, description: 'Id of the markdown palette this theme starts with.' },
      { name: 'basemap', type: 'string', required: false, description: 'Basemap id the Spatial Editor opens with under this theme, e.g. carto-dark-matter. Pass "" to follow the template.' },
      { name: 'backdropOpacity', type: 'number', required: false, description: 'How strongly the editor backdrop is painted, 0–1. The shipped scenes use 0.15.' },
      { name: 'backdropGrayscale', type: 'boolean', required: false, description: 'Whether the backdrop is grey-scaled. True for the shipped scenes; a photograph usually wants false and a lower opacity.' },
    ],
    run: (args) => {
      const id = argStr(args, 'id')
      const found = mine('system', id)
      if (!found.ok) return fail(found.error)
      const t = { ...found.theme } as CustomSystemTheme
      const changed: string[] = []

      const name = argStr(args, 'name').trim()
      if (name) { t.label = name; changed.push(`name → ${name}`) }
      if (args.isDark !== undefined) {
        t.isDark = argBool(args, 'isDark', t.isDark)
        changed.push(`brightness → ${t.isDark ? 'dark' : 'light'}`)
      }
      const code = argStr(args, 'codeTheme').trim()
      if (code) {
        if (!(code in CODE_THEMES)) return fail(`No code theme "${code}". Run theme:list.`)
        t.defaultCodeTheme = code
        changed.push(`code theme → ${CODE_THEMES[code].label}`)
      }
      const md = argStr(args, 'markdownTheme').trim()
      if (md) {
        if (!(md in MARKDOWN_THEMES)) return fail(`No markdown theme "${md}". Run theme:list.`)
        t.defaultMarkdownTheme = md
        changed.push(`markdown theme → ${MARKDOWN_THEMES[md].label}`)
      }
      if (args.basemap !== undefined) {
        const bm = argStr(args, 'basemap').trim()
        if (bm && !(bm in BASEMAPS_BY_ID)) {
          return fail(
            `No basemap "${bm}". Ids look like carto-dark-matter, carto-positron, ` +
            `esri-satellite, osm-topo — map:listBasemaps has the full set.`,
          )
        }
        t.defaultBasemap = bm
        changed.push(`basemap → ${bm ? BASEMAPS_BY_ID[bm].name : 'follow the template'}`)
      }
      if (args.backdropOpacity !== undefined) {
        const n = Number(args.backdropOpacity)
        if (!Number.isFinite(n) || n < 0 || n > 1) return fail('backdropOpacity must be between 0 and 1.')
        t.backgroundOpacity = n
        changed.push(`backdrop opacity → ${Math.round(n * 100)}%`)
      }
      if (args.backdropGrayscale !== undefined) {
        t.backgroundGrayscale = argBool(args, 'backdropGrayscale', t.backgroundGrayscale)
        changed.push(`backdrop ${t.backgroundGrayscale ? 'grey-scaled' : 'in colour'}`)
      }

      if (changed.length === 0) return fail('Nothing to change — pass at least one property.')
      save('system', t)
      return ok(`${t.label}: ${changed.join(', ')}.`)
    },
  },

  {
    id: 'theme:setImage',
    group: 'theme',
    tier: 'autopilot',
    summary:
      "Give an app theme a backdrop image (painted behind the code editor) or a card image (its tile in the theme picker), from a file on disk. The picture is embedded in the theme, so an exported theme carries its own artwork.",
    params: [
      { name: 'id', type: 'string', required: true, description: "The app theme's id. Must be one of the user's own." },
      { name: 'slot', type: 'enum', values: ['backdrop', 'card'], required: true, description: 'backdrop = behind the code editor; card = the theme\'s tile in the App Theme picker.' },
      { name: 'path', type: 'string', required: false, description: 'Absolute path to a PNG, JPEG, WebP, SVG, GIF or AVIF file. Omit it (with clear=true) to remove the image.' },
      { name: 'clear', type: 'boolean', required: false, default: false, description: 'Remove the image instead of setting one.' },
    ],
    run: async (args): Promise<ActionResult> => {
      const id = argStr(args, 'id')
      const found = mine('system', id)
      if (!found.ok) return fail(found.error)
      const t = { ...found.theme } as CustomSystemTheme
      const slot = argStr(args, 'slot').trim().toLowerCase()
      if (slot !== 'backdrop' && slot !== 'card') return fail('slot must be "backdrop" or "card".')
      const spec = slot === 'backdrop' ? BACKGROUND_SPEC : ICON_SPEC

      if (argBool(args, 'clear')) {
        if (slot === 'backdrop') t.backgroundImage = null
        else t.iconImage = null
        save('system', t)
        return ok(
          `Removed ${t.label}'s ${slot} image.` +
          (slot === 'backdrop' ? ' The editor goes back to the generated scene.' : ''),
        )
      }

      const path = argStr(args, 'path').trim()
      if (!path) return fail('Pass "path" to a local image file, or clear=true to remove one.')
      const mime = mimeForPath(path)
      if (!mime) {
        return fail(
          `ouRGeo cannot read "${path}" as an image. Supported: ${spec.formats.join(', ')}.`,
        )
      }
      let uri: string
      try {
        uri = `data:${mime};base64,${await window.electronAPI.file.readBinary(path)}`
      } catch {
        return fail(`Could not read "${path}". Check the path exists.`)
      }
      const check = validateImageDataUri(uri, spec)
      if (!check.ok) return fail(check.error)
      if (slot === 'backdrop') t.backgroundImage = check.uri
      else t.iconImage = check.uri
      save('system', t)
      return ok(
        `Set ${t.label}'s ${slot} image from ${path}.` +
        (slot === 'backdrop'
          ? ` It is painted at ${Math.round((t.backgroundOpacity ?? 0.15) * 100)}% opacity` +
            `${t.backgroundGrayscale ? ', grey-scaled' : ', in colour'} — ` +
            `theme:configure changes both.`
          : ''),
      )
    },
  },

  {
    id: 'theme:duplicate',
    group: 'theme',
    tier: 'autopilot',
    summary:
      'Copy any theme — including one that ships with ouRGeo — into an editable theme of the user\'s own. This is how you start from a shipped theme.',
    params: [
      { name: 'kind', type: 'enum', values: KINDS, required: true, description: 'Which axis the theme is on.' },
      { name: 'id', type: 'string', required: true, description: 'Id of the theme to copy.' },
      { name: 'name', type: 'string', required: false, description: 'Name for the copy. Defaults to "<original> copy".' },
    ],
    run: (args) => {
      const kind = asKind(argStr(args, 'kind'))
      if (!kind) return fail('kind must be system, code or markdown.')
      const id = argStr(args, 'id')
      const reg = registryFor(kind)
      if (!(id in reg)) return fail(`No ${KIND_LABEL[kind].toLowerCase()} "${id}". Run theme:list.`)
      const name = argStr(args, 'name').trim() || `${reg[id].label} copy`
      const store = useCustomThemeStore.getState()
      // Shipped themes are not in the bundle, so `duplicate` cannot see them —
      // `createFrom` reads the live registry and covers both cases.
      const newId = isShipped(kind, id)
        ? store.createFrom(kind, id, name)
        : store.duplicate(kind, id)
      if (!newId) return fail(`Could not copy "${id}".`)
      return ok(`Copied ${reg[id].label} to "${name}" (id ${newId}). That copy is editable.`)
    },
  },

  {
    id: 'theme:delete',
    group: 'theme',
    tier: 'confirm',
    summary:
      "Delete one of the user's own themes for good. If it is in use, ouRGeo falls back to the theme it was built from.",
    params: [
      { name: 'kind', type: 'enum', values: KINDS, required: true, description: 'Which axis the theme is on.' },
      { name: 'id', type: 'string', required: true, description: "The theme's id. Shipped themes cannot be deleted." },
    ],
    run: (args) => {
      const kind = asKind(argStr(args, 'kind'))
      if (!kind) return fail('kind must be system, code or markdown.')
      const id = argStr(args, 'id')
      const found = mine(kind, id)
      if (!found.ok) return fail(found.error)
      const label = found.theme.label
      useCustomThemeStore.getState().remove(kind, id)
      return ok(`Deleted "${label}".`)
    },
  },

  {
    id: 'theme:export',
    group: 'theme',
    tier: 'autopilot',
    summary:
      'Write one of the user\'s themes to a .ourgeotheme.json file they can keep or share. Artwork travels inside the file.',
    params: [
      { name: 'kind', type: 'enum', values: KINDS, required: true, description: 'Which axis the theme is on.' },
      { name: 'id', type: 'string', required: true, description: "The theme's id. Must be one of the user's own — duplicate a shipped one first." },
      { name: 'path', type: 'string', required: true, description: 'Absolute path to write, ending .ourgeotheme.json.' },
    ],
    run: async (args): Promise<ActionResult> => {
      const kind = asKind(argStr(args, 'kind'))
      if (!kind) return fail('kind must be system, code or markdown.')
      const id = argStr(args, 'id')
      const path = argStr(args, 'path').trim()
      if (!path) return fail('path is required.')
      const found = mine(kind, id)
      if (!found.ok) return fail(found.error)
      const payload =
        kind === 'system' ? exportSystemTheme(found.theme as CustomSystemTheme)
        : kind === 'code' ? exportCodeTheme(found.theme as CustomCodeTheme)
        : exportMarkdownTheme(found.theme as CustomMarkdownTheme)
      try {
        await window.electronAPI.file.write(path, buildThemeFile(kind, [payload]))
      } catch {
        return fail(`Could not write "${path}".`)
      }
      return ok(`Exported "${found.theme.label}" to ${path}.`)
    },
  },

  {
    id: 'theme:import',
    group: 'theme',
    tier: 'autopilot',
    summary:
      'Read a .ourgeotheme.json file and install the themes in it. The file says which axis it is for, so an app theme can never land in the code-theme list.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to a .ourgeotheme.json file.' },
      { name: 'kind', type: 'enum', values: KINDS, required: false, description: 'Insist the file be for this axis. Omit to accept whatever it holds.' },
    ],
    run: async (args): Promise<ActionResult> => {
      const path = argStr(args, 'path').trim()
      if (!path) return fail('path is required.')
      const rawKind = argStr(args, 'kind').trim()
      const expected = rawKind ? asKind(rawKind) : undefined
      if (rawKind && !expected) return fail('kind must be system, code or markdown.')
      let text: string
      try {
        text = await window.electronAPI.file.read(path)
      } catch {
        return fail(`Could not read "${path}".`)
      }
      const parsed = parseThemeFile(text, expected ?? undefined)
      if (!parsed.ok) return fail(parsed.error)
      const ids = useCustomThemeStore.getState().addImported(
        parsed.kind,
        parsed.themes as Array<CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme>,
      )
      const names = parsed.themes.map((t, i) => `"${t.label}" (id ${ids[i]})`).join(', ')
      return ok(
        `Imported ${parsed.themes.length} ${KIND_LABEL[parsed.kind].toLowerCase()}` +
        `${parsed.themes.length === 1 ? '' : 's'} from the ${TAB_LABEL[parsed.kind]} axis: ${names}.`,
      )
    },
  },
]
