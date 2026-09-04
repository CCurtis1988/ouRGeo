import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, tabsForPanel, type TabState } from './editor'
import { useGeometryEditStore, sessionsForPanel, type NamedSession } from './geometryEdit'

// Removing a panel must never remove what is in it.
//
// That is the promise the whole feature rests on: a second editor holds
// documents and a second map holds sessions that own layers and an extent, and
// a user tidying their workspace is arranging it, not throwing work away. The
// paths that could break it are the ones tested here.

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

const session = (id: string, panelId?: string): NamedSession => ({
  id, name: id, autoNamed: true, session: null, layerIds: [],
  viewState: { longitude: 0, latitude: 0, zoom: 2 },
  ...(panelId ? { panelId } : {}),
})

function seedSessions(sessions: NamedSession[], byPanel: Record<string, string | null>): void {
  useGeometryEditStore.setState({
    namedSessions: sessions,
    activeByPanel: byPanel,
    focusedSpatialPanel: 'spatial',
    activeSessionId: byPanel['spatial'] ?? null,
  })
}

describe('map sessions', () => {
  beforeEach(() => seedSessions(
    [session('s1'), session('s2'), session('m1', 'spatial#2')],
    { spatial: 's1', 'spatial#2': 'm1' },
  ))

  it('lists only the sessions of the map asking', () => {
    const all = useGeometryEditStore.getState().namedSessions
    expect(sessionsForPanel(all, 'spatial').map((s) => s.id)).toEqual(['s1', 's2'])
    expect(sessionsForPanel(all, 'spatial#2').map((s) => s.id)).toEqual(['m1'])
  })

  it('replaces a deleted session from the SAME map', () => {
    // Otherwise deleting a session on one map puts another map's session on
    // this one's canvas, complete with the wrong extent.
    useGeometryEditStore.getState().deleteNamedSession('s1')
    expect(useGeometryEditStore.getState().activeByPanel['spatial']).toBe('s2')
    expect(useGeometryEditStore.getState().activeByPanel['spatial#2']).toBe('m1')
  })

  it('leaves the other map showing something when a session moves away', () => {
    useGeometryEditStore.getState().moveSessionToPanel('s1', 'spatial#2')
    const s = useGeometryEditStore.getState()
    expect(s.activeByPanel['spatial']).toBe('s2')
    expect(s.activeByPanel['spatial#2']).toBe('s1')
    expect(s.focusedSpatialPanel).toBe('spatial#2')
    expect(s.activeSessionId).toBe('s1')
  })

  it('hands every session to the map that remains', () => {
    useGeometryEditStore.getState().adoptSessions('spatial#2', 'spatial')
    const s = useGeometryEditStore.getState()
    expect(sessionsForPanel(s.namedSessions, 'spatial').map((x) => x.id)).toEqual(['s1', 's2', 'm1'])
    expect(s.activeByPanel['spatial']).toBe('s1')
    expect(s.activeByPanel['spatial#2']).toBeUndefined()
  })

  it('brings a session home when its map is gone', () => {
    useGeometryEditStore.getState().reclaimOrphanSessions(['spatial'])
    const s = useGeometryEditStore.getState()
    expect(s.namedSessions).toHaveLength(3)
    expect(sessionsForPanel(s.namedSessions, 'spatial')).toHaveLength(3)
    expect(s.activeSessionId).toBe('s1')
  })

  it('creates a session on the map it was asked for, without stealing focus', () => {
    useGeometryEditStore.getState().createNamedSession('Aside', 'spatial#2')
    const s = useGeometryEditStore.getState()
    expect(sessionsForPanel(s.namedSessions, 'spatial#2').map((x) => x.name))
      .toEqual(['m1', 'Aside'])
    // The drawing tools still belong to the map the user is working in.
    expect(s.focusedSpatialPanel).toBe('spatial')
    expect(s.activeSessionId).toBe('s1')
  })
})
