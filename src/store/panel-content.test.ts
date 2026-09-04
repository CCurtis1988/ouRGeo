import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, tabsForPanel, type TabState } from './editor'

// Removing a panel must never remove what is in it.
//
// That is the promise the whole feature rests on: an added editor holds
// documents, and a user tidying their workspace is arranging it, not throwing
// work away. The paths that could break it are the ones tested here.

const tab = (id: string, panelId?: string): TabState => ({
  id, filePath: null, fileName: id, content: '', savedContent: '',
  isDirty: false, type: 'code', ...(panelId ? { panelId } : {}),
})

function seedTabs(tabs: TabState[], active: string): void {
  useEditorStore.setState({ tabs, untitledCounter: 1 })
  useEditorStore.getState().loadFromSession({ tabs, activeTabId: active, untitledCounter: 1 })
}

describe('moving a document between editors', () => {
  beforeEach(() => seedTabs([tab('a'), tab('b'), tab('c', 'editor#2')], 'a'))

  it('takes it out of one panel and shows it in the other', () => {
    useEditorStore.getState().moveTabToPanel('b', 'editor#2')
    const s = useEditorStore.getState()
    expect(tabsForPanel(s.tabs, 'editor').map((t) => t.id)).toEqual(['a'])
    expect(tabsForPanel(s.tabs, 'editor#2').map((t) => t.id)).toEqual(['c', 'b'])
    expect(s.activeByPanel['editor#2']).toBe('b')
    expect(s.focusedEditor).toBe('editor#2')
  })

  it('leaves the panel it came from showing something', () => {
    // A panel whose `activeByPanel` names a tab that has moved renders blank,
    // which is indistinguishable from an editor that failed to load.
    useEditorStore.getState().setActiveTab('a')
    useEditorStore.getState().moveTabToPanel('a', 'editor#2')
    expect(useEditorStore.getState().activeByPanel['editor']).toBe('b')
  })

  it('drops the marker again when a tab goes back to the original editor', () => {
    // The original is unstamped so session.json keeps the shape older builds
    // wrote — and so a tab that has been to the second editor and back is
    // byte-identical to one that never left.
    useEditorStore.getState().moveTabToPanel('c', 'editor')
    expect(useEditorStore.getState().tabs.find((t) => t.id === 'c')?.panelId).toBeUndefined()
  })
})

describe('removing an editor', () => {
  beforeEach(() => seedTabs([tab('a'), tab('b', 'editor#2'), tab('c', 'editor#2')], 'a'))

  it('hands every document to the editor that remains', () => {
    useEditorStore.getState().adoptTabs('editor#2', 'editor')
    const s = useEditorStore.getState()
    expect(s.tabs).toHaveLength(3)
    expect(tabsForPanel(s.tabs, 'editor').map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(tabsForPanel(s.tabs, 'editor#2')).toHaveLength(0)
  })

  it('leaves the document on screen where it was', () => {
    // Closing a panel is a change to the workspace, not to what is being read.
    useEditorStore.getState().adoptTabs('editor#2', 'editor')
    expect(useEditorStore.getState().activeByPanel['editor']).toBe('a')
    expect(useEditorStore.getState().activeTabId).toBe('a')
  })
})

describe('a tab pointing at an editor that is gone', () => {
  it('comes back to the original rather than disappearing', () => {
    // A session.json or a project bundle written when the workspace had two.
    seedTabs([tab('a'), tab('ghost', 'editor#3')], 'a')
    useEditorStore.getState().reclaimOrphanTabs(['editor'])
    const s = useEditorStore.getState()
    expect(s.tabs).toHaveLength(2)
    expect(tabsForPanel(s.tabs, 'editor').map((t) => t.id)).toEqual(['a', 'ghost'])
  })

  it('leaves a workspace whose panels all exist untouched', () => {
    seedTabs([tab('a'), tab('b', 'editor#2')], 'a')
    const before = useEditorStore.getState().tabs
    useEditorStore.getState().reclaimOrphanTabs(['editor', 'editor#2'])
    expect(useEditorStore.getState().tabs).toBe(before)
  })
})
