// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProjectFileEntry } from '@/lib/project-files'

const mocks = vi.hoisted(() => ({ exclude: vi.fn(), excluded: [] as string[], width: 500 }))
vi.mock('@/store/project-files', async () => ({ ...await vi.importActual('@/store/project-files'), initProjectFiles: vi.fn() }))
vi.mock('@/store/layout', () => ({ useLayoutStore: {} }))
vi.mock('@/store/context', () => ({ useContextStore: Object.assign((selector: (state: { excluded: string[]; exclusionsLoaded: boolean }) => unknown) => selector({ excluded: mocks.excluded, exclusionsLoaded: true }), { getState: () => ({ exclude: mocks.exclude }) }) }))
vi.mock('@/hooks/useZoneTabs', () => ({ usePanelDrawsTabs: () => false }))
vi.mock('@/components/layout/ZoneTabs', () => ({ ZoneTabs: () => null }))
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getTotalSize: () => count * 49, getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 49, size: 49 })), scrollToIndex: vi.fn() }) }))
import { useProjectFilesStore } from '@/store/project-files'
import { useProjectStore } from '@/store/project'
import { ProjectFilesPanel } from './ProjectFilesPanel'

const files: ProjectFileEntry[] = ['report.md', 'figure.png'].map((name, index) => ({ id: `f${index}`, name, originalName: name, folder: '', role: 'reference', userDescription: '', generatedDescription: 'Project reference', sha256: '', bytes: 123, mediaType: 'text/plain', revision: 'r1', importedAt: '2026-01-01', updatedAt: '2026-01-01', status: 'searchable', coverage: 'Complete', saved: true }))
beforeEach(() => {
  mocks.width = 500; mocks.excluded = []; mocks.exclude.mockReset().mockResolvedValue(undefined)
  useProjectStore.setState({ path: '/project.ourgeoproj', projectId: 'p1', workspaceEpoch: 1, phase: 'ready' })
  useProjectFilesStore.setState({ catalogue: { projectId: 'p1', revision: 1, savedRevision: 1, files }, selected: [], detailsOpen: false, preview: null, loading: false, error: null, notice: null })
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: (entries: unknown[]) => void) {} observe(): void { this.callback([{ contentRect: { width: mocks.width } }]) } disconnect(): void {} })
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { context: { lease: vi.fn().mockResolvedValue({ id: 'lease' }) }, projectFiles: { preview: vi.fn().mockResolvedValue({ id: 'f0', revision: 'r1', kind: 'text', text: 'Read-only preview', coverage: 'Complete', complete: true }), pathForFile: vi.fn() } } })
})

it('keeps narrow keyboard multi-selection usable before opening details and provides Back navigation', async () => {
  render(<ProjectFilesPanel />)
  const list = screen.getByRole('listbox', { name: 'Project files' })
  fireEvent.keyDown(list, { key: 'ArrowDown' })
  fireEvent.keyDown(list, { key: 'ArrowDown', shiftKey: true })
  expect(useProjectFilesStore.getState().selected).toHaveLength(2)
  expect(screen.queryByRole('region', { name: /Details for/ })).toBeNull()
  fireEvent.keyDown(list, { key: 'Home' })
  fireEvent.keyDown(list, { key: 'Enter' })
  expect(screen.getByRole('region', { name: /Details for/ })).toBeTruthy()
  await waitFor(() => expect(screen.getByText('Read-only preview')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Back to project files' }))
  expect(screen.getByRole('listbox', { name: 'Project files' })).toBeTruthy()
})

it('uses the existing project exclusion policy and keeps excluded originals previewable', async () => {
  mocks.excluded = ['project-file:p1:f0']
  useProjectFilesStore.getState().select(['f0'])
  render(<ProjectFilesPanel />)
  expect(screen.getByRole('button', { name: 'Attach to chat' }).hasAttribute('disabled')).toBe(true)
  await waitFor(() => expect(screen.getByText('Read-only preview')).toBeTruthy())
  fireEvent.click(screen.getByRole('checkbox', { name: 'Available to the assistant' }))
  await waitFor(() => expect(mocks.exclude).toHaveBeenCalledWith('project-file:p1:f0', 'project', 'p1'))
})

it('requires a clear confirmation for keyboard removal and lets Escape cancel', () => {
  render(<ProjectFilesPanel />)
  const list = screen.getByRole('listbox', { name: 'Project files' })
  fireEvent.keyDown(list, { key: 'ArrowDown' })
  fireEvent.keyDown(list, { key: 'Delete' })
  expect(screen.getByRole('dialog', { name: 'Remove 1 file from this project?' })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(useProjectFilesStore.getState().catalogue.files).toHaveLength(2)
})

it('keeps a missing linked original visible with recovery while withholding assistant attachment', async () => {
  useProjectFilesStore.setState({ catalogue: { projectId: 'p1', revision: 1, savedRevision: 1, files: [{ ...files[0], sha256: 'hash', storage: { kind: 'linked', folderId: 'root', relativePath: 'Guidance/report.md', fingerprint: 'v1' } }, files[1]], linkedFolders: [{ id: 'root', name: 'Working reports', status: 'missing', path: '/work/reports' }] } })
  useProjectFilesStore.getState().select(['f0'])
  render(<ProjectFilesPanel />)
  expect(screen.getByRole('button', { name: 'Attach to chat' }).hasAttribute('disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Replace file…' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Relink folder…' })).toBeTruthy()
  expect(screen.getByText('Guidance/report.md')).toBeTruthy()
  expect(screen.getByText(/Linked: 1 files · 123 B external/)).toBeTruthy()
  await waitFor(() => expect(screen.getByText('Read-only preview')).toBeTruthy())
})
