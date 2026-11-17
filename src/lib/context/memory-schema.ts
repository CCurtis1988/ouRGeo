import type { MemoryRecord, ProjectContext } from './types'
import { redactContext } from './policy'

export function validateProjectContext(input: unknown, projectId: string | null): ProjectContext {
  const empty: ProjectContext = { version: 1, revision: 0, memories: [] }
  if (!input || typeof input !== 'object') return empty
  const context = input as Partial<ProjectContext>
  if (context.version !== 1 || !Array.isArray(context.memories) || context.memories.length > 10000) return empty
  const seen = new Set<string>()
  const memories = context.memories.filter((m): m is MemoryRecord => {
    if (!validMemoryShape(m, 'project', projectId) || seen.has(m.id)) return false
    seen.add(m.id)
    return true
  }).map(m => normalisedMemory(m, projectId))
  return { version: 1, revision: Number.isSafeInteger(context.revision) ? context.revision! : 0, memories }
}

export function forkProjectContext(context: ProjectContext, projectId: string): ProjectContext {
  return { version: 1, revision: 0, memories: context.memories.filter(m => m.status === 'active').map(m => ({ ...m, id: crypto.randomUUID(), projectId, lineage: m.id, supersedes: [], revision: 1 })) }
}

const sourceId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) && redactContext(value) === value
const canonicalId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)

/** One record check for every memory that arrives from a file — a project
 * bundle or an About you export — so neither path can admit a field the other
 * would refuse. Credentials are refused, not stripped: a statement edited by
 * redaction is no longer the statement the user asked to keep.
 *
 * Returns the first problem in words, because an expert editing a plain
 * export by hand needs to know which field to fix, not that "it" is damaged. */
export function memoryShapeProblem(m: unknown, scope: MemoryRecord['scope'], projectId: string | null): string | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'is not an object'
  const r = m as Partial<MemoryRecord>
  const date = (value: unknown): boolean => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
  if (!canonicalId(r.id)) return 'id must be a UUID such as 3f1c2a9e-0b7d-4c1e-9a55-2e8f6b1d4c70'
  if (r.scope !== scope) return `scope must be "${scope}"`
  if (r.projectId !== projectId) return `projectId must be ${projectId === null ? 'null' : `"${projectId}"`}`
  if (typeof r.statement !== 'string' || !r.statement.trim()) return 'statement must be non-empty text'
  if (r.statement.length > 4000) return 'statement must be at most 4000 characters'
  if (redactContext(r.statement) !== r.statement) return 'statement looks like it contains a credential (a key, token or password); remove it'
  if (!Number.isSafeInteger(r.revision) || r.revision! < 1) return 'revision must be a whole number of at least 1'
  if (!['preference', 'instruction', 'decision', 'finding'].includes(r.category!)) return 'category must be "preference", "instruction", "decision" or "finding"'
  if (!['active', 'candidate', 'superseded', 'expired', 'conflicted'].includes(r.status!)) return 'status must be "active", "candidate", "superseded", "expired" or "conflicted"'
  if (!['user-declared', 'observed', 'inferred'].includes(r.assertion!)) return 'assertion must be "user-declared", "observed" or "inferred"'
  if (!Array.isArray(r.evidence) || r.evidence.length > 32 || !r.evidence.every(sourceId)) return 'evidence must be a list of at most 32 source ids'
  if (!Array.isArray(r.supersedes) || r.supersedes.length > 32 || !r.supersedes.every(canonicalId)) return 'supersedes must be a list of at most 32 memory UUIDs'
  if (r.lineage !== undefined && !canonicalId(r.lineage)) return 'lineage, when present, must be a memory UUID'
  if (!date(r.createdAt)) return 'createdAt must be an ISO date such as 2026-11-17T09:00:00.000Z'
  if (!date(r.updatedAt)) return 'updatedAt must be an ISO date such as 2026-11-17T09:00:00.000Z'
  for (const field of ['editedAt', 'expiresAt', 'lastSupportedAt', 'candidateSince'] as const) if (r[field] !== undefined && !date(r[field])) return `${field}, when present, must be an ISO date`
  return null
}

export function validMemoryShape(m: unknown, scope: MemoryRecord['scope'], projectId: string | null): m is MemoryRecord {
  return memoryShapeProblem(m, scope, projectId) === null
}

/** Every field a memory record may carry, as `normalisedMemory` copies them. */
export const MEMORY_FIELDS: ReadonlySet<string> = new Set(['id', 'revision', 'scope', 'projectId', 'category', 'statement', 'evidence', 'assertion', 'createdAt', 'updatedAt', 'status', 'supersedes', 'pinned', 'editedAt', 'expiresAt', 'candidateSince', 'lastSupportedAt', 'lineage'])

/** Copies only known fields, so an unknown key in a file never reaches storage. */
export function normalisedMemory(m: MemoryRecord, projectId: string | null): MemoryRecord {
  return { id: m.id, revision: m.revision, scope: m.scope, projectId, category: m.category, statement: m.statement, evidence: m.evidence, assertion: m.assertion, createdAt: m.createdAt, updatedAt: m.updatedAt, status: m.status, supersedes: m.supersedes, ...(m.pinned === true ? { pinned: true } : {}), ...(m.editedAt ? { editedAt: m.editedAt } : {}), ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}), ...(m.candidateSince ? { candidateSince: m.candidateSince } : {}), ...(m.lastSupportedAt ? { lastSupportedAt: m.lastSupportedAt } : {}), ...(typeof m.lineage === 'string' ? { lineage: m.lineage.slice(0, 128) } : {}) }
}
