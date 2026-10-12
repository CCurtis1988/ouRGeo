import { afterEach, expect, it, vi } from 'vitest'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import type { ContextTrace } from './types'
vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
afterEach(() => vi.unstubAllGlobals())
it('drains queued and final receipts to captured authority after the original workspace is closed', async () => {
  const projectId = crypto.randomUUID(), chatId = crypto.randomUUID(), turnId = crypto.randomUUID()
  const trace: ContextTrace = { turnId, identity: { projectId, chatId, workspaceEpoch: 1, policyRevision: 0 }, target: 'openai/fixture', state: 'uncertain', selected: [], excluded: [], invocations: [{ inputTokens: 100, window: 32000, estimated: true, sentRefs: [] }], retrievalCalls: 0, returnedTokens: 0 }
  let release!: () => void
  const blocker = new Promise<void>(resolve => { release = resolve })
  const record = vi.fn().mockImplementationOnce(() => blocker).mockResolvedValue(undefined)
  const lease = vi.fn()
  vi.stubGlobal('window', { electronAPI: { context: { recordInferenceUsage: record, lease } } })
  useProjectStore.setState({ projectId, workspaceEpoch: 1 })
  const write = useContextStore.getState().recordTraceUsage(trace, 'openai', false, 'original-authority')
  await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
  const queued = useContextStore.getState().recordTraceUsage(trace, 'openai', false, 'original-authority')
  useProjectStore.setState({ projectId: crypto.randomUUID(), workspaceEpoch: 2 })
  const final = useContextStore.getState().recordTraceUsage(trace, 'openai', true, 'original-authority')
  release()
  await Promise.all([write, queued, final])
  expect(record).toHaveBeenCalledTimes(3)
  expect(record.mock.calls.every(call => call[1] === 'original-authority')).toBe(true)
  expect(record.mock.calls[2][0][0]).toMatchObject({ final: true, chatId, turnId, delivery: 'uncertain' })
  expect(lease).not.toHaveBeenCalled()
})
it('drains older observations before final reconciliation and propagates a reservation refusal', async () => {
  const trace: ContextTrace = { turnId: crypto.randomUUID(), identity: { projectId: null, chatId: crypto.randomUUID(), workspaceEpoch: 1, policyRevision: 0 }, target: 'openai/fixture', state: 'sent', selected: [], excluded: [], invocations: [{ inputTokens: 100, window: 32000, estimated: true }], retrievalCalls: 0, returnedTokens: 0 }
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve }), order: string[] = []
  const record = vi.fn().mockImplementationOnce(async () => { await blocked; order.push('observed') }).mockImplementation(async () => { order.push('final') })
  const prepare = vi.fn().mockImplementation(async () => { order.push('reserved'); throw new Error('BUDGET_LIMIT') })
  vi.stubGlobal('window', { electronAPI: { context: { recordInferenceUsage: record, prepareInferenceUsage: prepare } } })
  const observed = useContextStore.getState().recordTraceUsage(trace, 'openai', false, 'authority')
  await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1))
  trace.invocations.push({ inputTokens: 200, window: 32000, estimated: true })
  const prepared = useContextStore.getState().prepareTraceUsage(trace, 'openai', 1000, 'authority')
  const refused = expect(prepared).rejects.toThrow('BUDGET_LIMIT')
  expect(prepare).not.toHaveBeenCalled()
  release()
  await Promise.all([observed, refused])
  expect(order).toEqual(['observed', 'final', 'reserved'])
  expect(record.mock.calls[1][0][0]).toMatchObject({ final: true, invocation: 1 })
  expect(prepare.mock.calls[0][0]).toMatchObject({ final: false, invocation: 2, estimatedInputTokens: 200 })
  await useContextStore.getState().recordTraceUsage(trace, 'openai', true, 'authority')
  expect(record).toHaveBeenCalledTimes(3)
})
