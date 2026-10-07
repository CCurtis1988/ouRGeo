export type ContextKind = 'skill' | 'action' | 'environment' | 'console' | 'document' | 'conversation' | 'memory' | 'result'
export type ContextScope = 'conversation' | 'project' | 'global' | 'application' | 'workspace'
export type ContextEffort = 'efficient' | 'balanced' | 'thorough'
export type ContextError = 'STALE_REFERENCE' | 'SOURCE_BUSY' | 'SOURCE_UNAVAILABLE' | 'BUDGET_LIMIT' | 'SCOPE_CHANGED' | 'PROVIDER_OFFLINE'

export interface ContextIdentity {
  chatId: string
  projectId: string | null
  workspaceEpoch: number
  policyRevision: number
}

export interface ContextSource {
  id: string
  kind: ContextKind
  scope: ContextScope
  title: string
  summary: string
  revision: string
  timestamp?: string
  trust: 'host' | 'user' | 'observed' | 'untrusted'
  prerequisites?: string
  legacyIds?: string[]
  resource?: { environment: string; name: string }
  group?: string
  read: (signal?: AbortSignal) => Promise<string> | string
}

export interface ContextEvidence {
  ref: string
  sourceId: string
  kind: ContextKind
  scope: ContextScope
  title: string
  revision: string
  reason: string
  content: string
  estimatedTokens: number
  completeness: 'complete' | 'partial'
  delivery?: 'selected' | 'sent' | 'acknowledged' | 'uncertain'
}

export interface ContextTrace {
  turnId: string
  identity: ContextIdentity
  target: string
  state: 'prepared' | 'sent' | 'acknowledged' | 'uncertain'
  selected: ContextEvidence[]
  invocations: { inputTokens: number; window: number; estimated: true; sentRefs?: string[] }[]
  usage?: import('./usage').UsageReport[]
  retrievalCalls: number
  returnedTokens: number
  excluded: string[]
  limitations?: string[]
}

export interface MemoryRecord {
  id: string
  revision: number
  scope: 'project' | 'global'
  projectId: string | null
  category: 'preference' | 'instruction' | 'decision' | 'finding'
  statement: string
  evidence: string[]
  assertion: 'user-declared' | 'observed' | 'inferred'
  createdAt: string
  updatedAt: string
  status: 'candidate' | 'active' | 'superseded' | 'expired' | 'conflicted' | 'deleted'
  supersedes: string[]
  lineage?: string
  pinned?: boolean
  editedAt?: string
}

export interface ProjectContext {
  version: 1
  revision: number
  memories: MemoryRecord[]
}

export interface MemoryDeletion {
  scope: 'global' | 'project'
  projectId: string | null
  lease: string | null
  sources: string[]
}

export interface AuthorisedFileLink { id: string; filePath: string }
