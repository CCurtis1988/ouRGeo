// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  context: { globals: [], projectContext: { memories: [] }, ready: true, error: null, remember: vi.fn() },
  project: { path: null as string | null, projectId: null, workspaceEpoch: 1 },
  ai: { chats: [], messages: [], activeChatId: null },
}))
vi.mock('@/store/context', () => ({ useContextStore: Object.assign((select: (s: typeof mocks.context) => unknown) => select(mocks.context), { getState: () => mocks.context }) }))
vi.mock('@/store/project', () => ({ useProjectStore: (select: (s: typeof mocks.project) => unknown) => select(mocks.project) }))
vi.mock('@/store/ai', () => ({ useAiStore: (select: (s: typeof mocks.ai) => unknown) => select(mocks.ai), selectMessages: (s: typeof mocks.ai) => s.messages, selectActiveChat: () => null }))
vi.mock('./ForgetTranscriptReview', () => ({ ForgetTranscriptReview: () => null }))
import { MemoryLibrary } from './MemoryLibrary'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.ready = true; mocks.context.error = null
  mocks.project.path = null
  mocks.context.remember.mockResolvedValue({})
})

describe('direct memory entry', () => {
  it('names the library and saves a personal memory through the local store', async () => {
    render(<MemoryLibrary placement="settings" />)
    expect(screen.getByRole('heading', { name: 'Memory Library' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'About you' })).toHaveAttribute('aria-pressed', 'true')
    const save = screen.getByRole('button', { name: 'Remember about you' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'New memory' }), { target: { value: 'Prefer metric units.' } })
    fireEvent.click(save)
    await waitFor(() => expect(mocks.context.remember).toHaveBeenCalledWith('Prefer metric units.', 'global'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Memory added to About you.'))
    expect(screen.getByRole('textbox', { name: 'New memory' })).toHaveValue('')
  })
  it('saves in the selected project scope and explains the required project save', async () => {
    mocks.project.path = '/test.ourgeoproj'
    render(<MemoryLibrary />)
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New memory' }), { target: { value: 'Keep source data unchanged.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remember on project save' }))
    await waitFor(() => expect(mocks.context.remember).toHaveBeenCalledWith('Keep source data unchanged.', 'project'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Save the project to keep it.'))
  })
  it('explains why scratch and conversation views cannot create project memory', () => {
    render(<MemoryLibrary />)
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))
    expect(screen.getByText('Save this workspace as a project to keep project memory.')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'New memory' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }))
    expect(screen.queryByRole('textbox', { name: 'New memory' })).toBeNull()
    expect(mocks.context.remember).not.toHaveBeenCalled()
  })
  it('keeps the draft and reports a local storage failure', async () => {
    mocks.context.remember.mockRejectedValue(new Error('Protected storage unavailable'))
    render(<MemoryLibrary />)
    fireEvent.change(screen.getByRole('textbox', { name: 'New memory' }), { target: { value: 'Keep this draft.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remember about you' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Protected storage unavailable'))
    expect(screen.getByRole('textbox', { name: 'New memory' })).toHaveValue('Keep this draft.')
  })
  it('blocks repeated submission and scope changes while a write is pending', async () => {
    let finish!: () => void
    mocks.context.remember.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    render(<MemoryLibrary />)
    fireEvent.change(screen.getByRole('textbox', { name: 'New memory' }), { target: { value: 'Only once.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remember about you' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Project' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }))
    expect(mocks.context.remember).toHaveBeenCalledOnce()
    finish()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Memory added'))
  })
})
