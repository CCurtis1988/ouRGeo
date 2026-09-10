// What a `.ourgeoplugin` archive is allowed to contain.
//
// Pure, and imported by `electron/main/plugins.ts` rather than written there —
// the same arrangement `src/lib/terminal/shells.ts` has with `terminal.ts`, and
// for the same reason: it lives under `src/` so the renderer's Vitest suite
// covers it (tsconfig.node.json lists it so main can compile against it).
// Nothing here touches a disk; the caller reads and writes the bytes.
//
// It exists because of a real hole. A `.ourgeoplugin` used to come from the
// user's own machine — someone sent you a file and you chose to open it. With
// the plugin store it also arrives from a stranger, and three things about the
// old import were only safe under the old assumption:
//
//  1. **The compile cache travelled inside the archive.** `plugins:pack` used
//     adm-zip's `addLocalFolder`, which walks dotfiles, so `.build/<key>.js`
//     went in; `plugins:unpack` restored it. The loader then hashes only the
//     files `plugins:listFiles` reports — and that call SKIPS dotfiles — so an
//     archive could carry innocuous sources plus a precomputed cache entry
//     under the key those sources hash to, and the loader would run the cache
//     entry without compiling anything. A moderator reading the source would
//     have read code that never ran. Dot-prefixed paths are now dropped at both
//     ends.
//  2. **The traversal guard was `entryName.includes('..')`** — a substring test
//     that refuses the innocent `a..b.ts` and accepts the absolute
//     `/etc/passwd`. It is now a normalisation that cannot express either.
//  3. **There was no ceiling at all**, so an archive that unpacked to a full
//     disk was a supported input.

/** Total uncompressed bytes an archive may hold. */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

/** How many files an archive may hold. */
export const MAX_ARCHIVE_ENTRIES = 2000

/** The manifest, which must be at the archive's top level. */
export const MANIFEST_ENTRY = 'ourgeo-plugin.json'

/** A plugin id is a directory name, so it is re-validated on the way in. */
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,63}$/

/** One archive entry, as much of it as the policy needs to see. */
export interface ArchiveEntry {
  /** The path inside the archive, separators either way round. */
  name: string
  /** Uncompressed size in bytes. */
  size: number
  isDirectory: boolean
}

/** An entry that survived, with the path it should be written to. */
export interface PlannedEntry {
  /** The entry as the archive names it, for reading the bytes back out. */
  name: string
  /** Where it goes, relative to the plugin folder. Always `/`-separated,
   *  never absolute, and guaranteed not to climb out. */
  path: string
}

export type ExtractionPlan =
  | { ok: true; entries: PlannedEntry[]; bytes: number }
  | { ok: false; error: string }

/**
 * True for a path with a dot-prefixed segment — `.build/x.js`,
 * `.ourgeo-store.json`.
 *
 * These are ouRGeo's own scratch files inside a plugin folder, and they are
 * deliberately invisible to `plugins:listFiles`. See note 1 in the header for
 * what that asymmetry let an archive do.
 */
export function isDotPath(name: string): boolean {
  // `.` and `..` are navigation, not hidden files. Counting them here would
  // make `../../evil.js` a silent DROP rather than the refusal it has to be —
  // an archive that tried to escape would install looking perfectly ordinary.
  return name.split(/[\\/]/).some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')
}

/**
 * Collapse `.` and `..` and normalise separators, or return null if the path
 * escapes its own root.
 *
 * Same shape as `normalize` in `compile.ts`, with one difference that is the
 * whole point: that one lets a `..` fall off the top because nothing above the
 * plugin folder is in its file map, and here it is a refusal, because this one
 * writes to a disk.
 */
export function safeEntryPath(name: string): string | null {
  if (/^([a-zA-Z]:)?[\\/]/.test(name)) return null      // absolute, either platform
  const out: string[] = []
  for (const part of name.split(/[\\/]/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.length > 0 ? out.join('/') : null
}

/**
 * Read the plugin id out of the manifest an archive carries.
 *
 * Re-validated here rather than trusted, because the id becomes a directory
 * name and this is the only place a hostile one could traverse.
 */
export function readArchiveId(manifestText: string): { id: string } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch {
    return { error: 'That plugin’s ourgeo-plugin.json is not valid JSON, so it cannot be installed.' }
  }
  const id = String((parsed as { id?: unknown } | null)?.id ?? '')
  if (!PLUGIN_ID_RE.test(id)) {
    return {
      error: `That plugin's id (${id ? `"${id}"` : 'missing'}) is not a valid plugin id. ` +
        'An id is lowercase letters, digits and hyphens, starting with a letter.',
    }
  }
  return { id }
}

/**
 * Decide what an archive's entries unpack to, or refuse the archive.
 *
 * Every refusal names the number it exceeded and what that suggests, because
 * the honest reading of a 2,001-file "plugin" is that the user picked the wrong
 * file — and telling them the limit without telling them that leaves them
 * hunting for a plugin bug they do not have.
 */
export function planExtraction(entries: ArchiveEntry[]): ExtractionPlan {
  const kept: PlannedEntry[] = []
  let bytes = 0

  for (const e of entries) {
    if (e.isDirectory) continue
    // Dropped without comment: they are ouRGeo's files, never the author's, so
    // there is nothing for the user to act on and no reason to make an archive
    // written by an older ouRGeo look broken.
    if (isDotPath(e.name)) continue

    const path = safeEntryPath(e.name)
    if (path === null) {
      return {
        ok: false,
        error: `That plugin archive contains an unsafe path ("${e.name}"), so it was not installed.`,
      }
    }
    if (kept.length >= MAX_ARCHIVE_ENTRIES) {
      return {
        ok: false,
        error: `That plugin archive holds more than ${MAX_ARCHIVE_ENTRIES} files. ` +
          'That is far more than a plugin needs — check you picked the right file.',
      }
    }
    bytes += Math.max(0, e.size)
    if (bytes > MAX_ARCHIVE_BYTES) {
      return {
        ok: false,
        error: `That plugin archive unpacks to more than ${Math.round(MAX_ARCHIVE_BYTES / 1e6)} MB. ` +
          'That is far more than a plugin needs — check you picked the right file.',
      }
    }
    kept.push({ name: e.name, path })
  }

  if (!kept.some((k) => k.path === MANIFEST_ENTRY)) {
    return {
      ok: false,
      error: `That file has no ${MANIFEST_ENTRY} at its top level, so it is not an ouRGeo plugin.`,
    }
  }
  return { ok: true, entries: kept, bytes }
}
