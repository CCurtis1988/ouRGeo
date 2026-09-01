import { create } from 'zustand'
import {
  installBundle, EMPTY_BUNDLE,
  buildThemeFile, parseThemeFile,
  exportSystemTheme, exportCodeTheme, exportMarkdownTheme,
  systemThemeFromTemplate, codeThemeFromTemplate, markdownThemeFromTemplate,
  uniqueThemeId, slugify,
  takenSystemIds, takenCodeIds, takenMarkdownIds,
  type CustomThemeBundle, type CustomSystemTheme,
  type CustomCodeTheme, type CustomMarkdownTheme, type ThemeKind,
} from '@/lib/custom-themes'
import { saveCustomThemes } from '@/lib/custom-themes-persistence'
import { THEMES } from '@/lib/themes'
import { useThemeStore } from '@/store/theme'

// The user's themes, and the one place that writes them.
//
// The registries in `themes.ts` / `editor-themes.ts` are plain mutable objects
// with stable identity, which is what every non-React consumer needs and
// exactly what React cannot subscribe to. So this store holds the same data a
// second time and components read it from here. `installBundle` keeps the two
// in step, and it is called on EVERY mutation — including the ones that only
// rename a theme — because the registries are what the map, the drawing layer
// and Monaco read a moment later.
//
// Every mutation also re-applies the active theme. Editing the theme you are
// looking at is the normal case in a theme editor, and an edit that took
// effect only after you switched away and back would read as a bug.

interface CustomThemeState extends CustomThemeBundle {
  /** Set once the boot read has finished, so the studio can say "loading" and
   *  a save cannot race an unfinished load into an empty file. */
  loaded: boolean
  init: (bundle: CustomThemeBundle) => void

  saveSystem: (theme: CustomSystemTheme) => void
  saveCode: (theme: CustomCodeTheme) => void
  saveMarkdown: (theme: CustomMarkdownTheme) => void

  remove: (kind: ThemeKind, id: string) => void
  duplicate: (kind: ThemeKind, id: string) => string | null

  /** Create from a template (shipped or the user's own). Returns the new id. */
  createFrom: (kind: ThemeKind, templateId: string, label: string) => string

  /** Add imported themes, re-keyed so nothing is overwritten. Returns ids. */
  addImported: (
    kind: ThemeKind,
    themes: Array<CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme>,
  ) => string[]
}

const bundleOf = (s: CustomThemeBundle): CustomThemeBundle => ({
  system: s.system, code: s.code, markdown: s.markdown,
})

