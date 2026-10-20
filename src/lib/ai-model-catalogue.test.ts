import { expect, it } from 'vitest'
import { modelCatalogue } from './ai-model-catalogue'

it('reuses saved/custom chat choices, historical chats and task models without duplicate model IDs', () => {
  const choices = modelCatalogue({ provider: 'ollama', selected: 'custom/model:v2', preferred: ' custom/model:v2 ', chats: [{ provider: 'ollama', model: 'older-custom' }, { provider: 'openai', model: 'unrelated-provider' }], tasks: [{ provider: 'ollama', model: 'task-custom' }, null], discovered: [{ id: 'custom/model:v2', label: 'Existing local model' }, { id: 'server-model', label: 'Server model' }, { id: 'server-model', label: 'Server model' }] })
  expect(choices).toEqual([{ id: 'custom/model:v2', label: 'Existing local model' }, { id: 'older-custom', label: 'older-custom' }, { id: 'task-custom', label: 'task-custom' }, { id: 'server-model', label: 'Server model' }])
})

it('keeps Claude aliases and existing custom CLI selections using the same provider', () => {
  const choices = modelCatalogue({ provider: 'claude-cli', preferred: 'opus[1m]' })
  expect(choices.map(model => model.id)).toEqual(['opus[1m]', 'opus', 'sonnet', 'haiku'])
})

it('keeps subscription eligibility labels and separates API and subscription model identities', () => {
  const chats = [{ provider: 'openai' as const, model: 'api-only-custom' }, { provider: 'openai-subscription' as const, model: 'plan-model' }]
  const api = modelCatalogue({ provider: 'openai', chats, preferred: 'shared-id' })
  const plan = modelCatalogue({ provider: 'openai-subscription', chats, preferred: 'shared-id', discovered: [{ id: 'shared-id', label: 'Available in your plan' }, { id: 'plan-model', label: 'Plan model' }] })
  expect(api.some(model => model.id === 'api-only-custom')).toBe(true)
  expect(api.some(model => model.id === 'plan-model')).toBe(false)
  expect(plan).toEqual([{ id: 'shared-id', label: 'Available in your plan' }, { id: 'plan-model', label: 'Plan model' }])
})
