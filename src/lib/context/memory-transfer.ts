import type { MemoryRecord } from './types'
import { MEMORY_FIELDS, memoryShapeProblem, normalisedMemory } from './memory-schema'
import { redactContext } from './policy'

/** About you memory lives in the encrypted profile store, whose key is held by
 * this machine's OS keyring. The local "encrypted backup" therefore cannot
 * leave the machine: another keyring cannot unlock it. This is the portable
 * form — the payload a passphrase-sealed `.ourgeomemory.json` file carries.
 *
 * Only ACCEPTED (active) About you memories travel. Suggestions are not yet
 * the user's word, and project/conversation memories already travel with
 * their project bundle. */
export const ABOUT_YOU_FORMAT = 'ourgeo-about-you'
export const ABOUT_YOU_VERSION = 1
export const ABOUT_YOU_MAX_RECORDS = 5000

export interface AboutYouPayload {
  format: typeof ABOUT_YOU_FORMAT
  version: typeof ABOUT_YOU_VERSION
  exportedAt: string
  memories: MemoryRecord[]
}

export type AboutYouImportMode = 'merge' | 'replace'
/** 'none' = plain JSON: readable and editable outside ouRGeo, and by anyone holding it. */
export type AboutYouProtection = 'passphrase' | 'none'

export interface AboutYouImportReceipt {
  mode: AboutYouImportMode
  added: number
  updated: number
  /** Already here with the same words — nothing to do. */
  unchanged: number
  /** Merge only: the same memory exists here with different words; yours is kept. */
  kept: number
  /** Forgotten on this machine. Importing never brings a forgotten memory back. */
  forgotten: number
  /** Replace only: About you memories here that the file did not contain. */
  removed: number
}

const sameWords = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

/** Evidence names message ids from this profile's chats, and `supersedes`
 * names records the file may not hold; neither means anything elsewhere. An
 * exported memory is the user's statement, not its local history. */
export function aboutYouExport(records: MemoryRecord[], now = new Date()): AboutYouPayload {
  const memories = records.filter(r => r.scope === 'global' && r.status === 'active')
    .map(r => normalisedMemory({ ...r, evidence: [], supersedes: [] }, null))
  return { format: ABOUT_YOU_FORMAT, version: ABOUT_YOU_VERSION, exportedAt: now.toISOString(), memories }
}

/** Written into plain exports only, and ignored on import. Plain files are
 * for experts: an edited file must keep exactly the format ouRGeo writes —
 * there is deliberately no "just a statement" shorthand. */
export const ABOUT_YOU_README = [
  'ouRGeo About you memory export (plain, NOT encrypted: anyone with this file can read it).',
  'Import: Settings > AI Assistant > Storage & recovery > Import About you memory.',
  'Editing is for expert users. Keep every field ouRGeo wrote; the file is refused, naming the entry and field, if anything does not match.',
  'Editable: statement (max 4000 characters, no credentials), category (preference | instruction | decision | finding), pinned (true | false).',
  'Do not change id: a forgotten memory stays forgotten on import only while its id is unchanged. To add a memory, copy an entry and give it a NEW random UUID.',
  'status must be "active"; scope must be "global"; projectId must be null; evidence and supersedes must be [].',
  'Other top-level fields than _readme, format, version, exportedAt and memories are refused, as are unknown memory fields.',
]

const PAYLOAD_FIELDS = new Set(['_readme', 'format', 'version', 'exportedAt', 'memories'])

/** Refuses the whole file rather than importing part of it: a file that is
 * not what it says is not one to take some memories from. Unknown fields are
 * refused too — ouRGeo never writes one, so in an edited file it is a typo
 * ("statment", "pinnned") that would otherwise be dropped without a word. */
export function validateAboutYouPayload(input: unknown): AboutYouPayload {
  const p = input as Partial<AboutYouPayload> | null
  if (!p || typeof p !== 'object' || p.format !== ABOUT_YOU_FORMAT) throw new Error('This file is not an ouRGeo About you export. Choose a file made by Export About you memory.')
  if (p.version !== ABOUT_YOU_VERSION) throw new Error(`This export is format version ${String(p.version)}; this ouRGeo reads version ${ABOUT_YOU_VERSION}. Update ouRGeo, then import it again.`)
  const extra = Object.keys(p).filter(key => !PAYLOAD_FIELDS.has(key))
  if (extra.length) throw new Error(`This export has fields ouRGeo does not write: ${extra.slice(0, 5).join(', ')}. Remove them, then import again.`)
  if (!Array.isArray(p.memories)) throw new Error('This export has no memories list. Export again from ouRGeo.')
  if (p.memories.length > ABOUT_YOU_MAX_RECORDS) throw new Error(`An export holds at most ${ABOUT_YOU_MAX_RECORDS} memories. Split the file, then import each part.`)
  const seen = new Map<string, number>()
  const memories = p.memories.map((m, index) => {
    // Quote the statement so an expert can find the entry — unless it holds a
    // credential, which an error message must not repeat, even in part.
    const statement = (m as MemoryRecord | null)?.statement
    const entry = `Memory ${index + 1}${typeof statement === 'string' && statement.trim() && redactContext(statement) === statement ? ` (“${statement.slice(0, 40)}”)` : ''}`
    const problem = memoryShapeProblem(m, 'global', null)
    if (problem) throw new Error(`${entry}: ${problem}. Nothing was imported.`)
    const unknown = Object.keys(m).filter(key => !MEMORY_FIELDS.has(key))
    if (unknown.length) throw new Error(`${entry}: unknown field ${unknown.slice(0, 3).join(', ')}. Nothing was imported.`)
    if (m.pinned !== undefined && typeof m.pinned !== 'boolean') throw new Error(`${entry}: pinned must be true or false. Nothing was imported.`)
    if (m.status !== 'active') throw new Error(`${entry}: status must be "active" — only accepted memories are exported. Nothing was imported.`)
    if (m.evidence.length || m.supersedes.length) throw new Error(`${entry}: evidence and supersedes must be []. Nothing was imported.`)
    if (seen.has(m.id)) throw new Error(`${entry}: id is the same as memory ${seen.get(m.id)! + 1}. Give each memory its own UUID. Nothing was imported.`)
    seen.set(m.id, index)
    return normalisedMemory(m, null)
  })
  return { format: ABOUT_YOU_FORMAT, version: ABOUT_YOU_VERSION, exportedAt: typeof p.exportedAt === 'string' ? p.exportedAt.slice(0, 64) : '', memories }
}

