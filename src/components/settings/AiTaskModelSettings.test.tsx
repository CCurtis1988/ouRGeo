// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
const { capability, discover } = vi.hoisted(() => ({ capability: vi.fn(), discover: vi.fn() }))
vi.mock('@/lib/ai-client', () => ({
  PROVIDER_LABELS: { anthropic: 'Anthropic', openai: 'OpenAI', ollama: 'Ollama', 'openai-subscription': 'ChatGPT subscription' },
  PROVIDER_MODELS: { anthropic: ['chat-model'], openai: ['document-model'], ollama: [], 'openai-subscription': [] },
  isLocalProvider: (provider: string) => provider === 'ollama',
  localBaseUrl: () => 'http://localhost:11434', localApiKey: () => '',
  requiresApiKey: (provider: string) => !['ollama', 'openai-subscription'].includes(provider),
  fetchLocalModels: discover, imageCapability: capability,
}))
vi.mock('@/store/ai', async () => {
  const { create } = await import('zustand')
  return { useAiStore: create(() => ({ provider: 'anthropic', modelByProvider: { anthropic: 'chat-model' }, currentModel: () => 'chat-model' })) }
})
vi.mock('@/store/apiKeys', async () => {
  const { create } = await import('zustand')
  return { useApiKeysStore: create(() => ({ keys: { openai: 'shared-secret', anthropic: 'assistant-secret' }, init: async () => undefined })) }
})
vi.mock('@/store/chatgpt', async () => {
  const { create } = await import('zustand')
  return { useChatGptStore: create(() => ({ models: [], status: null, loading: false, error: null, refresh: async () => undefined })) }
})
import { useAiStore } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { useChatGptStore } from '@/store/chatgpt'
import { useAiTaskModelsStore } from '@/store/ai-task-models'
import { AiTaskModelSettings } from './AiTaskModelSettings'

let files: Map<string, string>
beforeEach(() => {
  files = new Map()
  capability.mockReset().mockResolvedValue('supported')
  discover.mockReset().mockResolvedValue({ models: ['vision-model'] })
  useAiTaskModelsStore.setState({ initialized: true, selections: { document: null, image: null }, analyseOnImport: false, error: null, revision: 0 })
  useAiStore.setState({ modelByProvider: { anthropic: 'chat-model' } })
  useChatGptStore.setState({ models: [], status: null, loading: false, error: null })
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { app: { getDataPath: async () => '/data' }, file: {
    read: async (path: string) => { const value = files.get(path); if (!value) throw new Error('ENOENT'); return value },
    write: async (path: string, value: string) => { files.set(path, value) },
  } } })
})

it('offers an existing custom chat model once without reconnecting or changing the chat selection', async () => {
  useAiStore.setState({ modelByProvider: { anthropic: 'custom-chat-model' } })
  const assistant = useAiStore.getState(), credentials = useApiKeysStore.getState().keys
  render(<AiTaskModelSettings />)
  const card = within(screen.getByRole('group', { name: 'Document analysis' }))
  fireEvent.change(card.getByRole('combobox', { name: 'Document analysis model' }), { target: { value: 'separate' } })
  const choices = card.getByRole('combobox', { name: 'Document analysis available models' })
  expect(within(choices).getAllByRole('option', { name: 'custom-chat-model' })).toHaveLength(1)
  fireEvent.change(choices, { target: { value: 'custom-chat-model' } })
  fireEvent.click(card.getByRole('button', { name: 'Apply document model' }))
  await waitFor(() => expect(useAiTaskModelsStore.getState().selections.document).toEqual({ provider: 'anthropic', model: 'custom-chat-model' }))
  expect(useAiStore.getState()).toBe(assistant)
  expect(useApiKeysStore.getState().keys).toBe(credentials)
  expect(card.queryByRole('button', { name: /sign in|add account|connect/i })).toBeNull()
})

it('uses the existing ChatGPT account status and eligible catalogue without adding a second sign-in flow', async () => {
  const status = { activeId: null, signingIn: false, signedIn: false, planEnabled: false, accounts: [], persistent: true, error: null }
  useChatGptStore.setState({ status })
  render(<AiTaskModelSettings />)
  const card = within(screen.getByRole('group', { name: 'Document analysis' }))
  fireEvent.change(card.getByRole('combobox', { name: 'Document analysis model' }), { target: { value: 'separate' } })
  fireEvent.change(card.getByRole('combobox', { name: 'Document analysis provider' }), { target: { value: 'openai-subscription' } })
  await waitFor(() => expect(card.getByText(/Sign in with ChatGPT under Provider & model/)).toBeTruthy())
  expect(card.queryByRole('button', { name: /sign in|add account/i })).toBeNull()
  useChatGptStore.setState({ status: { ...status, signedIn: true, planEnabled: true }, models: [{ id: 'existing-plan-model', label: 'Eligible plan model' }] })
  await waitFor(() => expect(within(card.getByRole('combobox', { name: 'Document analysis available models' })).getByRole('option', { name: 'Eligible plan model' })).toBeTruthy())
})

