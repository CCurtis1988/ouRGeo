import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { inspectRequest } from '@/lib/data-preflight'
import { rClient } from '@/lib/r-client'
import type { PreflightReport, PreflightRequest } from '@/lib/data-preflight-types'
import { useSelectionStore } from '@/store/selection'

interface Props {
  request: PreflightRequest
  onReport?: (report: PreflightReport | null) => void
  activeReport?: PreflightReport | null
  onCancel?: () => void
}

/** The same read-only report appears beside tools and above attribute tables. */
export function DataChecksPanel({ request, onReport, activeReport, onCancel }: Props) {
  const [localReport, setReport] = useState<PreflightReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const reportCallback = useRef(onReport)
  reportCallback.current = onReport
  const key = JSON.stringify(request)
  const invalidate = useCallback(() => { generation.current++; controller.current?.abort() }, [])
  useEffect(() => {
    invalidate()
    setReport(null); setError(null); setDetails(null)
    reportCallback.current?.(null)
    return invalidate
  }, [key, invalidate])

  async function check() {
    const current = ++generation.current
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    setError(null); setDetails(null)
    try {
      const result = await inspectRequest(request, progress => {
        if (generation.current === current) { setReport(progress); reportCallback.current?.(progress) }
      }, abort.signal)
      if (generation.current === current) { setReport(result); reportCallback.current?.(result) }
    } catch (e) {
      if (generation.current === current) { setError(e instanceof Error ? e.message : String(e)); setReport(null); reportCallback.current?.(null) }
    }
  }
  async function rows(reference: string, select: boolean) {
    if (!report) return
    const captured = generation.current
    try {
      const result = await rClient.preflightRows(report.operationId, reference)
      if (generation.current !== captured) return
      if (!result.success) throw new Error(result.error ?? 'Affected rows are unavailable; check again before selecting features.')
      const affected = new Set(result.rowIdentities)
      const descriptions = result.geometries.flatMap(g => g.filter(row => affected.has(row.identity)).map(row => `${row.identity}: ${row.reason}`))
      setDetails(descriptions.length ? descriptions.join('\n') : result.rowIdentities.join('\n'))
      if (select) {
        for (let i = 0; i < request.inputs.length; i++) {
          const ref = request.inputs[i]
          const indices = result.geometries[i]?.filter(row => affected.has(row.identity)).map(row => row.row) ?? []
          if (indices.length) useSelectionStore.getState().setSelection(ref.accessPath ?? ref.name, ref.envName ?? '.GlobalEnv', indices)
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const report = activeReport === undefined ? localReport : activeReport
  const checking = report?.status === 'checking'
  const ordered = [...(report?.issues ?? [])].sort((a, b) => ({ blocked: 0, warning: 1, info: 2 }[a.severity] - { blocked: 0, warning: 1, info: 2 }[b.severity]))
  return (
    <section className="rounded border border-geo-border bg-geo-panel p-3 text-xs text-foreground" aria-label="Data checks">
      <div className="flex items-center justify-between gap-2">
        <strong>Data checks · {request.operationType === 'inspect' ? 'read-only inspection' : 'operation preflight'}</strong>
        <button type="button" onClick={() => void check()} disabled={checking || !request.inputs.every(i => i.name)} className="rounded border border-geo-border px-2 py-1 hover:bg-geo-bg disabled:opacity-50">{report ? 'Check again' : 'Check data'}</button>
        {checking && <button type="button" className="rounded border border-geo-border px-2 py-1" onClick={() => { controller.current?.abort(); onCancel?.() }}>Cancel check</button>}
      </div>
      <p className="mt-1 text-geo-muted">Inspection preserves source data. Permission applies to this operation, parameters and input revision.</p>
      {error && <p role="alert" className="mt-2"><ShieldAlert className="mr-1 inline h-4 w-4" />Check failed: {error}</p>}
      {report && <div className="mt-2" role="status">{report.status === 'ready' ? <CheckCircle2 className="mr-1 inline h-4 w-4" /> : <AlertTriangle className="mr-1 inline h-4 w-4" />}<strong>{report.status.replace(/_/g, ' ')}</strong> · {report.coverage.rowsChecked} rows checked{report.coverage.totalRows !== undefined ? ` of ${report.coverage.totalRows}` : ''}{!report.coverage.complete && ' · incomplete; execution is not permitted'}</div>}
      <div className="mt-2 max-h-72 overflow-auto space-y-3">
        {report?.profiles.map(profile => <details key={profile.layerId} open={request.operationType === 'inspect'}>
          <summary className="cursor-pointer font-medium">{profile.sourceName} · {profile.totalRows} total / {profile.selectedRows} selected</summary>
          <p className="text-geo-muted">Identity: {profile.identityKind}. A business identifier is a separate field.</p>
          <p>CRS: {profile.crs?.description ?? (profile.crs ? 'unknown' : 'not applicable to attribute table')} {profile.crs?.identifier ?? ''} · coordinate units: {profile.crs?.units ?? 'unknown / not applicable'}</p>
          {profile.geometry && <p>Whole-source geometry: {profile.geometry.valid} valid, {profile.geometry.invalid} invalid, {profile.geometry.empty} empty/missing, {profile.geometry.uncheckable} uncheckable. Types: {profile.geometryTypes.join(', ')}. Dimensions: {profile.dimensions.join(', ')}. Extent (source x/y): {profile.extent?.map(n => n ?? 'unknown').join(', ')}.</p>}
          <table className="mt-1 w-full text-left"><thead><tr><th>Field / type</th><th>Null</th><th>Blank</th><th>Non-finite</th><th>Repeated values</th></tr></thead><tbody>{profile.fields.map(f => <tr key={f.name}><td>{f.name} · {f.type}{f.units ? ` (${f.units})` : ''}</td><td>{f.nullCount}</td><td>{f.blankCount}</td><td>{f.nonFiniteCount}</td><td>{f.duplicateCount ?? 'not checked'}</td></tr>)}</tbody></table>
          <p className="text-geo-muted">Repeated optional values are informational; uniqueness is checked only for the declared join relationship.</p>
        </details>)}
        {report?.executionPlan?.method && <div><p><strong>Method:</strong> {report.executionPlan.method}. Input coordinate units: {report.executionPlan.inputAndOutputUnits?.input.map(u => u ?? 'unknown').join(' / ')}. Parameter units: {report.executionPlan.inputAndOutputUnits?.parameter ?? 'not applicable'}. Result units: {report.executionPlan.inputAndOutputUnits?.output ?? 'not applicable'}. {report.executionPlan.methodSettings?.maxCells != null && `S2 cell budget: ${report.executionPlan.methodSettings.maxCells}. `}{report.executionPlan.methodSettings?.segmentsPerQuadrant != null && `Segments per quadrant: ${report.executionPlan.methodSettings.segmentsPerQuadrant}. `}Working CRS: {report.executionPlan.workingCRSDescription ?? 'see definition'}.</p><details><summary className="cursor-pointer text-geo-muted">Show CRS definition and axis plan</summary><span className="break-all">{report.executionPlan.workingCRS}</span><pre className="whitespace-pre-wrap break-all">{JSON.stringify(report.executionPlan.explicitTransformations, null, 2)}</pre></details></div>}
        {report?.executionPlan?.joinPolicy && <p><strong>Join preview:</strong> Left key: {report.executionPlan.joinPolicy.leftKey} ({String(report.executionPlan.joinPolicy.keyTypes.left)}); right key: {report.executionPlan.joinPolicy.rightKey} ({String(report.executionPlan.joinPolicy.keyTypes.right)}). {report.executionPlan.joinPolicy.relationship} {report.executionPlan.joinPolicy.joinType} join · {report.executionPlan.joinPolicy.predictedRows} predicted output rows. Unmatched source rows: {report.executionPlan.joinPolicy.unmatchedLeft}/{report.executionPlan.joinPolicy.leftRows} left; {report.executionPlan.joinPolicy.unmatchedRight}/{report.executionPlan.joinPolicy.rightRows} right. Null keys: {report.executionPlan.joinPolicy.nullLeft} left; {report.executionPlan.joinPolicy.nullRight} right. Blank keys: {report.executionPlan.joinPolicy.blankLeft} left; {report.executionPlan.joinPolicy.blankRight} right. Duplicate key groups: {report.executionPlan.joinPolicy.duplicateLeft} left; {report.executionPlan.joinPolicy.duplicateRight} right. {report.executionPlan.joinPolicy.keyPolicy}.</p>}
        {report?.executionPlan?.missingValuePolicy && <p><strong>Missing values:</strong> Policy: {report.executionPlan.missingValuePolicy.policy}. {report.executionPlan.missingValuePolicy.missingOrNonFinite} of {report.executionPlan.missingValuePolicy.totalRows} rows are missing or non-finite; {report.executionPlan.missingValuePolicy.usableRows} usable. Units: {report.executionPlan.missingValuePolicy.units ?? 'unitless'}. All-missing result: NA. Per-group total, used and missing counts accompany the result.</p>}
        {report?.executionPlan?.includedAndExcludedRows.some(scope => scope.excludedCount > 0) && <details open>
          <summary className="cursor-pointer font-medium">Included and excluded source scope</summary>
          {report.executionPlan.includedAndExcludedRows.map(scope => <div key={scope.layerId} className="mt-1">
            <p>{scope.layerId}: {scope.selectedCount} selected, {scope.includedCount} included, {scope.excludedCount} excluded. {scope.reason}</p>
            <button type="button" onClick={() => void rows(scope.includedReference, false)} className="underline">Show included identities</button>
            {!!scope.excludedCount && <button type="button" onClick={() => void rows(scope.excludedReference, false)} className="ml-2 underline">Show excluded identities</button>}
          </div>)}
        </details>}
        {ordered.map(issue => <div key={issue.stableCode} className="border-t border-geo-border pt-2" role={issue.severity === 'blocked' ? 'alert' : undefined}>
          <strong>{issue.severity === 'blocked' ? 'Blocked' : issue.severity === 'warning' ? 'Review choice' : 'Finding'}{issue.checkStatus === 'check_failed' || issue.checkStatus === 'not_checked' ? ` · ${issue.checkStatus.replace(/_/g, ' ')}` : ''}</strong>: {issue.message}
          <p className="text-geo-muted">{issue.consequence !== issue.message ? issue.consequence : ''} {issue.suggestedActions.join(' ')}</p>
          {!!issue.affectedCount && <div className="mt-1"><span>{issue.affectedCount} affected source rows; examples: {issue.boundedExamples.join(', ')}</span> <button type="button" onClick={() => void rows(issue.rowIdentityReference, false)} className="underline">Show affected identities and reasons</button>{issue.stableCode.startsWith('GEO-') && <button type="button" onClick={() => void rows(issue.rowIdentityReference, true)} className="ml-2 underline">Select affected features</button>}</div>}
        </div>)}
        {details && <pre className="whitespace-pre-wrap break-all text-geo-muted">{details}</pre>}
      </div>
    </section>
  )
}
