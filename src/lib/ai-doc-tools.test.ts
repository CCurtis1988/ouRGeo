import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useEditorStore, type TabState } from '@/store/editor'
import { runDocTool, describeDocCall, resolveTab, DOC_TOOL_NAMES } from './ai-doc-tools'

const tab = (over: Partial<TabState>): TabState => ({
  id: over.id ?? crypto.randomUUID(),
  filePath: null,
  fileName: 'Untitled-1',
  content: '',
  savedContent: '',
  isDirty: false,
  type: 'code',
  ...over,
})

const reset = (tabs: TabState[] = [], activeTabId: string | null = null): void => {
  useEditorStore.setState({ tabs, activeTabId, untitledCounter: 1, externalContentUpdate: null })
}

const contentOf = (fileName: string): string =>
  useEditorStore.getState().tabs.find((t) => t.fileName === fileName)?.content ?? ''

beforeEach(() => reset())

describe('write_document', () => {
  it('creates a named tab with the right language and leaves it unsaved', async () => {
    const out = await runDocTool('write_document', {
      name: 'quakes.Rmd', content: '---\ntitle: "q"\n---\n\n```{r setup}\nlibrary(dplyr)\n```\n',
    })

    const tabs = useEditorStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ fileName: 'quakes.Rmd', language: 'rmarkdown', filePath: null, isDirty: true })
    expect(useEditorStore.getState().activeTabId).toBe(tabs[0].id)
    expect(out).toContain('Created "quakes.Rmd" (R Markdown)')
    expect(out).toContain('chunks: setup (1 runnable)')
    expect(out).toMatch(/NOT saved to disk/)
  })

  it('gives an extension-less name one that matches what was written', async () => {
    await runDocTool('write_document', { name: 'report', content: '```{r a}\n1\n```' })
    await runDocTool('write_document', { name: 'notes', content: '# Just prose' })
    expect(useEditorStore.getState().tabs.map((t) => t.fileName)).toEqual(['report.Rmd', 'notes.md'])
  })

  it('appends section by section rather than rewriting', async () => {
    await runDocTool('write_document', { name: 'r.Rmd', content: '---\ntitle: "x"\n---' })
    await runDocTool('write_document', { name: 'r.Rmd', content: '## One', mode: 'append' })
    await runDocTool('write_document', { name: 'r.Rmd', content: '## Two', mode: 'append' })

    expect(contentOf('r.Rmd')).toBe('---\ntitle: "x"\n---\n\n## One\n\n## Two')
    expect(useEditorStore.getState().tabs).toHaveLength(1)
  })

  it('replaces through the external-update channel, so Monaco sees the change', async () => {
    reset([tab({ id: 'a', fileName: 'r.Rmd', language: 'rmarkdown', content: 'old' })], 'a')
    await runDocTool('write_document', { name: 'r.Rmd', content: 'new' })

    expect(contentOf('r.Rmd')).toBe('new')
    expect(useEditorStore.getState().externalContentUpdate).toMatchObject({ tabId: 'a', content: 'new' })
  })

  it('drops a Visual-mode tab to Source first, or the write would be overwritten', async () => {
    reset([tab({ id: 'a', fileName: 'n.md', language: 'markdown', viewMode: 'visual', content: '# Old' })], 'a')
    await runDocTool('write_document', { name: 'n.md', content: '# New' })
    expect(useEditorStore.getState().tabs[0].viewMode).toBe('source')
  })

  it('reports the problems it can see instead of leaving them for knit time', async () => {
    const out = await runDocTool('write_document', { name: 'bad.Rmd', content: '```{r m}\np1\n```\n' })
    expect(out).toMatch(/! chunk "m" is just the object `p1`/)
    expect(out).toMatch(/no YAML front matter/)
  })
})

