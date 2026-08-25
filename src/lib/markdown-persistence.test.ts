import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useEditorStore, type TabState } from '@/store/editor'
import { buildSessionData, applySessionData } from '@/lib/session-persistence'

// Markdown tabs are `type: 'code'` with a `language` field precisely so they
// survive the `t.type === 'code'` filters in session-persistence. A new TabType
// would have been silently dropped from session.json — these tests pin that.

const baseTab = (over: Partial<TabState>): TabState => ({
  id: crypto.randomUUID(),
  filePath: null,
  fileName: 'Untitled-1',
  content: '',
  savedContent: '',
  isDirty: false,
  type: 'code',
  ...over,
})

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null, untitledCounter: 1 })
  vi.stubGlobal('window', {
    electronAPI: { file: { read: vi.fn(async () => 'from disk') } },
  })
})

describe('markdown tabs survive session persistence', () => {
  it('includes markdown and R Markdown tabs in the saved session', () => {
    const md = baseTab({ fileName: 'notes.md', language: 'markdown', content: '# Hi' })
    const rmd = baseTab({ fileName: 'a.Rmd', language: 'rmarkdown', content: '```{r}\n1\n```' })
    const r = baseTab({ fileName: 'x.R', language: 'r' })
    useEditorStore.setState({ tabs: [md, rmd, r], activeTabId: rmd.id })

    const data = buildSessionData()
    expect(data.tabs).toHaveLength(3)
    expect(data.tabs.map((t) => t.language)).toEqual(['markdown', 'rmarkdown', 'r'])
    expect(data.activeTabId).toBe(rmd.id)
  })

  it('round-trips the language through save and restore', async () => {
    const rmd = baseTab({ fileName: 'a.Rmd', language: 'rmarkdown', content: 'body' })
    useEditorStore.setState({ tabs: [rmd], activeTabId: rmd.id })

    const saved = JSON.parse(JSON.stringify(buildSessionData()))
    useEditorStore.setState({ tabs: [], activeTabId: null })

    expect(await applySessionData(saved)).toBe(true)
    const restored = useEditorStore.getState().tabs
    expect(restored).toHaveLength(1)
    expect(restored[0].language).toBe('rmarkdown')
  })

  it('restores a pre-markdown session (no language field) as R', async () => {
    const legacy = { ...baseTab({ fileName: 'old.R' }) } as Record<string, unknown>
    delete legacy.language
    expect(await applySessionData({
      tabs: [legacy as unknown as TabState], activeTabId: null, untitledCounter: 1,
    })).toBe(true)
    expect(useEditorStore.getState().tabs[0].language).toBeUndefined()
  })
})

describe('editor store markdown actions', () => {
  it('newMarkdownTab creates a non-dirty tab with starter content', () => {
    const id = useEditorStore.getState().newMarkdownTab('rmarkdown')
    const tab = useEditorStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.language).toBe('rmarkdown')
    expect(tab.type).toBe('code')
    expect(tab.fileName).toMatch(/\.Rmd$/)
    // Scaffolding is not the user's work — a new doc must not open dirty.
    expect(tab.isDirty).toBe(false)
    expect(tab.content).toContain('```{r setup}')
  })

  it('addTab derives the language from the file extension', () => {
    const id = useEditorStore.getState().addTab('/tmp/report.Rmd', 'x')
    expect(useEditorStore.getState().tabs.find((t) => t.id === id)!.language).toBe('rmarkdown')
  })

  it('markTabSaved re-derives the language from the new path', () => {
    const id = useEditorStore.getState().newMarkdownTab('markdown')
    // Saving an untitled markdown doc as .Rmd should retype it.
    useEditorStore.getState().markTabSaved(id, '/tmp/notes.Rmd', 'body')
    const tab = useEditorStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.language).toBe('rmarkdown')
    expect(tab.fileName).toBe('notes.Rmd')
  })

  it('setTabLanguage clears viewMode when going back to R', () => {
    const id = useEditorStore.getState().newMarkdownTab('markdown')
    useEditorStore.getState().setTabViewMode(id, 'visual')
    useEditorStore.getState().setTabLanguage(id, 'r')
    const tab = useEditorStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.language).toBe('r')
    expect(tab.viewMode).toBeUndefined()
  })
})
