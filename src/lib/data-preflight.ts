import { rClient } from './r-client'
import type { PreflightInput, PreflightReport, PreflightRequest } from './data-preflight-types'
import type { ToolDef, Values } from '@/components/toolbox/tools'
import { useEnvironmentStore } from '@/store/environment'
import { useSelectionStore } from '@/store/selection'
import { useSessionStore } from '@/store/session'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { rStr } from './r-identifier'

const trackedSelections = new Map<string, { name: string; envName: string }>()
let selectionSync: Promise<void> = Promise.resolve()
useSelectionStore.subscribe((state, previous) => {
  if (state.revision === previous.revision) return
  for (const { name, envName } of trackedSelections.values()) {
    selectionSync = selectionSync.then(() => rClient.preflightSelection(name, envName, state.getSelection(name, envName), state.revision)).catch(() => {})
  }
})

export const CHECKED_TOOLS = new Set([
  'sf-buffer', 'sf-intersection', 'sf-difference', 'sf-erase', 'sf-clip', 'sf-union-dissolve', 'sf-union-merge', 'sf-spatial-filter', 'sf-spatial-join',
  'sf-add-area', 'sf-add-length', 'sf-transform', 'assign-crs', 'geos-buffer', 'geos-area', 'geos-distance', 'geos-intersection', 'geos-difference', 'geos-union',
  'left-join', 'right-join', 'inner-join', 'full-join', 'anti-join', 'semi-join', 'group-summarize',
])

export function toolPreflightRequest(tool: ToolDef, values: Values, selected: Record<string, boolean> = {}): PreflightRequest {
  const envs = useEnvironmentStore.getState().environments.filter(e => !e.isSearchPath)
  const inputs: PreflightInput[] = tool.fields.filter(f => f.type === 'dataset').map(f => {
    const name = values[f.id] ?? ''
    const env = envs.find(e => e.objects.some(o => o.name === name))
    const envName = env?.name ?? '.GlobalEnv'
    const rows = selected[f.id] === false ? [] : useSelectionStore.getState().getSelection(name, envName)
    const exclusions = (values[`exclude_${f.id}`] ?? '').split(',').map(v => v.trim()).filter(Boolean).map(v => Number(v) - 1)
    return { name, envName, ...(rows.length ? { rows } : {}),
      selectionVersion: useSelectionStore.getState().revision,
      ...(exclusions.length ? { excludedRows: exclusions, exclusionReason: values.exclusionReason ?? '' } : {}) }
  })
  let crs = values.workingCRS || values.calccrs || useSpatialSettingsStore.getState().calcCrs || 'native'
  if (crs === 'custom') crs = values.calccrs_custom ?? ''
  // Legacy automatic UTM selection is never used by the controlled path.
  // The form states native projected/S2 semantics and never guesses a zone.
  if (crs === 'auto') crs = 'native'
  const unit = ({ meters: 'm', kilometers: 'km', feet: 'ft', miles: 'mi' } as Record<string, string>)[values.units ?? ''] ?? values.units ?? 'm'
  return { operationType: tool.id, inputs, outputEnv: useSessionStore.getState().workingEnv,
    parameters: { ...values, workingCRS: crs, units: unit || 'm', method: values.method || 's2' } }
}

export function requestPreview(request: PreflightRequest): string {
  // Transport JSON is not useful R to review. Keep strings as strings (a
  // dataset name/expression must never become executable code in this list).
  const literal = (value: unknown, depth = 1): string => {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'string') return rStr(value).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'number') return String(value)
    const entries = Array.isArray(value)
      ? value.map(v => literal(v, depth + 1))
      : Object.entries(value as Record<string, unknown>).map(([key, v]) => `${rStr(key)} = ${literal(v, depth + 1)}`)
    return entries.length ? `list(\n${'  '.repeat(depth + 1)}${entries.join(`,\n${'  '.repeat(depth + 1)}`)}\n${'  '.repeat(depth)})` : 'list()'
  }
  return `# Read-only data checks for ${request.operationType}.\n# Check data to preview the resolved operation, CRS and method.\ndq_validate(\n  ${literal(request)}\n)`
}

