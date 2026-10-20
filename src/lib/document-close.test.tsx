import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore, type TabState } from '@/store/editor'

const asked = vi.hoisted(() => ({ answers: [] as { choice: string; checked: boolean }[], titles: [] as string[] }))
vi.mock('@/store/ask', () => ({ ask: vi.fn(async (req: { title: string }) => { asked.titles.push(req.title); return asked.answers.shift() ?? { choice: 'cancel', checked: false } }) }))
import { closeTabs, hasUnsavedEdits } from './document-close'

const write = vi.fn(async () => undefined)
const saveFile = vi.fn(async () => '/picked.R' as string | null)
const tab = (id: string, patch: Partial<TabState> = {}): TabState => ({ id, filePath: `/f/${id}.R`, fileName: `${id}.R`, content: 'edited', savedContent: 'disk', isDirty: true, type: 'code', ...patch })

beforeEach(() => {
  asked.answers = []; asked.titles = []
  write.mockClear(); saveFile.mockClear()
  vi.stubGlobal('window', { electronAPI: { file: { write }, dialog: { saveFile } } })
})
const load = (tabs: TabState[]): void => useEditorStore.getState().loadFromSession({ tabs, activeTabId: tabs[0].id, untitledCounter: 1 })
const open = (): string[] => useEditorStore.getState().tabs.map(t => t.id)

describe('unsaved edits', () => {
  it('counts dirty files and untitled text of the user\'s own, not starter scaffolds or object tabs', () => {
    expect(hasUnsavedEdits(tab('a'))).toBe(true)
    expect(hasUnsavedEdits(tab('a', { isDirty: false }))).toBe(false)
    expect(hasUnsavedEdits(tab('u', { filePath: null, content: 'x', savedContent: '' }))).toBe(true)
    expect(hasUnsavedEdits(tab('u', { filePath: null, content: '---\ntitle: x\n---', savedContent: '---\ntitle: x\n---' }))).toBe(false)
    expect(hasUnsavedEdits(tab('o', { type: 'data-viewer' }))).toBe(false)
  })
})

describe('closing documents (§1.4)', () => {
  it('Save writes the file then closes; Discard closes; Cancel stops', async () => {
    load([tab('a'), tab('b'), tab('c'), tab('clean', { isDirty: false })])
    asked.answers = [{ choice: 'save', checked: false }, { choice: 'discard', checked: false }, { choice: 'cancel', checked: false }]
    expect(await closeTabs(['a', 'b', 'c', 'clean'])).toBe('cancelled')
    expect(write).toHaveBeenCalledWith('/f/a.R', 'edited')
    expect(open()).toEqual(['c', 'clean'])
  })

  it('"Apply to all remaining" answers the rest with one dialog (N5)', async () => {
    load([tab('a'), tab('b'), tab('c')])
    asked.answers = [{ choice: 'discard', checked: true }]
    expect(await closeTabs(['a', 'b', 'c'])).toBe('closed')
    expect(asked.titles).toHaveLength(1)
    expect(write).not.toHaveBeenCalled()
  })

  it('an untitled document whose file picker is cancelled stays open (N4)', async () => {
    load([tab('u', { filePath: null, fileName: 'Untitled-1', content: 'notes', savedContent: '' }), tab('x', { isDirty: false })])
    saveFile.mockResolvedValueOnce(null)
    asked.answers = [{ choice: 'save', checked: false }]
    expect(await closeTabs(['u'])).toBe('cancelled')
    expect(open()).toContain('u')
    expect(asked.titles[0]).toMatch(/Save Untitled-1 to a file/)
  })

  it('a document with nothing unsaved closes without asking', async () => {
    load([tab('a', { isDirty: false }), tab('b', { isDirty: false })])
    expect(await closeTabs(['a'])).toBe('closed')
    expect(asked.titles).toEqual([])
  })
})
