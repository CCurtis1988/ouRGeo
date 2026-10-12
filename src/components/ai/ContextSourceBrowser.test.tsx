// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ sources: vi.fn(), exclude: vi.fn(), project: { projectId: 'project', path: '/project', workspaceEpoch: 1 }, privacy: { excluded: [] as string[], exclusionsLoaded: true, policyRevision: 1 }, column: { loaded: true }, ai: { activeChatId: 'chat', chats: [] } }))
vi.mock('@/store/project', () => ({ useProjectStore: Object.assign((selector: (state: typeof mocks.project) => unknown) => selector(mocks.project), { getState: () => mocks.project }) }))
vi.mock('@/store/context', () => ({ useContextStore: Object.assign((selector: (state: typeof mocks.privacy) => unknown) => selector(mocks.privacy), { getState: () => ({ ...mocks.privacy, exclude: mocks.exclude }) }) }))
vi.mock('@/store/column-disclosure', () => ({ useColumnDisclosureStore: (selector: (state: typeof mocks.column) => unknown) => selector(mocks.column) }))
vi.mock('@/store/ai', () => ({ useAiStore: Object.assign((selector: (state: typeof mocks.ai) => unknown) => selector(mocks.ai), { getState: () => mocks.ai }) }))
vi.mock('@/lib/context/sources/workspace', () => ({ workspaceSourceScan: mocks.sources }))
import { ContextSourceBrowser } from './ContextSourceBrowser'
const read = vi.fn(() => 'private body')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.project.workspaceEpoch = 1; mocks.privacy.policyRevision = 1; mocks.privacy.exclusionsLoaded = true; mocks.privacy.excluded = []; mocks.column.loaded = true
  mocks.sources.mockReturnValue([{ id: 'document:current', kind: 'document', scope: 'workspace', title: 'Current document', summary: 'document outline', revision: '2', trust: 'user', read }])
})

it('discovers only after an explicit click and never reads a source body', () => {
  render(<ContextSourceBrowser />)
  expect(mocks.sources).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Browse current context sources' }))
  expect(screen.getByText(/Current document/)).toBeTruthy()
  expect(read).not.toHaveBeenCalled()
  expect(screen.getByText(/does not mean selected or sent/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Exclude source' }))
  expect(mocks.exclude).toHaveBeenCalledWith('document:current', 'workspace', 'project')
})

it('blocks browsing when policy loading fails and clears old-workspace cards immediately', () => {
  const view = render(<ContextSourceBrowser />)
  fireEvent.click(screen.getByRole('button', { name: 'Browse current context sources' }))
  mocks.project.workspaceEpoch = 2; mocks.column.loaded = false
  view.rerender(<ContextSourceBrowser />)
  expect(screen.queryByText(/Current document/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Browse current context sources' }).hasAttribute('disabled')).toBe(true)
  expect(mocks.sources).toHaveBeenCalledOnce()
})
