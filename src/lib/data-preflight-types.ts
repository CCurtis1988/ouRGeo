/** Backend-owned, revision-bound plans; an unchecked result is not permission. */
export type PreflightStatus = 'ready' | 'needs_confirmation' | 'blocked' | 'checking' | 'cancelled' | 'failed'
export interface PreflightInput {
  name: string
  envName?: string
  accessPath?: string
  pkColumn?: string
  rows?: number[]
  selectionVersion?: number
  excludedRows?: number[]
  exclusionReason?: string
}
export interface PreflightRequest {
  operationType: string
  inputs: PreflightInput[]
  parameters: Record<string, string>
  outputEnv?: string
}
export interface PreflightIssue {
  stableCode: string
  checkStatus: 'passed' | 'warning' | 'blocked' | 'not_applicable' | 'not_checked' | 'check_failed'
  severity: 'info' | 'warning' | 'blocked'
  layerId: string | null
  field: string | null
  affectedCount: number | null
  rowIdentityReference: string
  boundedExamples: string[]
  message: string
  consequence: string
  suggestedActions: string[]
  requiresAcknowledgment: boolean
  overridable: boolean
}
export interface DataProfile {
  layerId: string
  sourceName: string
  totalRows: number
  selectedRows: number
  identityKind: string
  fields: { name: string; type: string; nullCount: number; blankCount: number; nonFiniteCount: number; duplicateCount: number | null; units: string | null }[]
  crs: { known: boolean; description: string | null; identifier: string | null; units: string | null; wkt?: string; geographic?: boolean } | null
  geometry: { valid: number; invalid: number; empty: number; uncheckable: number } | null
  geometryCheck: string
  geometryTypes: string[]
  dimensions: string[]
  extent: (number | null)[] | null
}
export interface PreflightReport {
  schemaVersion: 1
  operationId: string
  operationType: string
  status: PreflightStatus
  validationFingerprint?: string
  inputRevisions?: { layerId: string; revision: string }[]
  selectionRevision?: string
  parametersDigest?: string
  checkedAt?: string
  executionCode?: string
  coverage: { complete: boolean; rowsChecked: number; totalRows?: number; scope?: string }
  issues: PreflightIssue[]
  profiles: DataProfile[]
  executionPlan?: {
    workingCRSDescription?: string
    workingCRS: string | null
    method: string | null
    methodSettings?: { bufferDistance: number; bufferDistanceUnit: string; maxCells: number | null; segmentsPerQuadrant: number | null }
    inputAndOutputUnits: { input: (string | null)[]; parameter: string | null; output: string | null } | null
    explicitTransformations: unknown[]
    includedAndExcludedRows: { layerId: string; selectedCount: number; includedCount: number; excludedCount: number; includedReference: string; excludedReference: string; reason: string | null }[]
    joinPolicy: { leftKey: string; rightKey: string; keyTypes: { left: string | string[]; right: string | string[] }; nullLeft: number; nullRight: number; blankLeft: number; blankRight: number; joinType: string; leftRows: number; rightRows: number; unmatchedLeft: number; unmatchedRight: number; missingLeft: number; missingRight: number; duplicateLeft: number; duplicateRight: number; predictedRows: number; relationship: string; keyPolicy: string } | null
    missingValuePolicy: { policy: string; totalRows: number; missingOrNonFinite: number; usableRows: number; units: string | null; allMissingResult: string } | null
    exportProfileAndOptions: ExportProfile | null
  }
  acknowledgments?: { issueCode: string; fingerprint: string }[]
  error?: string
  executionPhase?: string
  executionResult?: { success: boolean; code?: string; path?: string; featureCount?: number; verified?: boolean; error?: string }
  success?: boolean
}

export interface ExportProfile {
  driver: string
  path: string
  layer: string
  mode: string
  sourceCRS: string
  destinationCRS: string
  axisConvention: string
  geometryTypes: string[]
  dimensions: string[]
  curves: string
  fields: { retained: string[]; omitted: string[]; converted: string[]; schema: { name: string; sourceType: string; destinationType: string; conversion: string }[] }
  coordinatePrecision: number | null
  geometryTolerance: number
  datasetOptions: string[]
  layerOptions: string[]
  readbackOptions: string[]
  featureCount: number
  coverage: string
}
