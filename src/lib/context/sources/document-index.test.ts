import { expect, it, vi } from 'vitest'
import type { TabState } from '@/store/editor'
import { materialiseDescriptor } from '../descriptor-index'
import { DocumentDescriptorIndex } from './document-index'
const tab = (extra: Partial<TabState> = {}): TabState => ({ id: 'doc', fileName: 'notes.md', filePath: null, content: '# Method\nCurrent evidence.\n', savedContent: '', isDirty: false, type: 'code', language: 'markdown', ...extra })
it('keeps selected document readers stable and invalidates changed or closed buffers', () => {
  let tabs = [tab()], epoch = 1
  const snapshot = vi.fn(() => null)
  const index = new DocumentDescriptorIndex({ tabs: () => tabs, epoch: () => epoch, snapshot })
  const selected = materialiseDescriptor([...index.scan()][0])
  expect(selected.read()).toContain('Current evidence.')
  expect(selected.readRange!({ startLine: 2, endLine: 2 })).toContain('Current evidence.')
  expect(snapshot).not.toHaveBeenCalled()
  tabs = [tab({ content: '# Method\nChanged evidence.' })]
  expect(() => selected.read()).toThrow('STALE_REFERENCE')
  const changed = materialiseDescriptor([...index.scan()][0])
  expect(changed.revision).not.toBe(selected.revision)
  expect(changed.read()).toContain('Changed evidence.')
  tabs = []
  expect(() => changed.read()).toThrow('closed')
  expect([...index.scan()]).toEqual([])
  tabs = [tab()]; epoch++
  expect(() => selected.read()).toThrow('SCOPE_CHANGED')
})
it('checks visual snapshots without reusing a stale editor array and refuses an unavailable snapshot', () => {
  const tabs = [tab({ viewMode: 'visual' })]
  let text: string | null = '# Visual\nOriginal evidence.'
  const index = new DocumentDescriptorIndex({ tabs: () => tabs, epoch: () => 1, snapshot: () => text })
  const selected = materialiseDescriptor([...index.scan()][0])
  expect(selected.read()).toContain('Original evidence.')
  text = '# Visual\nLatest evidence.'
  expect(materialiseDescriptor([...index.scan()][0]).read()).toContain('Latest evidence.')
  expect(() => selected.read()).toThrow('STALE_REFERENCE')
  text = null
  expect(() => selected.read()).toThrow('SOURCE_BUSY')
})
it('revokes paused discovery on a workspace switch and excludes data-viewer tabs', () => {
  let epoch = 1
  const index = new DocumentDescriptorIndex({ tabs: () => [tab(), tab({ id: 'next' }), tab({ id: 'table', type: 'data-viewer' })], epoch: () => epoch, snapshot: () => null })
  const scan = index.scan()[Symbol.iterator]()
  expect(scan.next().value?.id).toBe('document:doc')
  epoch++
  expect(() => scan.next()).toThrow('SCOPE_CHANGED')
  expect(Array.from(index.scan(), source => source.id)).toEqual(['document:doc', 'document:next'])
})
it('revokes previously selected readers and a paused scan when column privacy is enabled', () => {
  const tabs = [tab(), tab({ id: 'next' })]
  let available = true
  const index = new DocumentDescriptorIndex({ tabs: () => tabs, epoch: () => 1, snapshot: () => null, available: () => available })
  const scan = index.scan()[Symbol.iterator](), selected = materialiseDescriptor(scan.next().value!)
  available = false
  expect(() => selected.read()).toThrow('SOURCE_UNAVAILABLE')
  expect(() => selected.readRange!({ startLine: 1, endLine: 1 })).toThrow('SOURCE_UNAVAILABLE')
  expect(() => scan.next()).toThrow('SOURCE_UNAVAILABLE')
})