describe('read_document', () => {
  it('reads the active document when no name is given', async () => {
    reset([
      tab({ id: 'a', fileName: 'one.Rmd', language: 'rmarkdown', content: 'first' }),
      tab({ id: 'b', fileName: 'two.Rmd', language: 'rmarkdown', content: 'second' }),
    ], 'b')
    expect(await runDocTool('read_document', {})).toContain('second')
  })

  it('names the open documents when the requested one is not there', async () => {
    reset([tab({ id: 'a', fileName: 'one.Rmd' })], 'a')
    const out = await runDocTool('read_document', { name: 'missing.Rmd' })
    expect(out).toMatch(/^Error: no open document called "missing.Rmd"/)
    expect(out).toContain('"one.Rmd"')
  })
})

describe('edit_document', () => {
  const doc = '# Title\n\n```{r a}\np1\n```\n\n```{r b}\np2\n```\n'

  it('replaces one exact passage and leaves the rest alone', async () => {
    reset([tab({ id: 'a', fileName: 'r.Rmd', language: 'rmarkdown', content: doc })], 'a')
    const out = await runDocTool('edit_document', {
      find: '```{r a}\np1\n```', replace: '```{r a}\neq <- readRDS("eq.rds")\n```',
    })
    expect(contentOf('r.Rmd')).toBe('# Title\n\n```{r a}\neq <- readRDS("eq.rds")\n```\n\n```{r b}\np2\n```\n')
    expect(out).toContain('Edited "r.Rmd"')
  })

  it('refuses an ambiguous match rather than editing the wrong one', async () => {
    reset([tab({ id: 'a', fileName: 'r.Rmd', language: 'rmarkdown', content: 'x\nsame\ny\nsame\n' })], 'a')
    const out = await runDocTool('edit_document', { find: 'same', replace: 'other' })
    expect(out).toMatch(/appears more than once/)
    expect(contentOf('r.Rmd')).toBe('x\nsame\ny\nsame\n')
  })

  it('tells the model to re-read when the text is not there', async () => {
    reset([tab({ id: 'a', fileName: 'r.Rmd', language: 'rmarkdown', content: doc })], 'a')
    const out = await runDocTool('edit_document', { find: 'nowhere', replace: 'x' })
    expect(out).toMatch(/not in "r.Rmd"/)
    expect(out).toMatch(/read_document/)
  })
})

describe('resolution', () => {
  it('prefers the tab name, then the path basename', () => {
    reset([
      tab({ id: 'a', fileName: 'report.Rmd', filePath: '/tmp/a/report.Rmd' }),
      tab({ id: 'b', fileName: 'other.Rmd', filePath: '/tmp/b/report.Rmd' }),
    ], 'a')
    expect(resolveTab('report.Rmd')).toMatchObject({ tab: { id: 'a' } })
    expect(resolveTab('/tmp/b/report.Rmd')).toMatchObject({ tab: { id: 'b' } })
    expect(resolveTab('REPORT.RMD')).toMatchObject({ tab: { id: 'a' } })
  })

  it('never picks a data-viewer tab', () => {
    reset([tab({ id: 'v', fileName: 'eq_df', type: 'data-viewer' })], 'v')
    expect(resolveTab()).toMatchObject({ error: expect.stringContaining('(none open)') })
  })
})

describe('console logging and dispatch', () => {
  it('describes each call for the console audit trail', () => {
    expect(describeDocCall('write_document', { name: 'r.Rmd' })).toBe('AI wrote r.Rmd')
    expect(describeDocCall('write_document', { name: 'r.Rmd', mode: 'append' })).toBe('AI appended to r.Rmd')
    expect(describeDocCall('edit_document', {})).toBe('AI edited the active document')
  })

  it('exposes exactly the three tool names', () => {
    expect([...DOC_TOOL_NAMES].sort()).toEqual(['edit_document', 'read_document', 'write_document'])
  })

  it('never reaches for Electron — these tools only touch editor tabs', async () => {
    const api = vi.fn()
    vi.stubGlobal('window', { electronAPI: new Proxy({}, { get: api }) })
    await runDocTool('write_document', { name: 'x.md', content: '# hi' })
    await runDocTool('read_document', { name: 'x.md' })
    expect(api).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
