import { beforeEach, expect, it, vi } from 'vitest'
import { create } from 'zustand'

const mocks = vi.hoisted(() => ({ revoke: vi.fn(), load: vi.fn(), save: vi.fn() }))
vi.mock('./context', () => ({ useContextStore: { getState: () => ({ revokeDelivery: mocks.revoke, projectLease: 'lease' }) } }))
vi.mock('./project', () => ({ useProjectStore: create<{ workspaceEpoch: number; projectId: string | null; path: string | null }>(() => ({ workspaceEpoch: 1, projectId: null, path: null })) }))
import { useProjectStore } from './project'
import { columnExclusions, hasColumnExclusions, useColumnDisclosureStore } from './column-disclosure'

beforeEach(() => {
  useProjectStore.setState({ workspaceEpoch: 1, projectId: null, path: null })
  vi.stubGlobal('window', { electronAPI: { context: { columnPolicies: mocks.load, saveColumnPolicies: mocks.save } } })
  mocks.load.mockReset(); mocks.save.mockReset()
  useColumnDisclosureStore.setState({ workspaceEpoch: -1, selections: {}, loaded: true, revision: 0, error: '' })
  mocks.revoke.mockClear()
})

it('revokes pending delivery and retained sessions on every local column change', () => {
  useColumnDisclosureStore.getState().setColumns('environment:x:roads', ['income'])
  expect(columnExclusions('environment:x:roads')).toEqual(['income'])
  expect(hasColumnExclusions()).toBe(true)
  expect(mocks.revoke).toHaveBeenCalledOnce()
  useColumnDisclosureStore.getState().setColumns('environment:x:roads', [])
  expect(hasColumnExclusions()).toBe(false)
  expect(mocks.revoke).toHaveBeenCalledTimes(2)
})

it('clears raw column selections when the workspace epoch changes', () => {
  useColumnDisclosureStore.getState().setColumns('environment:x:roads', ['income'])
  useProjectStore.setState({ workspaceEpoch: 2 })
  expect(columnExclusions('environment:x:roads')).toEqual([])
  expect(useColumnDisclosureStore.getState().selections).toEqual({})
  expect(hasColumnExclusions()).toBe(false)
})

it('blocks disclosure while saved policy loads and discards a late old-project response', async () => {
  let resolve!: (value: unknown) => void
  mocks.load.mockReturnValue(new Promise(done => { resolve = done }))
  useProjectStore.setState({ projectId: 'project-one', path: '/project-one', workspaceEpoch: 3 })
  const pending = useColumnDisclosureStore.getState().hydrate('lease')
  expect(hasColumnExclusions()).toBe(true)
  expect(() => columnExclusions('environment:x:roads')).toThrow('unavailable')
  useProjectStore.setState({ projectId: 'project-two', path: '/project-two', workspaceEpoch: 4 })
  resolve({ revision: 1, selections: { 'environment:x:roads': ['income'] } })
  await pending
  expect(useColumnDisclosureStore.getState().selections).toEqual({})
  expect(hasColumnExclusions()).toBe(true)
})

it('restores saved exclusions and keeps disclosure blocked when persistence fails', async () => {
  mocks.load.mockResolvedValue({ revision: 2, selections: { 'environment:x:roads': ['income'] } })
  useProjectStore.setState({ projectId: 'project-one', path: '/project-one', workspaceEpoch: 5 })
  await useColumnDisclosureStore.getState().hydrate('lease')
  expect(columnExclusions('environment:x:roads')).toEqual(['income'])
  mocks.save.mockRejectedValue(new Error('disk full'))
  useColumnDisclosureStore.getState().setColumns('environment:x:roads', [])
  await vi.waitFor(() => expect(useColumnDisclosureStore.getState().error).toContain('disk full'))
  expect(hasColumnExclusions()).toBe(true)
  expect(() => columnExclusions('environment:x:roads')).toThrow('unavailable')
  expect(mocks.save).toHaveBeenCalledWith(2, {}, 'lease')
})
