import { rClient } from './r-client'
import type { PreflightInput, PreflightReport, PreflightRequest } from './data-preflight-types'
import type { ToolDef, Values } from '@/components/toolbox/tools'
import { useEnvironmentStore } from '@/store/environment'
import { useSelectionStore } from '@/store/selection'
import { useSessionStore } from '@/store/session'
import { useSpatialSettingsStore } from '@/store/spatialSettings'

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
  const quoted = JSON.stringify(JSON.stringify(request)).replace(/\u2028|\u2029/g, '')
  return `# Read-only preflight; reviewed execution records the actual choices below.\ndq_validate(jsonlite::fromJSON(${quoted}, simplifyVector = FALSE))`
}

export async function inspectRequest(request: PreflightRequest, onProgress?: (report: PreflightReport) => void, signal?: AbortSignal): Promise<PreflightReport> {
  // Send the latest selection before opening a job; old selection notifications
  // may arrive out of order and are ignored by the backend's monotonic version.
  await selectionSync
  for (const input of request.inputs) if (input.selectionVersion !== undefined) {
    trackedSelections.set(`${input.name}::${input.envName}`, { name: input.name, envName: input.envName ?? '.GlobalEnv' })
    await rClient.preflightSelection(input.name, input.envName ?? '.GlobalEnv', useSelectionStore.getState().getSelection(input.name, input.envName ?? '.GlobalEnv'), input.selectionVersion)
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

export async function executeChecked(report: PreflightReport, isCurrent: () => boolean = () => true): Promise<{ success: boolean; code?: string; error?: string }> {
  if (!['ready', 'needs_confirmation'].includes(report.status) || !report.validationFingerprint) return { success: false, error: (report.error ?? report.issues.map(i => i.message).join('\n')) || 'Resolve the blocked checks and rerun preflight.' }
  if (report.status === 'needs_confirmation' && !(report.acknowledgments?.length)) {
    if (!await window.electronAPI.preflight.review(report.operationId)) return { success: false, error: 'Choices were not approved; no result was created.' }
  }
  await selectionSync
  if (!isCurrent()) return { success: false, error: 'Parameters or selection changed during review; check again.' }
  const res = await rClient.preflightExecute(report.operationId, report.validationFingerprint)
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
