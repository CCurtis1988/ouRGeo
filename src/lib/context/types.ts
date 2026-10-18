export type ContextKind = 'skill' | 'action' | 'environment' | 'console' | 'document' | 'conversation' | 'memory' | 'result'
export type ContextScope = 'conversation' | 'project' | 'global' | 'application' | 'workspace'
export type ContextEffort = 'efficient' | 'balanced' | 'thorough'
export type ContextError = 'STALE_REFERENCE' | 'SOURCE_BUSY' | 'SOURCE_UNAVAILABLE' | 'BUDGET_LIMIT' | 'SCOPE_CHANGED' | 'PROVIDER_OFFLINE'
export interface DocumentRange { startLine: number; endLine: number }

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
  requiredSkills?: string[]
  requiredSources?: string[]
  legacyIds?: string[]
  resource?: { environment: string; name: string }
  group?: string
  /** Original recorded console input, used only for narrow local dependency routing. */
  command?: string
  read: (signal?: AbortSignal) => Promise<string> | string
  /** Open buffers can slice a bounded span without copying the whole document. */
  readRange?: (range: DocumentRange, signal?: AbortSignal) => Promise<string> | string
  projectFile?: { projectId: string; id: string; mediaType: string; coverage: string; metadataOnly?: boolean }
  readLocated?: (location: import('../project-files').ProjectFileLocation | undefined, offset: number, signal?: AbortSignal) => Promise<import('../project-files').ProjectFileRead>
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
  location?: import('../project-files').ProjectFileLocation
  citation?: string
  delivery?: 'selected' | 'sent' | 'acknowledged' | 'uncertain'
}

export interface ContextTrace {
  turnId: string
  recordedAt?: number
  evidenceExpired?: true
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
  expiresAt?: string
  candidateSince?: string
  lastSupportedAt?: string
}

export interface ProjectContext {
  version: 1
  revision: number
  memories: MemoryRecord[]
}

export interface MemoryForgetReceipt {
  local: 'excluded'
  managed: 'removed' | 'pending'
  recovery?: string
}

/** Content-free local cleanup status. Remote deletion has a separate ledger. */
export interface MemoryCleanupStatus {
  pending: number
  needsReview: number
  nextAttemptAt: string | null
}

export interface MemoryDeletion {
  scope: 'global' | 'project'
  projectId: string | null
  lease: string | null
  sources: string[]
}

export interface AuthorisedFileLink { id: string; filePath: string }