export async function inspectRequest(request: PreflightRequest, onProgress?: (report: PreflightReport) => void, signal?: AbortSignal): Promise<PreflightReport> {
  // Send the latest selection before opening a job; old selection notifications
  // may arrive out of order and are ignored by the backend's monotonic version.
  await selectionSync
  for (const input of request.inputs) if (input.selectionVersion !== undefined) {
    const name = input.accessPath ?? input.name
    trackedSelections.set(`${name}::${input.envName}`, { name, envName: input.envName ?? '.GlobalEnv' })
    await rClient.preflightSelection(name, input.envName ?? '.GlobalEnv', useSelectionStore.getState().getSelection(name, input.envName ?? '.GlobalEnv'), input.selectionVersion)
  }
  let report = await rClient.preflightStart(request)
  if (!report.operationId || !report.coverage) throw new Error(report.error ?? 'Could not start preflight')
  const cancel = () => { void window.electronAPI?.preflight?.interrupt?.(report.operationId); void rClient.preflightCancel(report.operationId).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (report.status === 'checking') {
      onProgress?.(report)
      if (signal?.aborted) { await rClient.preflightCancel(report.operationId); return { ...report, status: 'cancelled' } }
      await new Promise(resolve => setTimeout(resolve, 100))
      report = await rClient.preflightStatus(report.operationId)
      if (!report.coverage) throw new Error(report.error ?? 'Validation failed; check again.')
    }
    if (signal?.aborted) return { ...report, status: 'cancelled' }
    onProgress?.(report)
    return report
  } finally { signal?.removeEventListener('abort', cancel) }
}

/** Geometry vectors are native R results, not attribute tables. Keep them in
 *  Environment instead of opening a data.frame endpoint that cannot read them. */
export function checkedOutputViewClass(outputClass?: string): string | null {
  return outputClass && /^(sfc($|_)|geos_geometry$)/.test(outputClass) ? null : outputClass ?? 'data.frame'
}

export async function executeChecked(report: PreflightReport, isCurrent: () => boolean = () => true, onProgress?: (report: PreflightReport) => void, signal?: AbortSignal): Promise<{ success: boolean; outputClass?: string; code?: string; error?: string; path?: string; featureCount?: number; verified?: boolean }> {
  if (!['ready', 'needs_confirmation'].includes(report.status) || !report.validationFingerprint) return { success: false, error: (report.error ?? report.issues.map(i => i.message).join('\n')) || 'Resolve the blocked checks and rerun preflight.' }
  if (report.status === 'needs_confirmation' && !(report.acknowledgments?.length)) {
    if (!await window.electronAPI.preflight.review(report.operationId)) return { success: false, error: 'Choices were not approved; no result was created.' }
  }
  await selectionSync
  if (!isCurrent() || signal?.aborted) return { success: false, error: 'Parameters or selection changed during review; check again.' }
  let res = await rClient.preflightExecute(report.operationId, report.validationFingerprint)
  if (res.pending) {
    const cancel = () => { void window.electronAPI.preflight.interrupt(report.operationId); void rClient.preflightCancel(report.operationId).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      for (;;) {
        if (signal?.aborted || !isCurrent()) await rClient.preflightCancel(report.operationId)
        const progress = await rClient.preflightStatus(report.operationId)
        onProgress?.(progress)
        if (progress.executionResult) { res = progress.executionResult; break }
        if (progress.status !== 'checking') { res = { success: false, error: progress.error ?? `Export ${progress.status}; no staged output was published.` }; break }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } catch (error) { cancel(); throw error }
    finally { signal?.removeEventListener('abort', cancel) }
  }
  if (res.success && res.code) {
    const session = useSessionStore.getState()
    session.addConsoleEntry('input', res.code)
    session.addInputHistory(res.code)
    session.addConsoleEntry('info', 'Preflight passed for this operation and input revision.')
  }
  return res
}

/** Import leaves the native coordinates available for inspection, even when
 *  the source CRS is missing. A requested transform makes a reviewed copy. */
export async function transformImportedLayer(name: string, crs: string): Promise<{ success: boolean; outputName: string; error?: string }> {
  const outputName = `${name}_reprojected`
  const request: PreflightRequest = { operationType: 'sf-transform', inputs: [{ name, envName: '.GlobalEnv' }], outputEnv: '.GlobalEnv', parameters: { crs, out: outputName } }
  const report = await inspectRequest(request)
  const result = await executeChecked(report)
  return { success: result.success, outputName, error: result.error ?? (result.success ? undefined : report.issues.map(i => i.message).join('\n')) }
}
