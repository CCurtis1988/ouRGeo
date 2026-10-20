import { beforeEach, expect, it, vi } from 'vitest'
const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/ai-client', () => ({ fetchLocalModels: fetch }))
import { useAiModelCatalogueStore } from './ai-model-catalogue'
let sequence = 0
beforeEach(() => { sequence++; fetch.mockReset(); useAiModelCatalogueStore.setState({ discoveries: {} }) })

it('coalesces concurrent chat/settings/task discovery and caches only model metadata', async () => {
  let resolve!: (value: { models: string[] }) => void
  fetch.mockImplementation(() => new Promise(done => { resolve = done }))
  const url = `http://fixture/${sequence}`, refresh = useAiModelCatalogueStore.getState().refresh
  const chat = refresh('ollama', url, 'existing-token'), document = refresh('ollama', url, 'existing-token'), image = refresh('ollama', url, 'existing-token', true)
  expect(chat).toBe(document); expect(image).toBe(chat); expect(fetch).toHaveBeenCalledTimes(1)
  resolve({ models: ['custom', 'custom', 'other'] }); await chat
  expect(useAiModelCatalogueStore.getState().discoveries.ollama?.models.map(model => model.id)).toEqual(['custom', 'other'])
  expect(JSON.stringify(useAiModelCatalogueStore.getState())).not.toContain('existing-token')
  await refresh('ollama', url, 'existing-token')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not publish late models from an obsolete server or credential', async () => {
  let old!: (value: { models: string[] }) => void
  fetch.mockImplementationOnce(() => new Promise(done => { old = done })).mockResolvedValueOnce({ models: ['new-model'] })
  const refresh = useAiModelCatalogueStore.getState().refresh
  const first = refresh('lmstudio', `http://old/${sequence}`, 'old-key')
  await refresh('lmstudio', `http://new/${sequence}`, 'new-key')
  old({ models: ['STALE_MODEL'] }); await first
  expect(useAiModelCatalogueStore.getState().discoveries.lmstudio?.models).toEqual([{ id: 'new-model', label: 'new-model' }])
})

it('surfaces discovery failure without changing a saved route or continuously retrying', async () => {
  fetch.mockResolvedValue({ models: [], error: 'Server offline' })
  const refresh = useAiModelCatalogueStore.getState().refresh, url = `http://offline/${sequence}`
  await refresh('vllm', url, ''); await refresh('vllm', url, '')
  expect(useAiModelCatalogueStore.getState().discoveries.vllm).toEqual({ models: [], loading: false, error: 'Server offline' })
  expect(fetch).toHaveBeenCalledTimes(1)
  await refresh('vllm', url, '', true)
  expect(fetch).toHaveBeenCalledTimes(2)
})
