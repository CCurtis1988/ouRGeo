// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VectorExportDialog } from './VectorExportDialog'
import { inspectRequest, executeChecked } from '@/lib/data-preflight'
import type { PreflightReport } from '@/lib/data-preflight-types'
vi.mock('@/lib/data-preflight', () => ({ inspectRequest: vi.fn(), executeChecked: vi.fn() }))
const report = (status: PreflightReport['status']): PreflightReport => ({ schemaVersion: 1, operationId: 'export', operationType: 'export-gpkg', status, validationFingerprint: 'fp', coverage: { complete: true, rowsChecked: 2 }, profiles: [], issues: [] })
beforeEach(() => { vi.resetAllMocks() })
afterEach(cleanup)
const open = () => render(<VectorExportDialog name="points" envName=".GlobalEnv" accessPath="points" fields={['key']} onClose={() => {}} />)
it('has preservation-first defaults and does not inspect or write until requested', () => {
  open();expect(screen.getByLabelText('Export format')).toHaveValue('gpkg');expect(screen.getByLabelText('Destination mode')).toHaveValue('new')
  expect(inspectRequest).not.toHaveBeenCalled();expect(executeChecked).not.toHaveBeenCalled();expect(screen.getByText('Check and save')).toBeDisabled()
})
it('a blocked file profile disables saving without manufacturing a warning approval', async () => {
  vi.mocked(inspectRequest).mockResolvedValue(report('blocked'));open()
  fireEvent.change(screen.getByLabelText('Destination file'), { target: { value: '/tmp/points.gpkg' } });fireEvent.click(screen.getByText('Check data'))
  await waitFor(() => expect(screen.getByText('Check and save')).toBeDisabled());expect(await screen.findByText('blocked')).toBeTruthy();expect(executeChecked).not.toHaveBeenCalled()
})
it('only verified publication is presented as saved and changes discard the old permission', async () => {
  vi.mocked(inspectRequest).mockResolvedValue(report('ready'));vi.mocked(executeChecked).mockResolvedValue({ success: true, verified: true, path: '/tmp/points.gpkg', featureCount: 2 })
  open();fireEvent.change(screen.getByLabelText('Destination file'), { target: { value: '/tmp/points.gpkg' } });fireEvent.click(screen.getByText('Check and save'))
  expect(await screen.findByText('Saved and verified 2 features to /tmp/points.gpkg.')).toBeTruthy()
  vi.mocked(inspectRequest).mockImplementation(async (_, progress) => { progress?.(report('checking'));return report('blocked') })
  fireEvent.click(screen.getByText('Check data'))
  expect(await screen.findByText('blocked')).toBeTruthy()
  expect(screen.queryByText('Saved and verified 2 features to /tmp/points.gpkg.')).toBeNull()
  fireEvent.change(screen.getByLabelText('Export layer name'), { target: { value: 'changed' } })
  await waitFor(() => expect(screen.queryByText('Saved and verified 2 features to /tmp/points.gpkg.')).toBeNull())
})
