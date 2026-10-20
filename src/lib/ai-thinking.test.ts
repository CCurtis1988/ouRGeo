import { expect, it } from 'vitest'
import { thinkingCapability as capability, ollamaThinkingCapability, thinkingWire, thinkingKey, thinkingOutputReservation } from './ai-thinking'
it('offers only the levels supported by known models and keeps unqualified servers hidden', () => {
  const values = (provider: Parameters<typeof capability>[0], model: string) => capability(provider, model)?.choices.map(choice => choice.value)
  expect(values('openai', 'o3')).toEqual(['low', 'medium', 'high'])
  expect(values('openai', 'gpt-5-2025-08-07')).toEqual(['minimal', 'low', 'medium', 'high'])
  expect(values('openai', 'gpt-6.1-sol')).not.toContain('none')
  expect(values('openai', 'gpt-6-luna')).toContain('none')
  expect(values('anthropic', 'claude-sonnet-4-6')).toEqual(['low', 'medium', 'high', 'max'])
  expect(values('anthropic', 'claude-opus-4-5-20251101')).toEqual(['low', 'medium', 'high'])
  for (const [provider, model] of [['openai', 'gpt-4o'], ['openai', 'o1-preview'], ['anthropic', 'claude-haiku-4-5-20251001'], ['google', 'gemini-2.0-flash'], ['lmstudio', 'o3'], ['openai', 'unknown-future-model']] as const) expect(capability(provider, model)).toBeNull()
  expect(thinkingKey('openai', 'o3')).not.toBe(thinkingKey('openai-subscription', 'o3'))
})
it('uses Gemini token budgets without inventing an off setting for Pro', () => {
  const pro = capability('google', 'gemini-2.5-pro')!
  expect(pro.protocol).toBe('google-budget')
  expect(pro.choices.some(choice => choice.value === 'off')).toBe(false)
  expect(thinkingWire({ capability: pro, value: '8192' })).toBe(8192)
  expect(thinkingWire({ capability: pro, value: 'high' })).toBeUndefined()
  expect(thinkingWire({ capability: pro, value: 'default' })).toBeUndefined()
  expect(thinkingWire({ capability: capability('google', 'gemini-2.5-flash')!, value: 'off' })).toBe(0)
})
it('honours exact Ollama metadata including custom model levels and hides non-thinking models', () => {
  const cap = ollamaThinkingCapability({ thinking: { values: ['low', 'xhigh'], default: 'xhigh' } }, 'my-model')!
  expect(cap.defaultLabel).toBe('Extra high')
  expect(thinkingWire({ capability: cap, value: 'xhigh' })).toBe('xhigh')
  expect(ollamaThinkingCapability({ thinking: { values: [false] } }, 'my-model')).toBeNull()
  expect(ollamaThinkingCapability({}, 'gpt-oss')).toBeNull()
  const old = ollamaThinkingCapability({ capabilities: ['thinking'] }, 'qwen3')!
  expect(thinkingWire({ capability: old, value: 'off' })).toBe(false)
})
it('reserves thinking output before input compilation while preserving default and small-window bounds', () => {
  const pro = capability('google', 'gemini-2.5-pro')!
  expect(thinkingOutputReservation(4000, 128000, { capability: pro, value: '8192' })).toBe(12192)
  const cap = capability('openai', 'o3')!
  expect(thinkingOutputReservation(4000, 128000, { capability: cap, value: 'high' })).toBe(16384)
  expect(thinkingOutputReservation(4000, 32000, { capability: cap, value: 'high' })).toBe(8000)
  expect(thinkingOutputReservation(4000, 128000, { capability: cap, value: 'default' })).toBe(4000)
})
