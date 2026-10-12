import type { MemoryRecord, ProjectContext } from './types'
import { redactContext } from './policy'

export function validateProjectContext(input: unknown, projectId: string | null): ProjectContext {
  const empty: ProjectContext = { version: 1, revision: 0, memories: [] }
  if (!input || typeof input !== 'object') return empty
  const context = input as Partial<ProjectContext>
  if (context.version !== 1 || !Array.isArray(context.memories) || context.memories.length > 10000) return empty
  const seen = new Set<string>()
  const sourceId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) && redactContext(value) === value
  const canonicalId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)
  const memories = context.memories.filter((m): m is MemoryRecord => {
    if (!m || typeof m.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(m.id) || seen.has(m.id) || m.scope !== 'project' || m.projectId !== projectId
        || typeof m.statement !== 'string' || m.statement.length > 4000 || !m.statement.trim() || redactContext(m.statement) !== m.statement
        || !Number.isSafeInteger(m.revision) || m.revision < 1 || !['preference', 'instruction', 'decision', 'finding'].includes(m.category)
        || !['active', 'candidate', 'superseded', 'expired', 'conflicted'].includes(m.status)
        || !['user-declared', 'observed', 'inferred'].includes(m.assertion)
        || !Array.isArray(m.evidence) || m.evidence.length > 32 || !m.evidence.every(sourceId)
        || !Array.isArray(m.supersedes) || m.supersedes.length > 32 || !m.supersedes.every(canonicalId)
        || (m.lineage !== undefined && !canonicalId(m.lineage))
        || (m.editedAt !== undefined && (typeof m.editedAt !== 'string' || m.editedAt.length > 64 || !Number.isFinite(Date.parse(m.editedAt))))
        || [m.expiresAt, m.lastSupportedAt, m.candidateSince].some(value => value !== undefined && (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))))
        || typeof m.createdAt !== 'string' || m.createdAt.length > 64 || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.updatedAt !== 'string' || m.updatedAt.length > 64 || !Number.isFinite(Date.parse(m.updatedAt))) return false
    seen.add(m.id)
    return true
  }).map(m => ({ id: m.id, revision: m.revision, scope: m.scope, projectId, category: m.category, statement: m.statement, evidence: m.evidence, assertion: m.assertion, createdAt: m.createdAt, updatedAt: m.updatedAt, status: m.status, supersedes: m.supersedes, ...(m.pinned === true ? { pinned: true } : {}), ...(m.editedAt ? { editedAt: m.editedAt } : {}), ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}), ...(m.candidateSince ? { candidateSince: m.candidateSince } : {}), ...(m.lastSupportedAt ? { lastSupportedAt: m.lastSupportedAt } : {}), ...(typeof m.lineage === 'string' ? { lineage: m.lineage.slice(0, 128) } : {}) }))
  return { version: 1, revision: Number.isSafeInteger(context.revision) ? context.revision! : 0, memories }
}

export function forkProjectContext(context: ProjectContext, projectId: string): ProjectContext {
  return { version: 1, revision: 0, memories: context.memories.filter(m => m.status === 'active').map(m => ({ ...m, id: crypto.randomUUID(), projectId, lineage: m.id, supersedes: [], revision: 1 })) }
}
