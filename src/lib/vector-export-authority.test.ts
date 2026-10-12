import { beforeEach, expect, it, vi } from 'vitest'
import { dataActions } from './ai-actions/data'
import { validateArgs } from './ai-actions/types'
import { executeChecked } from './data-preflight'
import { rClient } from './r-client'
import type { PreflightReport } from './data-preflight-types'
import { useSessionStore } from '@/store/session'

vi.mock('./r-client', () => ({ rClient: { preflightStart: vi.fn(), preflightStatus: vi.fn(), preflightExecute: vi.fn(), preflightCancel: vi.fn(), execute: vi.fn() } }))
const review = vi.fn(), picker = vi.fn(), interrupt = vi.fn()
const report = (status: PreflightReport['status']): PreflightReport => ({ schemaVersion: 1, operationId: 'export-job', operationType: 'export-gpkg', status, validationFingerprint: 'exact-profile', coverage: { complete: true, rowsChecked: 2 }, profiles: [], issues: [] })
beforeEach(() => { vi.resetAllMocks();vi.stubGlobal('window', { electronAPI: { preflight: { review, interrupt }, dialog: { saveExportFile: picker } } });useSessionStore.setState({ consoleHistory: [], consoleInputHistory: [] }) })
it('the registered AI vector exporter cannot bypass a block or open a native file picker', async () => {
  const action = dataActions.find(a => a.id === 'data:exportVector')!
  const args = { name: 'points', path: '/tmp/points.gpkg', format: 'gpkg' }
  expect(validateArgs(action, args)).toBeNull()
  vi.mocked(rClient.preflightStart).mockResolvedValue(report('blocked'))
  expect((await action.run(args)).ok).toBe(false)
  expect(rClient.execute).not.toHaveBeenCalled();expect(rClient.preflightExecute).not.toHaveBeenCalled();expect(picker).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled()
})
it('recording happens only after complete staged verification and publication', async () => {
  vi.mocked(rClient.preflightExecute).mockResolvedValue({ success: true, pending: true })
  vi.mocked(rClient.preflightStatus).mockResolvedValueOnce({ ...report('checking'), executionPhase: 'verifying staged output' })
    .mockResolvedValueOnce({ ...report('ready'), executionResult: { success: true, verified: true, path: '/tmp/points.gpkg', featureCount: 2, code: 'dq_export_run(actual_profile)' } })
  const progress = vi.fn()
  const result = await executeChecked(report('ready'), () => true, progress)
  expect(result.verified).toBe(true);expect(progress).toHaveBeenCalledTimes(2);expect(review).not.toHaveBeenCalled()
  expect(useSessionStore.getState().consoleHistory[0].text).toBe('dq_export_run(actual_profile)')
})
it('an export readback failure creates no success recording', async () => {
  vi.mocked(rClient.preflightExecute).mockResolvedValue({ success: true, pending: true })
  vi.mocked(rClient.preflightStatus).mockResolvedValue({ ...report('failed'), error: 'Readback lost Z; previous file retained' })
  expect((await executeChecked(report('ready'))).success).toBe(false)
  expect(useSessionStore.getState().consoleHistory).toHaveLength(0)
})
it('cancelling a queued export revokes backend publication permission', async () => {
  const abort = new AbortController()
  vi.mocked(rClient.preflightExecute).mockImplementation(async () => { abort.abort();return { success: true, pending: true } })
  vi.mocked(rClient.preflightStatus).mockResolvedValue(report('cancelled'))
  expect((await executeChecked(report('ready'), () => true, undefined, abort.signal)).success).toBe(false)
  expect(rClient.preflightCancel).toHaveBeenCalledWith('export-job');expect(useSessionStore.getState().consoleHistory).toHaveLength(0)
})
