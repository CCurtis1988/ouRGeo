import { expect, it } from 'vitest'
import { resolveTaskModel, validateTaskModelSelection } from './ai-task-models'

it('inherits only when explicitly selected and keeps separate routes independent', () => {
  const assistant = { provider: 'anthropic' as const, model: 'chat-model' }
  expect(resolveTaskModel(null, assistant)).toEqual(assistant)
  expect(resolveTaskModel({ provider: 'ollama', model: 'vision-model' }, assistant)).toEqual({ provider: 'ollama', model: 'vision-model' })
  expect(assistant).toEqual({ provider: 'anthropic', model: 'chat-model' })
})

it('refuses invalid explicit destinations rather than inheriting or accepting missing choices', () => {
  for (const value of [undefined, {}, { provider: 'unknown', model: 'x' }, { provider: 'openai', model: '' }, { provider: 'ollama', model: 'a\nb' }, { provider: 'ollama', model: 'x'.repeat(241) }]) {
    expect(() => validateTaskModelSelection(value)).toThrow()
  }
  expect(validateTaskModelSelection({ provider: 'openai', model: ' custom-id ' })).toEqual({ provider: 'openai', model: 'custom-id' })
})
