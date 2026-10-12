// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { REnvironmentInfo } from '@/lib/r-client'

const mocks = vi.hoisted(() => ({
  environment: { environments: [] as REnvironmentInfo[], setEnvironments: vi.fn() },
  project: { path: '/test.ourgeoproj', projectId: 'project', workspaceEpoch: 2 },
  session: { rGeneration: 1, rStatus: 'ready', isExecuting: false },
  disclosure: { workspaceEpoch: 2, loaded: true, selections: {} as Record<string, string[]>, error: '', setColumns: vi.fn() },
  contextSchema: vi.fn(), listEnvironments: vi.fn(),
}))
vi.mock('@/store/context', () => ({ useContextStore: { getState: () => ({ projectLease: 'lease' }) } }))
vi.mock('@/store/environment', () => ({ useEnvironmentStore: Object.assign((select: (s: typeof mocks.environment) => unknown) => select(mocks.environment), { getState: () => mocks.environment }) }))
vi.mock('@/store/project', () => ({ useProjectStore: Object.assign((select: (s: typeof mocks.project) => unknown) => select(mocks.project), { getState: () => mocks.project }) }))
vi.mock('@/store/session', () => ({ useSessionStore: Object.assign((select: (s: typeof mocks.session) => unknown) => select(mocks.session), { getState: () => mocks.session }) }))
vi.mock('@/store/column-disclosure', () => ({ useColumnDisclosureStore: () => mocks.disclosure }))
vi.mock('@/lib/r-client', () => ({ rClient: { contextSchema: mocks.contextSchema, listEnvironments: mocks.listEnvironments } }))
import { ColumnDisclosureSettings } from './ColumnDisclosureSettings'
import { environmentSourceId } from '@/lib/context/source-identity'

const inventory = (columns?: { name: string; type: string }[], className = 'data.frame'): REnvironmentInfo[] => [{
  name: '.GlobalEnv', isSearchPath: false,
  objects: [{ name: 'memory_acceptance_data', class: className, dim: [3, 2], size: 0, length: 2, preview: '', isEnvironment: false, isList: false, columns }],
}]
const sourceId = environmentSourceId('.GlobalEnv', 'memory_acceptance_data')
const columns = [{ name: 'public_value', type: 'double' }, { name: 'private_marker', type: 'character' }]
function open() {
  const view = render(<ColumnDisclosureSettings />)
  fireEvent.click(screen.getByText('Workspace column privacy'))
  return view
}
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.environment.environments = inventory()
  mocks.project.workspaceEpoch = 2
  mocks.session.rGeneration = 1; mocks.session.rStatus = 'ready'; mocks.session.isExecuting = false
  mocks.disclosure.loaded = true; mocks.disclosure.selections = {}
  mocks.contextSchema.mockResolvedValue({ success: true, columns })
  mocks.listEnvironments.mockResolvedValue({ success: true, environments: inventory(columns) })
})

describe('column privacy discovery', () => {
  it('offers uncached data frames and loads only the selected schema locally', async () => {
    open()
    expect(screen.getByRole('option', { name: '.GlobalEnv::memory_acceptance_data' })).toBeInTheDocument()
    expect(mocks.contextSchema).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Column privacy object' }), { target: { value: sourceId } })
    const denied = await screen.findByRole('checkbox', { name: 'private_marker' })
    expect(mocks.contextSchema).toHaveBeenCalledWith('memory_acceptance_data', '.GlobalEnv')
    fireEvent.click(denied)
    expect(mocks.disclosure.setColumns).toHaveBeenCalledWith(sourceId, ['private_marker'])
  })
  it('offers sf objects whose inventory intentionally omits columns', async () => {
    mocks.environment.environments = inventory(undefined, 'sf')
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: sourceId } })
    expect(await screen.findByRole('checkbox', { name: 'private_marker' })).toBeVisible()
  })
  it('uses cached metadata without another R schema call', () => {
    mocks.environment.environments = inventory(columns)
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: sourceId } })
    expect(screen.getByRole('checkbox', { name: 'private_marker' })).toBeVisible()
    expect(mocks.contextSchema).not.toHaveBeenCalled()
  })
  it('lets users refresh an empty inventory and explains where objects come from', async () => {
    mocks.environment.environments = []
    const view = open()
    expect(screen.getByText(/Create or load one in the R console/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace objects' }))
    await waitFor(() => expect(mocks.environment.setEnvironments).toHaveBeenCalledWith(inventory(columns)))
    mocks.environment.environments = inventory(columns); view.rerender(<ColumnDisclosureSettings />)
    expect(screen.getByRole('option', { name: '.GlobalEnv::memory_acceptance_data' })).toBeInTheDocument()
  })
  it('rejects a late schema result after the workspace changes', async () => {
    let finish!: (value: unknown) => void
    mocks.contextSchema.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: sourceId } })
    mocks.project.workspaceEpoch = 3; mocks.environment.environments = []
    view.rerender(<ColumnDisclosureSettings />)
    await act(async () => { finish({ success: true, columns }) })
    expect(screen.queryByRole('checkbox', { name: 'private_marker' })).toBeNull()
  })
  it('rejects a late inventory refresh after R restarts', async () => {
    let finish!: (value: unknown) => void
    mocks.listEnvironments.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = open()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace objects' }))
    mocks.session.rGeneration = 2
    view.rerender(<ColumnDisclosureSettings />)
    await act(async () => { finish({ success: true, environments: inventory(columns) }) })
    expect(mocks.environment.setEnvironments).not.toHaveBeenCalled()
  })
  it('explains schema failure and prevents metadata changes while protected policy loads', async () => {
    mocks.contextSchema.mockResolvedValue({ success: false, error: 'Object unavailable' })
    const view = open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: sourceId } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Object unavailable')
    mocks.environment.environments = inventory(columns); mocks.disclosure.loaded = false
    view.rerender(<ColumnDisclosureSettings />)
    expect(screen.getByRole('checkbox', { name: 'private_marker' })).toBeDisabled()
  })
})
