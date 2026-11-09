// Reading and writing skill files for the Skill Manager.
//
// A skill is a SKILL.md, or a folder holding one plus supporting text files
// (agentskills.io: references/, templates/, scripts/, assets/). The renderer's
// general `file:read` takes any path, so a folder import would otherwise mean
// walking the disk from the renderer. Here main does the walking, bounded, and
// hands back only text: no symlinks, no dot-paths, no path that leaves the
// folder, and size limits that stop a stray folder from flooding the library.
// Nothing read here is ever executed; scripts are kept as text for the model to read.
// A `.zip` is read in memory (never extracted to disk) under the same rules, planned
// by the pure `src/lib/skills/archive.ts` before any entry is inflated.

import { dialog, type IpcMain } from 'electron'
import AdmZip from 'adm-zip'
import { lstat, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join, relative, sep } from 'path'
import { inflateRawSync } from 'zlib'
import {
  looksBinary, planSkillArchive, SKILL_MAX_FILE as MAX_FILE, SKILL_MAX_FILES as MAX_FILES,
  SKILL_MAX_TOTAL as MAX_TOTAL, SKILL_RESOURCE_DIRS as RESOURCE_DIRS,
} from '../../src/lib/skills/archive'

/** The compressed archive itself: a skill zip is small, and this bounds the read. */
const MAX_ZIP = 16 * 1024 * 1024

export interface SkillFileRead {
  /** The SKILL.md text. */
  text: string
  /** Folder or file name, for a skill whose front matter has no name. */
  fallbackName: string
  /** Supporting files by path relative to the skill folder, e.g. `references/style.md`. */
  resources: Record<string, string>
  /** Files left out, and why: shown to the user rather than dropped silently. */
  skipped: string[]
}

async function readSkillFolder(folder: string): Promise<SkillFileRead> {
  const text = await readFile(join(folder, 'SKILL.md'), 'utf8').catch(() => null)
  if (text === null) throw new Error(`"${basename(folder)}" has no SKILL.md. A skill folder holds a SKILL.md at its top level.`)
  const resources: Record<string, string> = {}, skipped: string[] = []
  let total = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const entry of await readdir(dir)) {
      const full = join(dir, entry), rel = relative(folder, full).split(sep).join('/')
      if (entry.startsWith('.')) continue
      const info = await lstat(full)
      if (info.isSymbolicLink()) { skipped.push(`${rel} (a link)`); continue }
      if (info.isDirectory()) { if (depth < 4) await walk(full, depth + 1); continue }
      if (Object.keys(resources).length >= MAX_FILES) { skipped.push(`${rel} (more than ${MAX_FILES} files)`); continue }
      if (info.size > MAX_FILE) { skipped.push(`${rel} (over 512 KB)`); continue }
      if (total + info.size > MAX_TOTAL) { skipped.push(`${rel} (the skill's files are over 4 MB)`); continue }
      const buffer = await readFile(full)
      if (looksBinary(buffer)) { skipped.push(`${rel} (not text)`); continue }
      resources[rel] = buffer.toString('utf8'); total += info.size
    }
  }
  for (const dir of RESOURCE_DIRS) {
    const full = join(folder, dir)
    const info = await lstat(full).catch(() => null)
    if (info?.isDirectory() && !info.isSymbolicLink()) await walk(full, 1)
  }
  return { text, fallbackName: basename(folder), resources, skipped }
}

