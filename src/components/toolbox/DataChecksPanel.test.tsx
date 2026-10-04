// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataChecksPanel } from './DataChecksPanel'
import type { PreflightReport, PreflightRequest } from '@/lib/data-preflight-types'
import { inspectRequest } from '@/lib/data-preflight'
vi.mock('@/lib/data-preflight', () => ({ inspectRequest: vi.fn() }))
vi.mock('@/lib/r-client', () => ({ rClient: { preflightRows: vi.fn() } }))
const request: PreflightRequest = { operationType: 'sf-buffer', inputs: [{ name: 'roads' }], parameters: { dist: '100' } }
const report = (status: PreflightReport['status']): PreflightReport => ({ schemaVersion: 1, operationId: 'job', operationType: 'sf-buffer', status, coverage: { complete: status !== 'checking', rowsChecked: 10 }, profiles: [], issues: [] })
afterEach(() => { cleanup(); vi.resetAllMocks() })
describe('contextual data checks', () => {
  it('does no inspection until requested and explains the operation-bound permission', () => {
    render(<DataChecksPanel request={request} />)
    expect(inspectRequest).not.toHaveBeenCalled()
    expect(screen.getByText(/parameters and input revision/)).toBeTruthy()
  })
  it('labels incomplete coverage without presenting permission to execute', async () => {
    vi.mocked(inspectRequest).mockImplementation(async (_, progress) => { progress?.(report('checking')); return report('checking') })
    render(<DataChecksPanel request={request} />)
    fireEvent.click(screen.getByText('Check data'))
    expect(await screen.findByText(/incomplete; execution is not permitted/)).toBeTruthy()
  })
  it('reports a failed check honestly instead of showing ready', async () => {
    vi.mocked(inspectRequest).mockRejectedValue(new Error('Validity engine unavailable'))
    render(<DataChecksPanel request={request} />)
    fireEvent.click(screen.getByText('Check data'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check failed: Validity engine unavailable')
    expect(screen.queryByText('ready')).toBeNull()
  })
  it('discards an async result when parameters change', async () => {
    let complete!: (result: PreflightReport) => void
    vi.mocked(inspectRequest).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const onReport = vi.fn()
    const view = render(<DataChecksPanel request={request} onReport={onReport} />)
    fireEvent.click(screen.getByText('Check data'))
    view.rerender(<DataChecksPanel request={{ ...request, parameters: { dist: '200' } }} onReport={onReport} />)
    complete(report('ready'))
    await waitFor(() => expect(screen.queryByText('ready')).toBeNull())
    expect(onReport.mock.calls.every(([result]) => result === null)).toBe(true)
  })
  it('cancels through an abort signal while preserving incomplete coverage', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(inspectRequest).mockImplementation(async (_, progress, s) => { signal = s; progress?.(report('checking')); return report('checking') })
    render(<DataChecksPanel request={request} />)
    fireEvent.click(screen.getByText('Check data'))
    fireEvent.click(await screen.findByText('Cancel check'))
    expect(signal?.aborted).toBe(true)
  })
})

it('automatic operation preflight exposes partial progress and a cancellation control', () => {
  const cancel = vi.fn()
  render(<DataChecksPanel request={request} activeReport={report('checking')} onCancel={cancel} />)
  expect(screen.getByText(/incomplete; execution is not permitted/)).toBeTruthy()
  fireEvent.click(screen.getByText('Cancel check'))
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(inspectRequest).not.toHaveBeenCalled()
})
