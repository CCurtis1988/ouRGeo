import { dialog, BrowserWindow, type IpcMain } from 'electron'
import { rBridge } from './r-bridge'
import type { PreflightReport } from '../../src/lib/data-preflight-types'

/** A plugin or AI caller may request a review, but only an actual OS dialog
 *  supplies consent. Fetch the plan from R, never from the invoking renderer. */
export function registerDataPreflightHandlers(ipc: IpcMain): void {
  ipc.handle('preflight:interrupt', (_event, operationId: string) => {
    // Windows SIGINT terminates a child rather than safely interrupting R.
    // Use cooperative backend cancellation there; never kill a user's session.
    if (process.platform !== 'win32' && typeof operationId === 'string' && /^dq-[a-f0-9]{64}$/.test(operationId) && operationId === rBridge.activePreflight) rBridge.interrupt()
  })
  ipc.handle('preflight:review', async (event, operationId: string) => {
    if (!/^dq-[a-f0-9]{64}$/.test(operationId) || !rBridge.port) return false
    const endpoint = `http://127.0.0.1:${rBridge.port}/preflight/`
    const post = async (action: string, body: unknown) => {
      const res = await fetch(endpoint + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Could not retrieve the current validation plan')
      return res.json()
    }
    const report = await post('status', { operationId }) as PreflightReport
    if (report.status !== 'needs_confirmation' || !report.validationFingerprint) return false
    const choices = report.issues.filter(i => i.requiresAcknowledgment)
    if (!choices.length || report.issues.some(i => i.severity === 'blocked')) return false
    const detail = [
      ...report.profiles.map(p => `${p.sourceName}: ${p.totalRows} total source rows; ${p.selectedRows} selected. CRS: ${p.crs?.description ?? 'unknown / attribute table'} (${p.crs?.units ?? 'no spatial units'}).`),
      `Working CRS: ${report.executionPlan?.workingCRSDescription ?? report.executionPlan?.workingCRS ?? 'not applicable'}`,
      `Method: ${report.executionPlan?.method ?? 'attribute operation'}`,
      ...(report.executionPlan?.methodSettings ? [`Buffer distance: ${report.executionPlan.methodSettings.bufferDistance} ${report.executionPlan.methodSettings.bufferDistanceUnit}; S2 cell budget: ${report.executionPlan.methodSettings.maxCells ?? 'not applicable'}; segments per quadrant: ${report.executionPlan.methodSettings.segmentsPerQuadrant ?? 'not applicable'}.`] : []),
      ...choices.map(i => `${i.stableCode}: ${i.message}${i.consequence !== i.message ? `\n${i.consequence}` : ''}`),
      `Approval applies only to this operation, parameters and input revisions.`,
    ].join('\n\n')
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = { type: 'warning' as const, title: 'Review data preflight', message: `Review the choices for ${report.operationType}`, detail,
      buttons: ['Cancel', 'Approve these choices'], defaultId: 0, cancelId: 0, noLink: true }
    const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (answer.response !== 1) return false
    const approved = await post('approve', { operationId, fingerprint: report.validationFingerprint, secret: rBridge.preflightSecret }) as { success: boolean }
    return approved.success === true
  })
}
