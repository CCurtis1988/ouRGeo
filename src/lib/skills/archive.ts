// What a skill `.zip` may contribute, decided before any entry is decompressed.
//
// Pure, so Vitest covers it; `electron/main/skill-files.ts` reads the bytes. The
// rules are the folder import's (same limits, same resource folders), plus what an
// archive adds: paths that try to leave the archive, links, and declared sizes that
// are checked again against the bytes actually inflated (a zip can lie about them).

import { isDotPath, safeEntryPath, MAX_ARCHIVE_ENTRIES } from '../plugins/archive-policy'

export const SKILL_RESOURCE_DIRS = ['references', 'templates', 'scripts', 'assets']
export const SKILL_MAX_FILES = 64
export const SKILL_MAX_FILE = 512 * 1024
export const SKILL_MAX_TOTAL = 4 * 1024 * 1024

export interface SkillArchiveEntry {
  /** The path as the archive names it. */
  name: string
  /** Declared uncompressed size. */
  size: number
  isDirectory: boolean
  /** A symbolic link (from the entry's Unix mode). */
  isLink?: boolean
  encrypted?: boolean
}

export type SkillArchivePlan =
  | {
    ok: true
    /** Archive entry name of the SKILL.md. */
    skillEntry: string
    /** Folder holding the SKILL.md ('' at the top level); names the skill when its front matter does not. */
    folder: string
    /** Resource files to read: archive name, and path relative to the skill folder. */
    resources: Array<{ name: string; path: string }>
    skipped: string[]
  }
  | { ok: false; error: string }

export function planSkillArchive(entries: SkillArchiveEntry[]): SkillArchivePlan {
  if (entries.length > MAX_ARCHIVE_ENTRIES) return { ok: false, error: `The archive holds more than ${MAX_ARCHIVE_ENTRIES} entries, which is not a skill.` }
  const files: Array<SkillArchiveEntry & { path: string }> = []
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const path = safeEntryPath(entry.name)
    if (path === null) return { ok: false, error: `The archive has a path that leaves it ("${entry.name}"), so it was not opened.` }
    // macOS adds __MACOSX/ and .DS_Store; neither is part of a skill.
    if (isDotPath(path) || path.startsWith('__MACOSX/')) continue
    files.push({ ...entry, path })
  }

  // The SKILL.md at the top, or inside one folder (how a zipped skill folder looks).
  const candidates = files.filter(f => /^(?:[^/]+\/)?SKILL\.md$/.test(f.path))
  if (candidates.length === 0) return { ok: false, error: 'The archive has no SKILL.md, at its top level or inside one folder.' }
  if (candidates.length > 1) {
    return { ok: false, error: `The archive holds ${candidates.length} skills (${candidates.map(c => c.path).join(', ')}). Import them one at a time.` }
  }
  const skill = candidates[0]
  if (skill.isLink) return { ok: false, error: 'The SKILL.md in the archive is a link, not a file.' }
  if (skill.encrypted) return { ok: false, error: 'The SKILL.md in the archive is password-protected.' }
  if (skill.size > SKILL_MAX_FILE) return { ok: false, error: 'The SKILL.md in the archive is over 512 KB, which is too large for a skill.' }
  const folder = skill.path.includes('/') ? skill.path.slice(0, skill.path.indexOf('/')) : ''
  const prefix = folder ? `${folder}/` : ''

  const resources: Array<{ name: string; path: string }> = [], skipped: string[] = []
  let total = 0
  for (const file of files) {
    if (file === skill || !file.path.startsWith(prefix)) continue
    const rel = file.path.slice(prefix.length)
    const top = rel.split('/')[0]
    if (!rel.includes('/') || !SKILL_RESOURCE_DIRS.includes(top)) continue
    if (rel.split('/').length > 5) { skipped.push(`${rel} (nested too deep)`); continue }
    if (file.isLink) { skipped.push(`${rel} (a link)`); continue }
    if (file.encrypted) { skipped.push(`${rel} (password-protected)`); continue }
    if (resources.length >= SKILL_MAX_FILES) { skipped.push(`${rel} (more than ${SKILL_MAX_FILES} files)`); continue }
    if (file.size > SKILL_MAX_FILE) { skipped.push(`${rel} (over 512 KB)`); continue }
    if (total + file.size > SKILL_MAX_TOTAL) { skipped.push(`${rel} (the skill's files are over 4 MB)`); continue }
    resources.push({ name: file.name, path: rel }); total += file.size
  }
  return { ok: true, skillEntry: skill.name, folder, resources, skipped }
}

/** Text check shared with the folder import: a NUL in the first 8000 bytes means binary. */
export const looksBinary = (bytes: Uint8Array): boolean => bytes.subarray(0, 8000).includes(0)
