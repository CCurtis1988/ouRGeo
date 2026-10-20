import { describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'

vi.mock('@/lib/persistence', () => ({ createJsonFileStore: () => ({ read: async () => ({}), write: async () => {}, merge: async () => {} }), getDataPath: async () => '/tmp' }))
import { restoreScratchDocuments } from './project-persistence'

describe('restoring scratch documents', () => {
  it('never runs over an open named project', async () => {
    // Cancelling Resolve conflicts at launch leaves the user's version open
    // while the open reports "not opened"; the launch fallback then restored
    // scratch over it, and the draft writer saved the loss.
    const read = vi.fn()
    vi.stubGlobal('window', { electronAPI: { drafts: { read } } })
    useProjectStore.setState({ path: '/p/work.ourgeoproj', name: 'work' })
    const tab = { id: 'keep', filePath: null, fileName: 'notes', content: 'mine', savedContent: '', isDirty: true, type: 'code' as const }
    useEditorStore.getState().loadFromSession({ tabs: [tab], activeTabId: 'keep', untitledCounter: 1 })
    expect(await restoreScratchDocuments({ keepFileBacked: false })).toEqual({ restored: [], lost: [] })
    expect(read).not.toHaveBeenCalled()
    expect(useEditorStore.getState().tabs.map(t => t.id)).toEqual(['keep'])
  })
})
