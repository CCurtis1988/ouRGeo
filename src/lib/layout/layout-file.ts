// A workspace arrangement as a portable file.
//
// The format follows `.ourgeotheme.json`, deliberately: an envelope that says
// what the file IS, so a file picked by mistake is answered with a sentence
// naming it rather than a complaint about a missing property. The three files
// most likely to be chosen here — a theme, `layout.json` itself, a project
// bundle's manifest — are all recognised by name.
//
// Refusing a version from the future rather than half-reading it is the same
// rule `loadLayout` follows, and for the same reason: a half-understood layout
// still renders, so nothing looks broken and the user is left with a workspace
// they did not arrange and cannot explain.

import { LAYOUT_VERSION, type LayoutState } from './model'

/** The file format's own version, independent of `LAYOUT_VERSION`. */
export const LAYOUT_FILE_VERSION = 1

export interface LayoutPresetFile {
  name: string
  layout: LayoutState
}

interface Envelope {
  ourgeoLayout?: { version?: number }
  presets?: unknown
}

export function buildLayoutFile(presets: LayoutPresetFile[]): string {
  return JSON.stringify(
    { ourgeoLayout: { version: LAYOUT_FILE_VERSION }, presets },
    null, 2,
  )
}

export type ParsedLayoutFile =
  | { ok: true; presets: LayoutPresetFile[] }
  | { ok: false; error: string }

/** What a file that isn't a layout actually is, when we can tell. */
function identify(data: Record<string, unknown>): string | null {
  if (data.ourgeoTheme) return 'an ouRGeo theme file'
  if (data.themeId || data.codeThemeId) return "ouRGeo's theme.json, which records which themes are selected"
  if (data.manifestVersion || data.contributes) return 'an ouRGeo plugin manifest'
  if (data.ui && data.databases) return "a project bundle's manifest"
  // layout.json holds the same shape under `layout`, but no envelope: it is the
  // live workspace, not an exported arrangement. Read it rather than refuse it.
  return null
}

export function parseLayoutFile(text: string): ParsedLayoutFile {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'That file is not an ouRGeo layout.' }
  }

  const env = data as Envelope
  if (!env.ourgeoLayout) {
    const what = identify(data)
    if (what) return { ok: false, error: `That is ${what}, not a workspace layout.` }
    // ouRGeo's own layout.json — one arrangement, no name of its own.
    const live = (data as { layout?: LayoutState }).layout
    if (live && (live.version === 1 || live.version === LAYOUT_VERSION) && live.zones) {
      return { ok: true, presets: [{ name: 'Imported layout', layout: live }] }
    }
    return { ok: false, error: 'That file is not an ouRGeo layout.' }
  }

  const version = env.ourgeoLayout.version ?? 0
  if (version > LAYOUT_FILE_VERSION) {
    return {
      ok: false,
      error: `That layout was written by a newer version of ouRGeo (format ${version}). Update ouRGeo to open it.`,
    }
  }

  if (!Array.isArray(env.presets) || env.presets.length === 0) {
    return { ok: false, error: 'That layout file holds no arrangements.' }
  }

  const presets: LayoutPresetFile[] = []
  for (const raw of env.presets as LayoutPresetFile[]) {
    if (!raw || typeof raw.name !== 'string' || !raw.layout || typeof raw.layout !== 'object') continue
    if (raw.layout.version !== 1 && raw.layout.version !== LAYOUT_VERSION) continue
    presets.push({ name: raw.name.trim() || 'Imported layout', layout: raw.layout })
  }
  if (presets.length === 0) {
    return {
      ok: false,
      // The plural case is the honest one: a file can hold several and lose
      // only some, and saying "none of them" would be wrong.
      error: 'None of the arrangements in that file could be read — they were saved by a different version of ouRGeo.',
    }
  }
  return { ok: true, presets }
}

/** A filename stem the save dialog can offer. */
export function layoutFileName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'layout'
}
