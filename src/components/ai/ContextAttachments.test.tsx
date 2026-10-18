// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ContextSource } from '@/lib/context/types'

const mocks = vi.hoisted(() => ({ sources: vi.fn(), snapshot: vi.fn(), project: { workspaceEpoch: 7 }, privacy: { exclusionsLoaded: true, excluded: [] as string[] }, editor: { activeTabId: 'tab', tabs: [{ id: 'tab', content: '# Intro\nhello\n# Method\n```{r}\nx <- 1\n```', viewMode: 'code' }] }, spatial: { selectedLayerId: 'layer', layers: [{ id: 'layer', envName: '.GlobalEnv', name: 'roads' }] } }))
const library = vi.hoisted(() => ({ catalogue: { projectId: 'project', files: [] as { id: string; name: string; status: string }[] }, add: vi.fn(), queue: { requests: [] }, show: vi.fn() }))
vi.mock('@/store/project-files', () => ({ useProjectFilesStore: Object.assign((select: (state: typeof library) => unknown) => select(library), { getState: () => library }) }))
vi.mock('@/lib/project-files-ui', () => ({ openProjectFiles: library.show }))
vi.mock('@/lib/project-file-ai', () => ({ useProjectFileAttachmentQueue: Object.assign((select: (state: typeof library.queue) => unknown) => select(library.queue), { setState: vi.fn() }) }))
vi.mock('@/store/spatial', () => ({ useSpatialStore: { getState: () => mocks.spatial } }))
vi.mock('@/store/editor', () => ({ useEditorStore: { getState: () => mocks.editor } }))
vi.mock('@/store/project', () => ({ useProjectStore: { getState: () => mocks.project } }))
vi.mock('@/store/context', () => ({ useContextStore: { getState: () => mocks.privacy } }))
vi.mock('@/lib/context/sources/workspace', () => ({ workspaceSources: mocks.sources }))
vi.mock('@/lib/context/document-snapshots', () => ({ snapshotDocument: mocks.snapshot }))
import { ContextAttachments } from './ContextAttachments'

const read = vi.fn()
const document: ContextSource = { id: 'document:tab', kind: 'document', scope: 'workspace', title: 'Analysis.qmd', summary: '', revision: 'unsaved:8', trust: 'user', read }
beforeEach(() => { vi.clearAllMocks(); library.catalogue.files = []; library.add.mockResolvedValue([]); mocks.privacy.exclusionsLoaded = true; mocks.privacy.excluded = []; mocks.editor.tabs[0].viewMode = 'code'; mocks.editor.tabs[0].content = '# Intro\nhello\n# Method\n```{r}\nx <- 1\n```'; mocks.sources.mockReturnValue([document]) })

describe('context attachment composer', () => {
  it('keeps a large import in the project and asks explicitly which files to attach', async () => {
    library.add.mockImplementation(async () => {
      library.catalogue.files = Array.from({ length: 4 }, (_, index) => ({ id: `file-${index}`, name: `Report ${index}.pdf`, status: 'searchable' }))
      return library.catalogue.files.map(file => file.id)
    })
    const change = vi.fn()
    render(<ContextAttachments value={[]} onChange={change} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add files' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('4 files added to the project. Choose which files to attach'))
    expect(screen.getByLabelText('Project file attachments')).toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
    expect(library.catalogue.files).toHaveLength(4)
  })
  it('lets a large current document recover through an explicit small range instead of a smaller file', () => {
    mocks.editor.tabs[0].content = 'x'.repeat(2_000_000) + '\n# Relevant\ncurrent text'
    const change = vi.fn()
    render(<ContextAttachments value={[]} onChange={change} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Attach context' }))
    expect(screen.getByRole('status').textContent).toContain('selected line ranges')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Attachment start line' }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Attachment end line' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach line range' }))
    expect(change).toHaveBeenCalledWith([expect.objectContaining({ range: { startLine: 2, endLine: 3 }, revision: 'unsaved:8' })])
    expect(read).not.toHaveBeenCalled()
  })
  it('does no discovery until requested and stages the chosen current document range without reading its body', () => {
    const change = vi.fn()
    render(<ContextAttachments value={[]} onChange={change} disabled={false} />)
    expect(mocks.sources).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Attach context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Method (lines 3–6)' }))
    expect(change).toHaveBeenCalledWith([expect.objectContaining({ sourceId: 'document:tab', revision: 'unsaved:8', workspaceEpoch: 7, range: { startLine: 3, endLine: 6 } })])
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('delivered progressively')
  })
  it('does not offer excluded sources or discover before source policy loads', () => {
    mocks.privacy.exclusionsLoaded = false
    render(<ContextAttachments value={[]} onChange={vi.fn()} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Attach context' }))
    expect(mocks.sources).not.toHaveBeenCalled()
    mocks.privacy.exclusionsLoaded = true; mocks.privacy.excluded = ['document:tab']
    fireEvent.click(screen.getByRole('button', { name: 'Attach context' }))
    expect(screen.queryByText('Current document: Analysis.qmd')).toBeNull()
  })
  it('refuses unavailable Visual snapshots instead of attaching the stale saved buffer', () => {
    mocks.editor.tabs[0].viewMode = 'visual'; mocks.snapshot.mockReturnValue(null)
    const change = vi.fn()
    render(<ContextAttachments value={[]} onChange={change} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Attach context' }))
    expect(screen.getByRole('status').textContent).toContain('snapshot current Visual changes')
    expect(screen.queryByRole('button', { name: 'Method (lines 3–6)' })).toBeNull()
    expect(change).not.toHaveBeenCalled()
  })
})
