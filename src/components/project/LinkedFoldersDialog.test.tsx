// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ProjectFileCatalogue } from '@/lib/project-files'
const { saveAs } = vi.hoisted(() => ({ saveAs: vi.fn() }))
vi.mock('@/lib/project-persistence', () => ({ saveProjectAs: saveAs }))
vi.mock('@/store/layout', () => ({ useLayoutStore: {} }))
import { useProjectFilesStore } from '@/store/project-files'
import { useProjectStore } from '@/store/project'
import { LinkedFoldersDialog } from './LinkedFoldersDialog'

const catalogue: ProjectFileCatalogue = { projectId: 'p1', revision: 1, savedRevision: 1, files: [], linkedFolders: [{ id: 'root', name: 'Working reports', status: 'missing', path: '/reports' }] }
let api: { relinkFolder: ReturnType<typeof vi.fn>; forgetFolder: ReturnType<typeof vi.fn>; createFolder: ReturnType<typeof vi.fn> }
beforeEach(() => {
  useProjectStore.setState({ path: '/project.ourgeoproj', projectId: 'p1', workspaceEpoch: 1, phase: 'ready' })
  useProjectFilesStore.setState({ catalogue, selected: [], preview: null, error: null })
  saveAs.mockReset().mockResolvedValue(false)
  api = { relinkFolder: vi.fn().mockResolvedValue({ ...catalogue, revision: 2, linkedFolders: [{ ...catalogue.linkedFolders![0], status: 'ready' }] }), forgetFolder: vi.fn().mockResolvedValue({ ...catalogue, revision: 2, linkedFolders: [] }), createFolder: vi.fn() }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { context: { lease: vi.fn().mockResolvedValue({ id: 'lease' }) }, projectFiles: api } })
})

it('offers missing-folder recovery without hiding its local location or implying originals are embedded', async () => {
  render(<LinkedFoldersDialog open onOpenChange={vi.fn()} />)
  const folder = screen.getByRole('group', { name: 'Linked folder Working reports' })
  expect(within(folder).getByText('Folder missing')).toBeTruthy()
  expect(within(folder).getByText('/reports')).toBeTruthy()
  expect(within(folder).getByText(/0 files · 0 B external/)).toBeTruthy()
  fireEvent.click(within(folder).getByRole('button', { name: 'Relink folder…' }))
  await waitFor(() => expect(api.relinkFolder).toHaveBeenCalledWith('root', 'lease', undefined))
  await waitFor(() => expect(within(folder).getByText('Ready')).toBeTruthy())
})

it('reviews forgetting a link explicitly and never acts on a cancelled confirmation', async () => {
  render(<LinkedFoldersDialog open onOpenChange={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Forget link…' }))
  const review = screen.getByRole('dialog', { name: 'Forget linked folder Working reports?' })
  expect(within(review).getByText(/Files on disk are kept/)).toBeTruthy()
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
  expect(api.forgetFolder).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Forget link…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Forget linked folder' }))
  await waitFor(() => expect(api.forgetFolder).toHaveBeenCalledWith('root', 'lease'))
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Linked folder Working reports' })).toBeNull())
})

it('keeps a proposed physical folder uncreated if the named-project save is cancelled', async () => {
  useProjectStore.setState({ path: null, projectId: null })
  useProjectFilesStore.setState({ catalogue: { projectId: null, revision: 0, savedRevision: 0, files: [] } })
  render(<LinkedFoldersDialog open onOpenChange={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Create linked folder…' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'New folder name' }), { target: { value: 'Reference material' } })
  fireEvent.click(screen.getByRole('button', { name: 'Choose parent and create folder…' }))
  await waitFor(() => expect(saveAs).toHaveBeenCalledOnce())
  expect(api.createFolder).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'New folder name' })).toHaveValue('Reference material')
})
