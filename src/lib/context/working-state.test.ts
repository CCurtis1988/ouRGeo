import { describe, expect, it } from 'vitest'
import { buildWorkingState } from './working-state'
import { estimateTokens } from './budget'

describe('conversation working state', () => {
  it('preserves exact user constraints and source lineage without treating assistant speculation as a decision', () => {
    const state = buildWorkingState([{ id: 'first', role: 'user', content: 'Use exactly 12.5 US survey feet. Do not convert to international feet.', timestamp: 0 }, { id: 'guess', role: 'assistant', content: 'We must assume all roads are 10 metres long.', timestamp: 1 }, { id: 'next', role: 'user', content: 'Continue the analysis.', timestamp: 2 }])
    expect(state.constraints.some(span => span.text.includes('12.5 US survey feet'))).toBe(true)
    expect(state.constraints.every(span => span.messageId === 'first')).toBe(true)
    expect(JSON.stringify(state)).not.toContain('10 metres')
  })
  it('bounds the state and links oversized original instructions without truncating them', () => {
    const content = 'Always preserve this exact definition: ' + 'very long original text '.repeat(1000)
    const state = buildWorkingState([{ id: 'oversize', role: 'user', content, timestamp: 0 }])
    expect(estimateTokens(state)).toBeLessThanOrEqual(800)
    expect(state.overflow).toEqual(['oversize'])
    expect(state.constraints).toEqual([])
  })
  it('keeps declared decisions, exact entities and prior failures attributed to their original messages', () => {
    const state = buildWorkingState([
      { id: 'decision', role: 'user', content: 'We decided to use EPSG:27700 for [roads].', timestamp: 0 },
      { id: 'failure', role: 'assistant', content: 'The buffer failed: the geometry was invalid.', timestamp: 1 },
      { id: 'question', role: 'user', content: 'Which repair should we use?', timestamp: 2 },
    ])
    expect(state.decisions).toContainEqual({ messageId: 'decision', text: 'We decided to use EPSG:27700 for [roads].' })
    expect(state.entities).toEqual(expect.arrayContaining([{ messageId: 'decision', text: 'EPSG:27700' }, { messageId: 'decision', text: '[roads]' }]))
    expect(state.questions).toContainEqual({ messageId: 'question', text: 'Which repair should we use?' })
    expect(state.failedAttempts).toContainEqual({ messageId: 'failure', text: 'The buffer failed: the geometry was invalid.' })
    expect(state.decisions.every(span => span.messageId !== 'failure')).toBe(true)
    expect(estimateTokens(state)).toBeLessThanOrEqual(800)
  })
  it('rebuilds from originals and keeps conflicting declarations distinct instead of trusting an earlier summary', () => {
    const messages = [
      { id: 'old', role: 'user' as const, content: 'We chose metric units.', timestamp: 0 },
      { id: 'new', role: 'user' as const, content: 'We decided to use miles for this comparison.', timestamp: 1 },
    ]
    expect(buildWorkingState(messages).decisions).toEqual([
      { messageId: 'new', text: messages[1].content }, { messageId: 'old', text: messages[0].content },
    ])
    expect(buildWorkingState(messages.slice(1)).decisions).toEqual([{ messageId: 'new', text: messages[1].content }])
  })
})
