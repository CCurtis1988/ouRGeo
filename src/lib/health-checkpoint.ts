import type { HealthHardware, HealthReport, HealthResult, RHealth } from './health-types'

export type HealthStep = 'welcome' | 'r' | 'packages' | 'system' | 'drafts' | 'ai' | 'summary'
export interface HealthCheckpoint {
  version: 1
  step: HealthStep
  running: boolean
  locked: boolean
  atCheckpoint: boolean
  pendingTitle: string | null
  selected: string[]
  results: HealthResult[]
  hardware: HealthHardware | null
  runtime: RHealth | null
  report: HealthReport | null
  progress: string
  installLog: string
  repairedPackages: boolean
}
const key = 'ourgeo.health-check.checkpoint'

// sessionStorage survives a renderer reload in this window, but does not reopen
// a dismissed health check in a new application session. Never persist promises
// or approval answers: recovery can recheck, but cannot replay a mutation.
export function loadHealthCheckpoint(): HealthCheckpoint | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as HealthCheckpoint
    if (value.version !== 1 || !['welcome', 'r', 'packages', 'system', 'drafts', 'ai', 'summary'].includes(value.step) ||
      typeof value.running !== 'boolean' || typeof value.locked !== 'boolean' || typeof value.atCheckpoint !== 'boolean' ||
      !Array.isArray(value.results) || !Array.isArray(value.selected) || !value.selected.every((item) => typeof item === 'string') ||
      typeof value.progress !== 'string' || typeof value.installLog !== 'string') return null
    return value
  } catch { return null }
}
export function saveHealthCheckpoint(checkpoint: HealthCheckpoint): void {
  try { sessionStorage.setItem(key, JSON.stringify(checkpoint)) } catch { /* storage may be unavailable */ }
}
export function clearHealthCheckpoint(): void {
  try { sessionStorage.removeItem(key) } catch { /* storage may be unavailable */ }
}
