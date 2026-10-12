import { expect, it, vi } from 'vitest'
import { SnapshotDescriptorIndex } from './snapshot-index'
import { materialiseDescriptor } from '../descriptor-index'
import { ContextBroker } from '../broker'
import type { ContextSource } from '../types'
const source = (id: string, revision = '1'): ContextSource => ({ id, revision, kind: 'environment', scope: 'workspace', title: id, summary: 'Current columns: public_field', trust: 'observed', read: () => 'Current schema' })
it('reuses packed metadata only for the same immutable inventory and runtime/privacy keys', () => {
  let inventory = [source('environment:a:roads')], revision = 1
  const sources = vi.fn(() => inventory)
  const index = new SnapshotDescriptorIndex({ sources, keys: () => [inventory, revision], epoch: () => 1 })
  const first = Array.from(index.scan(), materialiseDescriptor)
  expect(Array.from(index.scan(), item => item.id)).toEqual([first[0].id])
  expect(sources).toHaveBeenCalledTimes(1)
  revision++
  Array.from(index.scan(), materialiseDescriptor)
  expect(sources).toHaveBeenCalledTimes(2)
  inventory = [source('environment:a:roads', '2')]
  expect(Array.from(index.scan(), materialiseDescriptor)[0].revision).toBe('2')
  expect(sources).toHaveBeenCalledTimes(3)
})
it('refuses selected and paused sources after a runtime or scratch disclosure key changes', async () => {
  let privacy = {}, epoch = 1
  const inventory = [source('environment:a:roads'), source('environment:a:parcels')]
  const index = new SnapshotDescriptorIndex({ sources: () => inventory, keys: () => [inventory, privacy, epoch], epoch: () => epoch })
  const scan = index.scan()[Symbol.iterator](), selected = materialiseDescriptor(scan.next().value!)
  privacy = { roads: ['private_column'] }
  await expect(selected.read()).rejects.toThrow('STALE_REFERENCE')
  expect(() => scan.next()).toThrow('STALE_REFERENCE')
  epoch++
  await expect(selected.read()).rejects.toThrow('SCOPE_CHANGED')
})
it('revokes a late schema result after switching workspaces or replacing the source', async () => {
  let finish!: (value: string) => void, epoch = 1
  const inventory = [source('environment:a:roads')]
  inventory[0].read = () => new Promise<string>(resolve => { finish = resolve })
  const index = new SnapshotDescriptorIndex({ sources: () => inventory, keys: () => [inventory, epoch], epoch: () => epoch })
  const selected = Array.from(index.scan(), materialiseDescriptor)[0]
  const reading = selected.read()
  epoch++
  const revoked = expect(reading).rejects.toThrow('SCOPE_CHANGED')
  finish('Late schema'); await revoked
})
it('keeps an early selected environment bound to its own reader after the runtime wrapper scans the last object', async () => {
  const inventory = [source('environment:.GlobalEnv:roads'), source('environment:.GlobalEnv:ws_handler')]
  inventory[0].read = vi.fn(() => 'Columns of roads: road_id, surface')
  inventory[1].read = vi.fn(() => { throw new Error('A function has no data-frame schema') })
  const beforeRead = vi.fn(), index = new SnapshotDescriptorIndex({ sources: () => inventory, keys: () => [inventory], epoch: () => 1 })
  const broker = new ContextBroker({ identity: { chatId: 'synthetic', projectId: null, workspaceEpoch: 1, policyRevision: 0 }, target: 'test/no-model', effort: 'balanced', signal: new AbortController().signal, current: () => true, excluded: () => [], sources: () => index.scan(beforeRead) })
  const evidence = await broker.prefetch([inventory[0].id])
  expect(evidence).toHaveLength(1)
  expect(evidence[0]).toContain('Columns of roads')
  expect(inventory[0].read).toHaveBeenCalledOnce()
  expect(inventory[1].read).not.toHaveBeenCalled()
  expect(beforeRead).toHaveBeenCalledOnce()
})
