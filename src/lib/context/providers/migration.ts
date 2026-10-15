/** Migration never changes canonical scope or IDs. Its encrypted journal tracks
 * destination acknowledgement independently of deliberate old-copy retention. */
export interface ProviderMigration {
  id: string
  scope: string
  sourceBindingId: string
  destinationBindingId: string | null
  selectedIds: string[]
  sourceIds: string[]
  state: 'copying' | 'ready' | 'retained' | 'cleaning' | 'complete' | 'cancelled'
  cleanupBindingId?: string
  createdAt: string
  uncertainOperationIds: string[]
}
export interface ProviderMigrationStatus {
  id: string
  scope: 'global' | 'project'
  state: ProviderMigration['state']
  selectedCount: number
  copiedCount: number
  oldCopyCount: number
  removedCount: number
  recovery: string
}
