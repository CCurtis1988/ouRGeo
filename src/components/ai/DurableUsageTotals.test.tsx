// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ project: { projectId: 'project', workspaceEpoch: 1 }, lease: vi.fn(), summary: vi.fn() }))
vi.mock('@/store/project', () => ({ useProjectStore: { getState: () => mocks.project } }))
import { DurableUsageTotals } from './DurableUsageTotals'
const counters = { turns: 2, receipts: 2, reportedInputTokens: 100, reportedOutputTokens: 30, estimatedInputTokens: 200, reportedCachedInputTokens: null, reportedReasoningTokens: null, incomplete: false, transportRuns: 0 }
beforeEach(() => {
  vi.clearAllMocks(); mocks.project.workspaceEpoch = 1
  mocks.lease.mockResolvedValue({ id: 'lease' }); mocks.summary.mockResolvedValue(counters)
  Object.assign(window, { electronAPI: { context: { lease: mocks.lease, inferenceUsageSummary: mocks.summary } } })
})
it('loads only explicitly and uses host-scoped queries without arbitrary scope identifiers', async () => {
  render(<DurableUsageTotals chatId="chat" projectId="project" />)
  expect(mocks.lease).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load protected usage totals' })))
  expect(mocks.summary.mock.calls).toEqual([['chat', 'lease'], [undefined, 'lease']])
  expect(screen.getByText('Current project · protected local ledger')).toBeTruthy()
})
it('discards a late result after workspace identity changes', async () => {
  let release!: (value: typeof counters) => void
  mocks.summary.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  render(<DurableUsageTotals chatId="chat" projectId="project" />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load protected usage totals' })))
  mocks.project.workspaceEpoch++
  await act(async () => release(counters))
  expect(screen.queryByText('Current conversation · protected local ledger')).toBeNull()
})
it('shows storage failure without inventing zero usage', async () => {
  mocks.summary.mockRejectedValue(new Error('Protected storage unavailable'))
  render(<DurableUsageTotals chatId="chat" projectId="project" />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load protected usage totals' })))
  expect(screen.getByRole('status').textContent).toContain('unavailable')
  expect(screen.queryByText('Current conversation · protected local ledger')).toBeNull()
})