export function plainAboutYouFile(payload: AboutYouPayload): string {
  return `${JSON.stringify({ _readme: ABOUT_YOU_README, ...payload }, null, 2)}\n`
}

export interface AboutYouImportPlan {
  save: MemoryRecord[]
  forget: string[]
  receipt: AboutYouImportReceipt
}

/** Pure: the storage worker supplies what only it knows.
 * - `forgotten`: tombstoned ids. A forgotten memory stays forgotten, in both modes.
 * - `foreign`: ids already claimed by a project here; those import as copies.
 *
 * Ids are kept otherwise, so importing the same file twice is a no-op and a
 * memory forgotten after import is not revived by importing again.
 *
 * Replace keeps a local record whose words match an imported one rather than
 * forgetting it and adding a twin: the result is the same set of memories
 * with fewer tombstones, and pinning on the local copy survives. */
export function planAboutYouImport(current: MemoryRecord[], imported: MemoryRecord[], mode: AboutYouImportMode, forgotten: ReadonlySet<string>, foreign: ReadonlySet<string>, newId: () => string, now = new Date()): AboutYouImportPlan {
  const stamp = now.toISOString()
  const receipt: AboutYouImportReceipt = { mode, added: 0, updated: 0, unchanged: 0, kept: 0, forgotten: 0, removed: 0 }
  const local = current.filter(r => r.scope === 'global')
  const byId = new Map(local.map(r => [r.id, r]))
  const keep = new Set<string>()
  const save: MemoryRecord[] = []
  const words: string[] = []
  for (const incoming of imported) {
    if (forgotten.has(incoming.id)) { receipt.forgotten++; continue }
    if (words.some(statement => sameWords(statement, incoming.statement))) { receipt.unchanged++; continue }
    const existing = byId.get(incoming.id)
    if (existing) {
      keep.add(existing.id)
      words.push(existing.statement)
      if (sameWords(existing.statement, incoming.statement) && existing.status === 'active') { receipt.unchanged++; continue }
      if (mode === 'merge') {
        // A suggestion here that the other machine accepted is now accepted.
        if (existing.status === 'candidate' && sameWords(existing.statement, incoming.statement)) { save.push({ ...existing, revision: existing.revision + 1, status: 'active', updatedAt: stamp }); receipt.updated++ }
        else receipt.kept++
        continue
      }
      save.push({ ...existing, revision: existing.revision + 1, statement: incoming.statement, category: incoming.category, assertion: incoming.assertion, status: 'active', updatedAt: stamp, editedAt: stamp, ...(incoming.pinned ? { pinned: true } : {}) })
      words.pop(); words.push(incoming.statement)
      receipt.updated++
      continue
    }
    const twin = local.find(r => ['active', 'candidate'].includes(r.status) && sameWords(r.statement, incoming.statement))
    if (twin) {
      keep.add(twin.id)
      words.push(twin.statement)
      if (twin.status === 'candidate') { save.push({ ...twin, revision: twin.revision + 1, status: 'active', updatedAt: stamp }); receipt.updated++ }
      else receipt.unchanged++
      continue
    }
    const id = foreign.has(incoming.id) ? newId() : incoming.id
    save.push({ ...incoming, id, revision: 1, status: 'active', evidence: [], supersedes: [], updatedAt: stamp })
    words.push(incoming.statement)
    receipt.added++
  }
  const forget = mode === 'replace' ? local.filter(r => !keep.has(r.id)).map(r => r.id) : []
  receipt.removed = forget.length
  return { save, forget, receipt }
}

export function describeAboutYouImport(r: AboutYouImportReceipt): string {
  const parts = [`${r.added} added`, ...(r.updated ? [`${r.updated} updated`] : []), ...(r.unchanged ? [`${r.unchanged} already here`] : []),
    ...(r.kept ? [`${r.kept} kept as you have them here`] : []), ...(r.forgotten ? [`${r.forgotten} skipped because you forgot them here`] : []),
    ...(r.mode === 'replace' ? [`${r.removed} removed`] : [])]
  return `About you memory ${r.mode === 'replace' ? 'replaced' : 'imported'}: ${parts.join(', ')}.`
}