/** Push a bundle to the registries, to disk, and back into the live UI. */
function commit(set: (p: Partial<CustomThemeState>) => void, bundle: CustomThemeBundle): void {
  installBundle(bundle)
  set({ ...bundle })
  void saveCustomThemes(bundle)
  useThemeStore.getState().refresh()
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((t) => t.id === item.id)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

export const useCustomThemeStore = create<CustomThemeState>((set, get) => ({
  ...EMPTY_BUNDLE,
  loaded: false,

  init: (bundle) => {
    installBundle(bundle)
    set({ ...bundle, loaded: true })
  },

  saveSystem: (theme) => {
    commit(set, { ...bundleOf(get()), system: upsert(get().system, theme) })
  },
  saveCode: (theme) => {
    commit(set, { ...bundleOf(get()), code: upsert(get().code, theme) })
  },
  saveMarkdown: (theme) => {
    commit(set, { ...bundleOf(get()), markdown: upsert(get().markdown, theme) })
  },

  remove: (kind, id) => {
    const s = get()
    const next: CustomThemeBundle =
      kind === 'system' ? { ...bundleOf(s), system: s.system.filter((t) => t.id !== id) }
      : kind === 'code' ? { ...bundleOf(s), code: s.code.filter((t) => t.id !== id) }
      : { ...bundleOf(s), markdown: s.markdown.filter((t) => t.id !== id) }

    // Get off the theme BEFORE it leaves the registry. `setTheme` on the
    // replacement writes that theme's editor defaults too, so a system theme
    // deleted while active never leaves a dangling code/markdown id behind.
    const theme = useThemeStore.getState()
    if (kind === 'system' && theme.current === id) {
      const t = THEMES[id]
      const fallback = t?.basedOn && THEMES[t.basedOn] && t.basedOn !== id ? t.basedOn : 'dark'
      theme.setTheme(fallback)
    } else if (kind === 'code' && theme.codeTheme === id) {
      theme.setCodeTheme((THEMES[theme.current] ?? THEMES.dark).defaultCodeTheme)
    } else if (kind === 'markdown' && theme.markdownTheme === id) {
      theme.setMarkdownTheme((THEMES[theme.current] ?? THEMES.dark).defaultMarkdownTheme)
    }
    commit(set, next)
  },

  duplicate: (kind, id) => {
    const s = get()
    if (kind === 'system') {
      const src = s.system.find((t) => t.id === id)
      if (!src) return null
      const label = `${src.label} copy`
      const newId = uniqueThemeId(label, takenSystemIds())
      commit(set, { ...bundleOf(s), system: [...s.system, { ...src, id: newId, label }] })
      return newId
    }
    if (kind === 'code') {
      const src = s.code.find((t) => t.id === id)
      if (!src) return null
      const label = `${src.label} copy`
      const newId = uniqueThemeId(label, takenCodeIds())
      commit(set, { ...bundleOf(s), code: [...s.code, { ...src, id: newId, label }] })
      return newId
    }
    const src = s.markdown.find((t) => t.id === id)
    if (!src) return null
    const label = `${src.label} copy`
    const newId = uniqueThemeId(label, takenMarkdownIds())
    commit(set, { ...bundleOf(s), markdown: [...s.markdown, { ...src, id: newId, label }] })
    return newId
  },

  createFrom: (kind, templateId, label) => {
    const s = get()
    if (kind === 'system') {
      const id = uniqueThemeId(label, takenSystemIds())
      const t = systemThemeFromTemplate(templateId, label, id)
      commit(set, { ...bundleOf(s), system: [...s.system, t] })
      return id
    }
    if (kind === 'code') {
      const id = uniqueThemeId(label, takenCodeIds())
      const t = codeThemeFromTemplate(templateId, label, id)
      commit(set, { ...bundleOf(s), code: [...s.code, t] })
      return id
    }
    const id = uniqueThemeId(label, takenMarkdownIds())
    const t = markdownThemeFromTemplate(templateId, label, id)
    commit(set, { ...bundleOf(s), markdown: [...s.markdown, t] })
    return id
  },

  addImported: (kind, themes) => {
    const s = get()
    const ids: string[] = []
    // Re-key against the LIVE registry as we go, not against a snapshot: a
    // file holding two themes with the same label would otherwise land both on
    // the same id and the second would swallow the first.
    const taken = new Set(
      kind === 'system' ? takenSystemIds()
      : kind === 'code' ? takenCodeIds() : takenMarkdownIds(),
    )
    const rekey = <T extends { id: string; label: string }>(t: T): T => {
      // An id that is free is kept — re-importing a theme you exported should
      // land back under its own name, not as "my-slate-2".
      const id = taken.has(t.id) || !t.id.startsWith('my-')
        ? uniqueThemeId(t.label || slugify(t.id), taken)
        : t.id
      taken.add(id)
      ids.push(id)
      return { ...t, id }
    }
    if (kind === 'system') {
      const added = (themes as CustomSystemTheme[]).map(rekey)
      commit(set, { ...bundleOf(s), system: [...s.system, ...added] })
    } else if (kind === 'code') {
      const added = (themes as CustomCodeTheme[]).map(rekey)
      commit(set, { ...bundleOf(s), code: [...s.code, ...added] })
    } else {
      const added = (themes as CustomMarkdownTheme[]).map(rekey)
      commit(set, { ...bundleOf(s), markdown: [...s.markdown, ...added] })
    }
    return ids
  },
}))

// ── Files ─────────────────────────────────────────────────────────────────

/** Write one theme (or a whole axis) to a `.ourgeotheme.json` the user picks.
 *  Resolves to the path written, or null if they cancelled. */
export async function exportThemes(
  kind: ThemeKind,
  themes: Array<CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme>,
  defaultName: string,
): Promise<string | null> {
  const payload =
    kind === 'system' ? (themes as CustomSystemTheme[]).map(exportSystemTheme)
    : kind === 'code' ? (themes as CustomCodeTheme[]).map(exportCodeTheme)
    : (themes as CustomMarkdownTheme[]).map(exportMarkdownTheme)
  const path = await window.electronAPI.dialog.saveTheme(slugify(defaultName))
  if (!path) return null
  await window.electronAPI.file.write(path, buildThemeFile(kind, payload))
  return path
}

/**
 * Pick a theme file and read it, insisting on `expected`.
 *
 * The kind check is the whole point of routing import through here: the caller
 * is a list of ONE axis, and handing it a file from another is the mistake the
 * format was designed to catch. A refusal comes back as a sentence naming what
 * the file actually is and which tab takes it.
 */
export async function importThemesFromFile(expected: ThemeKind): Promise<
  { ok: true; count: number; names: string[] } | { ok: false; error: string } | null
> {
  const path = await window.electronAPI.dialog.openTheme()
  if (!path) return null
  let text: string
  try {
    text = await window.electronAPI.file.read(path)
  } catch {
    return { ok: false, error: 'That file could not be read.' }
  }
  const parsed = parseThemeFile(text, expected)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const names = parsed.themes.map((t) => t.label)
  useCustomThemeStore.getState().addImported(
    parsed.kind,
    parsed.themes as Array<CustomSystemTheme | CustomCodeTheme | CustomMarkdownTheme>,
  )
  return { ok: true, count: parsed.themes.length, names }
}
