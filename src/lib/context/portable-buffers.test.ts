import { beforeEach, expect, it, vi } from 'vitest'
import { applySessionData } from '@/lib/session-persistence'
import { useEditorStore } from '@/store/editor'

const read = vi.fn()
beforeEach(() => {
  read.mockReset()
  vi.stubGlobal('window', { electronAPI: { file: { read } } })
})

it('uses portable editor bytes without reading an unrelated absolute path', async () => {
  const tab = { id: 'portable', fileName: 'analysis.R', type: 'code' as const, filePath: '/unrelated/private.R', content: '# portable snapshot', savedContent: '# older', isDirty: false }
  expect(await applySessionData({ tabs: [tab], activeTabId: tab.id, untitledCounter: 1 }, { portable: true })).toBe(true)
  expect(read).not.toHaveBeenCalled()
  expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: '# portable snapshot', filePath: null, isDirty: true })
})

it('refreshes a previously authorised local link, but refuses a substituted path', async () => {
  read.mockResolvedValue('# current local text')
  const tab = { id: 'local', fileName: 'analysis.R', type: 'code' as const, filePath: '/authorised/analysis.R', content: '# snapshot', savedContent: '# snapshot', isDirty: false }
  const data = { tabs: [tab], activeTabId: tab.id, untitledCounter: 1 }
  const options = { portable: true, authorisedFileLinks: [{ id: tab.id, filePath: tab.filePath }] }
  await applySessionData(data, options)
  expect(read).toHaveBeenCalledWith('/authorised/analysis.R')
  expect(useEditorStore.getState().tabs[0].content).toBe('# current local text')
  read.mockClear()
  await applySessionData({ ...data, tabs: [{ ...tab, filePath: '/unrelated/private.R' }] }, options)
  expect(read).not.toHaveBeenCalled()
  expect(useEditorStore.getState().tabs[0].filePath).toBeNull()
})
