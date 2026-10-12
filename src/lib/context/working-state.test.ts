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

it('keeps an early exact definition and recent correction when intervening constraints fill the card', () => {
  const messages = [
    { id: 'first', role: 'user' as const, content: 'Use exactly 12.5 US survey feet.', timestamp: 0 },
    ...Array.from({ length: 25 }, (_, index) => ({ id: `filler-${index}`, role: 'user' as const, content: `Always label intermediate chart ${index} with a descriptive title and an accurate caption.`, timestamp: index + 1 })),
    { id: 'correction', role: 'user' as const, content: 'Actually, use exactly 12.6 US survey feet for the revised comparison.', timestamp: 30 },
  ]
  const state = buildWorkingState(messages)
  expect(state.constraints).toEqual(expect.arrayContaining([
    { messageId: 'first', text: messages[0].content },
    { messageId: 'correction', text: messages.at(-1)!.content },
  ]))
  expect(estimateTokens(state)).toBeLessThanOrEqual(800)
})

it('records explicit corrections as attributed declarations and retains decimal units as exact spans', () => {
  const state = buildWorkingState([
    { id: 'original', role: 'user', content: 'We chose 12. US survey feet for this example.', timestamp: 0 },
    { id: 'correction', role: 'user', content: 'Correction: 12.5 US survey feet applies only to this comparison.', timestamp: 1 },
    { id: 'question', role: 'user', content: 'Which layer is current?', timestamp: 2 },
    { id: 'answered', role: 'assistant', content: 'The active layer is roads.', timestamp: 3 },
  ])
  expect(state.decisions).toContainEqual({ messageId: 'correction', text: 'Correction: 12.5 US survey feet applies only to this comparison.' })
  expect(state.decisions).toContainEqual({ messageId: 'original', text: 'We chose 12. US survey feet for this example.' })
  expect(state.questions).toContainEqual({ messageId: 'question', text: 'Which layer is current?' })
  expect(state).not.toHaveProperty('unresolved')
})

it('does not turn correction questions or earlier generated compaction into new decisions or failures', () => {
  const state = buildWorkingState([
    { id: 'question', role: 'user', content: 'Actually, should we use miles instead?', timestamp: 0 },
    { id: 'context-compaction', role: 'assistant', content: 'Derived state: the earlier buffer failed according to a historical summary.', timestamp: 1 },
  ])
  expect(state.decisions).toEqual([])
  expect(state.questions).toContainEqual({ messageId: 'question', text: 'Actually, should we use miles instead?' })
  expect(state.failedAttempts).toEqual([])
})
