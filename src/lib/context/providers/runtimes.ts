export interface ManagedRuntimeStatus {
  id: string
  label: string
  version: string
  experimental: boolean
  platformSupported: boolean
  certification: 'pending'
  processing: 'local-profile-under-test'
  storage: 'readable-derived-sqlite'
  state: 'not-installed' | 'installing' | 'ready-for-certification' | 'failed' | 'cancelled'
  step?: 'download' | 'verify' | 'unpack' | 'health' | 'activate' | 'complete'
  receivedBytes?: number
  totalBytes?: number
  archiveLimitBytes: number
  measuredInstalledBytes: number
  canRollback: boolean
  error?: string
}