it('saves a document route independently and returns to the assistant only on explicit apply', async () => {
  const assistant = useAiStore.getState()
  const credentials = useApiKeysStore.getState().keys
  render(<AiTaskModelSettings />)
  const card = within(screen.getByRole('group', { name: 'Document analysis' }))
  fireEvent.change(card.getByRole('combobox', { name: 'Document analysis model' }), { target: { value: 'separate' } })
  fireEvent.change(card.getByRole('combobox', { name: 'Document analysis provider' }), { target: { value: 'openai' } })
  fireEvent.change(card.getByRole('combobox', { name: 'Document analysis model ID' }), { target: { value: 'custom-document' } })
  expect(useAiTaskModelsStore.getState().selections.document).toBeNull()
  fireEvent.click(card.getByRole('button', { name: 'Apply document model' }))
  await waitFor(() => expect(useAiTaskModelsStore.getState().selections.document).toEqual({ provider: 'openai', model: 'custom-document' }))
  expect(useAiStore.getState()).toBe(assistant)
  expect(useApiKeysStore.getState().keys).toBe(credentials)
  expect(JSON.stringify([...files.values()])).not.toContain('shared-secret')
  fireEvent.change(card.getByRole('combobox', { name: 'Document analysis model' }), { target: { value: 'assistant' } })
  expect(useAiTaskModelsStore.getState().selections.document).not.toBeNull()
  fireEvent.click(card.getByRole('button', { name: 'Apply document model' }))
  await waitFor(() => expect(useAiTaskModelsStore.getState().selections.document).toBeNull())
})

it('discovers local models and refuses unsupported image routes without changing the saved choice', async () => {
  render(<AiTaskModelSettings />)
  const card = within(screen.getByRole('group', { name: 'Image interpretation' }))
  expect(card.getByText(/current assistant route cannot receive/)).toBeTruthy()
  fireEvent.change(card.getByRole('combobox', { name: 'Image interpretation model' }), { target: { value: 'separate' } })
  expect(card.getByRole('combobox', { name: 'Image interpretation provider' }).textContent).toBe('Ollama')
  fireEvent.click(card.getByRole('button', { name: 'Refresh available models' }))
  await waitFor(() => expect(discover).toHaveBeenCalledWith('ollama', 'http://localhost:11434', ''))
  await waitFor(() => expect(card.getByRole('button', { name: 'Apply image model' })).not.toBeDisabled())
  fireEvent.change(card.getByRole('combobox', { name: 'Image interpretation model ID' }), { target: { value: 'vision-model' } })
  capability.mockResolvedValueOnce('unsupported')
  fireEvent.click(card.getByRole('button', { name: 'Apply image model' }))
  await waitFor(() => expect(card.getByRole('alert')).toHaveTextContent('does not advertise vision'))
  expect(useAiTaskModelsStore.getState().selections.image).toBeNull()
  fireEvent.click(card.getByRole('button', { name: 'Apply image model' }))
  await waitFor(() => expect(useAiTaskModelsStore.getState().selections.image).toEqual({ provider: 'ollama', model: 'vision-model' }))
})

it('keeps import analysis opt-in and makes persisted route failures visible with explicit recovery', async () => {
  useAiTaskModelsStore.setState({ initialized: false, error: 'Saved provider is invalid.' })
  files.set('/data/ai-task-models.json', JSON.stringify({ version: 1, selections: { document: { provider: 'missing', model: 'private' }, image: null } }))
  render(<AiTaskModelSettings />)
  expect(screen.getByRole('checkbox', { name: 'Generate AI descriptions on import and rescan' })).toBeDisabled()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid/))
  expect(screen.queryByRole('group', { name: 'Document analysis' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reset file analysis models to assistant defaults' }))
  await waitFor(() => expect(screen.getByRole('group', { name: 'Document analysis' })).toBeTruthy())
  const checkbox = screen.getByRole('checkbox', { name: 'Generate AI descriptions on import and rescan' })
  expect(checkbox).not.toBeChecked()
  fireEvent.click(checkbox)
  await waitFor(() => expect(useAiTaskModelsStore.getState().analyseOnImport).toBe(true))
  expect(useAiTaskModelsStore.getState().selections).toEqual({ document: null, image: null })
})
