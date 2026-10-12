export interface ProviderActivationPreview {
  ref: string
  connectionId: string
  label: string
  scope: 'global' | 'project'
  operation: 'activate' | 'import'
  selectedCount: number
  estimatedIngestionMicros: number
  currency: 'USD'
  futureWrites: true
  expiresAt: string
}
export interface ProviderActivationStatus {
  connectionId: string
  state: 'review-required' | 'ready' | 'active' | 'paused'
  recovery: string
}