/** Read one skill from a `.zip`, in memory. Declared sizes are checked before inflating and again after. */
export async function readSkillZip(path: string): Promise<SkillFileRead> {
  const name = basename(path)
  const info = await lstat(path)
  if (!info.isFile()) throw new Error(`"${name}" is not a file.`)
  if (info.size > MAX_ZIP) throw new Error(`"${name}" is over 16 MB, which is too large for a skill.`)
  let zip: AdmZip
  try { zip = new AdmZip(await readFile(path)) } catch { throw new Error(`"${name}" could not be read as a zip archive.`) }
  const entries = zip.getEntries()
  const plan = planSkillArchive(entries.map(e => ({
    name: e.entryName, size: e.header.size, isDirectory: e.isDirectory,
    // Unix mode lives in the high 16 bits of the external attributes; 0o120000 is a link.
    isLink: ((e.header.attr >>> 16) & 0o170000) === 0o120000,
    encrypted: (e.header.flags & 1) === 1,
  })))
  if (!plan.ok) throw new Error(`"${name}": ${plan.error}`)
  const byName = new Map(entries.map(e => [e.entryName, e]))
  // A header can understate its size, so inflate with a hard output cap rather
  // than trusting it (adm-zip's getData would inflate the whole entry first).
  const inflate = (entryName: string, limit: number): Buffer | null => {
    const entry = byName.get(entryName)
    if (!entry) return null
    const raw = entry.getCompressedData()
    try {
      if (entry.header.method === 0) return raw.length <= limit ? raw : null
      if (entry.header.method === 8) return inflateRawSync(raw, { maxOutputLength: limit })
    } catch { return null }
    return null // other compression methods are not used for skill files
  }
  const skillBytes = inflate(plan.skillEntry, MAX_FILE)
  if (!skillBytes) throw new Error(`"${name}": the SKILL.md is larger than it claims, or over 512 KB.`)
  if (looksBinary(skillBytes)) throw new Error(`"${name}": the SKILL.md is not text.`)
  const resources: Record<string, string> = {}, skipped = [...plan.skipped]
  let total = 0
  for (const r of plan.resources) {
    const data = inflate(r.name, MAX_FILE)
    if (!data || total + data.length > MAX_TOTAL) { skipped.push(`${r.path} (larger than it claims)`); continue }
    if (looksBinary(data)) { skipped.push(`${r.path} (not text)`); continue }
    resources[r.path] = data.toString('utf8'); total += data.length
  }
  return { text: skillBytes.toString('utf8'), fallbackName: plan.folder || name.replace(/\.zip$/i, ''), resources, skipped }
}

export function registerSkillFiles(ipcMain: IpcMain): void {
  ipcMain.handle('dialog:openSkill', async (_evt, kind: 'file' | 'folder'): Promise<SkillFileRead | null> => {
    const result = await dialog.showOpenDialog({
      title: kind === 'folder' ? 'Import a skill folder' : 'Import a skill',
      ...(kind === 'folder' ? {} : { filters: [{ name: 'Skill (SKILL.md or .zip)', extensions: ['md', 'markdown', 'zip'] }, { name: 'All Files', extensions: ['*'] }] }),
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const chosen = result.filePaths[0]
    if (kind === 'folder') return readSkillFolder(chosen)
    if (/\.zip$/i.test(chosen)) return readSkillZip(chosen)
    // A SKILL.md chosen directly: if it sits in a skill folder, bring that folder's files too.
    const info = await lstat(chosen)
    if (info.size > MAX_FILE) throw new Error(`"${basename(chosen)}" is over 512 KB, which is too large for a skill.`)
    if (basename(chosen) === 'SKILL.md') return readSkillFolder(dirname(chosen))
    return { text: await readFile(chosen, 'utf8'), fallbackName: basename(chosen).replace(/\.(md|markdown)$/i, ''), resources: {}, skipped: [] }
  })

  /** Write `<parent>/<name>/SKILL.md` and its files. Returns the folder written, or null if cancelled. */
  ipcMain.handle('dialog:exportSkill', async (_evt, name: string, text: string, resources: Record<string, string>): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ title: `Export "${name}" to a folder`, properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const safeName = basename(name).replace(/[^a-z0-9-]/gi, '-') || 'skill'
    const folder = join(result.filePaths[0], safeName)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'SKILL.md'), text, 'utf8')
    for (const [rel, body] of Object.entries(resources)) {
      const target = join(folder, rel)
      // Paths come from the library, which only stores relative ones; refuse any that escape anyway.
      if (relative(folder, target).startsWith('..') || rel.startsWith('/')) continue
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, body, 'utf8')
    }
    return folder
  })
}
