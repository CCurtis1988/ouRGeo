export type HealthStatus = 'pass' | 'warning' | 'error' | 'skipped'
export interface HealthResult {
  id: string
  title: string
  status: HealthStatus
  detail: string
  repaired?: boolean
}
export interface HealthReport { completedAt: string; results: HealthResult[] }
export interface HealthHistory { prompted: boolean; report: HealthReport | null }
export interface HealthPackage {
  name: string
  group: string
  version: string
  available: string
  built: string
  loaded: boolean
  reason: string
}
export interface HealthPackageCopy {
  name: string
  version: string
  library: string
  built: string
  active: boolean
  removable: boolean
}
export interface RHealth {
  path: string | null
  version: string | null
  supported: boolean
  configuredPathBroken: boolean
  packages: HealthPackage[]
  duplicates: HealthPackageCopy[]
  updatesChecked: boolean
  githubUpdatesChecked?: boolean
  s2?: { ok: boolean; detail: string; repair: string; library: string }
  library: string | null
  libraryWritable: boolean
  tools: { pandoc: boolean; latex: boolean }
  error?: string
}
export interface InstallPlan {
  command: string | null
  args: string[]
  label: string
  detail: string
  manualUrl: string
}
export interface HealthHardware {
  platform: string
  arch: string
  totalRamGB: number
  freeRamGB: number
  storage: { label: string; path: string; freeGB: number | null; writable: boolean }[]
  gpus: { name: string; vramGB: number | null; freeVramGB: number | null }[]
  unifiedMemory: boolean
  gpuNote: string
}
export interface HealthAPI {
  history(): Promise<HealthHistory>
  activity(): Promise<{ busy: boolean; progress: string; error: string | null; needsRRestart: boolean }>
  acknowledge(): Promise<void>
  saveReport(report: HealthReport): Promise<void>
  checkR(): Promise<RHealth>
  checkPackages(): Promise<RHealth>
  installPlan(target: 'r' | 'ollama'): Promise<InstallPlan>
  install(target: 'r' | 'ollama', approved: boolean): Promise<void>
  repairPackages(names: string[], approved: boolean): Promise<RHealth>
  removePackageCopies(copies: HealthPackageCopy[], approved: boolean): Promise<RHealth>
  connectR(approved: boolean): Promise<{ ready: boolean; detail: string }>
  hardware(): Promise<HealthHardware>
  ollamaModels(): Promise<{ models: string[]; error?: string }>
  startOllama(approved: boolean): Promise<void>
  pullModel(model: string, approved: boolean): Promise<void>
  onProgress(callback: (message: string) => void): () => void
}
