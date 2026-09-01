// The user's themes on disk, in their own file.
//
// NOT folded into `theme.json`. That file records which themes are SELECTED —
// three ids and a zoom level, merged on every click of a picker — while this
// one holds the themes themselves, including inlined artwork that can run to
// megabytes. Sharing a file would mean rewriting every embedded image each
// time the user tried a different code theme, and it would put the definition
// of the active theme in the same `merge()` that a rapid click sequence
// races. Separate files, separate lifetimes.
//
// Like every other config here it survives a crash and is never deleted on
// exit: a theme the user spent an evening on is not session state.

import { createJsonFileStore } from '@/lib/persistence'
import {
  EMPTY_BUNDLE, THEME_FILE_VERSION,
  parseSystemThemes, parseCodeThemes, parseMarkdownThemes,
  type CustomThemeBundle,
} from '@/lib/custom-themes'

const store = createJsonFileStore('custom-themes.json', 'Custom themes')

interface StoredBundle {
  version?: unknown
  system?: unknown
  code?: unknown
  markdown?: unknown
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * Read the bundle, dropping anything that no longer parses.
 *
 * A malformed entry is skipped rather than thrown, and one bad theme never
 * costs the user the rest: the parsers report the FIRST failure in a list, so
 * each theme is run through its parser alone. The alternative — refusing to
 * load the file — would turn a stale field into "all my themes are gone".
 */
export async function loadCustomThemes(): Promise<CustomThemeBundle> {
  let data: StoredBundle
  try {
    data = await store.read<StoredBundle>()
  } catch {
    return EMPTY_BUNDLE
  }
  if (typeof data.version === 'number' && data.version > THEME_FILE_VERSION) {
    console.warn('[Custom themes] File written by a newer ouRGeo; ignoring.')
    return EMPTY_BUNDLE
  }
  const salvage = <T>(
    raw: unknown, parse: (xs: unknown[]) => { ok: true; themes: T[] } | { ok: false; error: string },
  ): T[] => {
    const out: T[] = []
    for (const one of arr(raw)) {
      const res = parse([one])
      if (res.ok) out.push(...res.themes)
      else console.warn('[Custom themes] Dropped a theme:', res.error)
    }
    return out
  }
  return {
    system: salvage(data.system, parseSystemThemes),
    code: salvage(data.code, parseCodeThemes),
    markdown: salvage(data.markdown, parseMarkdownThemes),
  }
}

export async function saveCustomThemes(bundle: CustomThemeBundle): Promise<void> {
  await store.write({ version: THEME_FILE_VERSION, ...bundle })
}
