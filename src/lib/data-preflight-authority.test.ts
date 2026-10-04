import { beforeEach, expect, it, vi } from 'vitest'
import { executeChecked, inspectRequest } from './data-preflight'
import { runToolboxTool } from './ai-actions/toolbox'
import { toolList } from '@/components/toolbox/tools'
import { rClient } from './r-client'
import type { PreflightReport } from './data-preflight-types'
import { useSessionStore } from '@/store/session'
vi.mock('./r-client', () => ({ rClient: { preflightStart: vi.fn(), preflightStatus: vi.fn(), preflightSelection: vi.fn(async () => {}), preflightExecute: vi.fn(), execute: vi.fn(), preflightCancel: vi.fn() } }))
const report = (status: PreflightReport['status']): PreflightReport => ({ schemaVersion: 1, operationId: 'job', operationType: 'sf-buffer', status, validationFingerprint: 'fp', coverage: { complete: true, rowsChecked: 1 }, profiles: [], issues: [] })
const review = vi.fn()
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('window', { electronAPI: { preflight: { review } } });useSessionStore.setState({ consoleHistory: [], consoleInputHistory: [] }) })
it('the AI toolbox path cannot fall back to arbitrary R when preflight blocks', async () => {
  vi.mocked(rClient.preflightStart).mockResolvedValue(report('blocked'))
  const tool = toolList().find(t => t.id === 'sf-buffer')!
  const result = await runToolboxTool(tool, { ds: 'roads', out: 'buffer', dist: '100' }, false)
  expect(result.ok).toBe(false); expect(rClient.execute).not.toHaveBeenCalled(); expect(rClient.preflightExecute).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled()
})
it('denied choices create no result or recording', async () => {
  review.mockResolvedValue(false)
  expect((await executeChecked(report('needs_confirmation'))).success).toBe(false)
  expect(rClient.preflightExecute).not.toHaveBeenCalled();expect(useSessionStore.getState().consoleHistory).toHaveLength(0)
})
it('changing parameters during the user review prevents commit', async () => {
  let current = true
  review.mockImplementation(async () => { current = false; return true })
  expect((await executeChecked(report('needs_confirmation'), () => current)).success).toBe(false)
  expect(rClient.preflightExecute).not.toHaveBeenCalled()
})
it('a clean operation runs without a warning dialog and records the backend code', async () => {
  vi.mocked(rClient.preflightExecute).mockResolvedValue({ success: true, code: 'result <- actual_checked_choices()' })
  expect((await executeChecked(report('ready'))).success).toBe(true)
  expect(review).not.toHaveBeenCalled()
  expect(useSessionStore.getState().consoleHistory[0].text).toBe('result <- actual_checked_choices()')
})

it('a backend serialisation or handler failure is an actionable check error, not renderer permission', async () => {
  vi.mocked(rClient.preflightStart).mockResolvedValue(report('checking'))
  vi.mocked(rClient.preflightStatus).mockResolvedValue({ success: false, status: 'failed', error: 'Validity engine failed' } as PreflightReport)
  await expect(inspectRequest({ operationType: 'inspect', inputs: [{ name: 'source' }], parameters: {} })).rejects.toThrow('Validity engine failed')
  expect(rClient.preflightExecute).not.toHaveBeenCalled()
})
