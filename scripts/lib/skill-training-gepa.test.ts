import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM helper without type declarations
import { bestCandidate, paretoFront, pickParent, score, total, violations } from '../skill-training/lib/gepa.mjs'

const c = (id: string, val: Record<string, number>, overlay = {}) => ({ id, val, overlay })
const lint = (overlay: Record<string, string>, base: Record<string, string> = { 'topic:maps:body': 'Add a layer.' }) =>
  violations(overlay, { surface: base, trainText: ['please colour the counties by births now'], fixtureIdents: ['my_wells', 'a.b'], groups: ['map', 'ui'] })

describe('GEPA selection', () => {
  it('keeps a specialist that solves one task for one model, against a better average', () => {
    const generalist = c('general', { 'a|qwen': 1, 'b|qwen': 1, 'a|haiku': 1, 'b|haiku': 0 })
    const specialist = c('special', { 'a|qwen': 0, 'b|qwen': 0, 'a|haiku': 0, 'b|haiku': 1 })
    const dominated = c('dominated', { 'a|qwen': 0.5, 'b|qwen': 0.5, 'a|haiku': 0.5, 'b|haiku': 0.5 })
    expect(total(specialist.val)).toBeLessThan(total(dominated.val))
    expect(paretoFront([generalist, specialist, dominated]).map((f: { candidate: { id: string } }) => f.candidate.id)).toEqual(['general', 'special'])
  })
  it('counts ties as leads for both, and a column nobody passes for no one', () => {
    const front = paretoFront([c('x', { a: 1, dead: 0 }), c('y', { a: 1, dead: 0 })])
    expect(front.map((f: { leads: number }) => f.leads)).toEqual([1, 1])
  })
  it('a missing column counts as zero, not as unknown', () => {
    expect(paretoFront([c('x', { a: 1, b: 1 }), c('y', { a: 1 })]).find((f: { candidate: { id: string } }) => f.candidate.id === 'y').leads).toBe(1)
  })
  it('draws parents in proportion to columns led', () => {
    const pool = [c('three', { a: 1, b: 1, c: 1, d: 0 }), c('one', { a: 0, b: 0, c: 0, d: 1 })]
    const pick = (r: number) => pickParent(pool, () => r).id
    expect([pick(0), pick(0.74), pick(0.75), pick(0.999999)]).toEqual(['three', 'three', 'one', 'one'])
  })
  it('falls back to the seed when nothing passes anything', () => {
    expect(pickParent([c('seed', { a: 0 }), c('other', { a: 0 })], () => 0.5).id).toBe('seed')
  })
  it('breaks a total tie toward the shorter text', () => {
    expect(bestCandidate([c('long', { a: 1 }, { t: 'x'.repeat(50) }), c('short', { a: 1 }, { t: 'x' })]).id).toBe('short')
  })
  it('scores per task × model, averaging runs', () => {
    expect(score([{ task: 't', model: 'q', pass: true }, { task: 't', model: 'q', pass: false }, { task: 't', model: 'h', pass: true }])).toEqual({ 't|q': 0.5, 't|h': 1 })
  })
})

describe('GEPA lint', () => {
  it('passes a clean edit', () => expect(lint({ 'topic:maps:body': 'Add a layer, then style it.' })).toEqual([]))
  it('rejects copying a train prompt', () => expect(lint({ 'topic:maps:body': 'Say colour the counties by births now.' })[0]).toMatch(/copies a train prompt/))
  it('rejects a fixture object name, including dotted ones', () => {
    expect(lint({ 'topic:maps:body': 'Use my_wells here.' })[0]).toMatch(/fixture object/)
    expect(lint({ 'topic:maps:body': 'Use a.b here.' })[0]).toMatch(/fixture object/)
    expect(lint({ 'topic:maps:body': 'Use axb here.' })).toEqual([])
  })
  it('rejects a text over budget', () => expect(lint({ 'tool:x:description': 'y'.repeat(300) }, { 'tool:x:description': 'short' })[0]).toMatch(/budget/))
  it('flags an action id as R, but not ordinary dotted R', () => {
    expect(lint({ 'topic:maps:body': 'Call map.addLayer(x) to add it.' })[0]).toMatch(/dotted R/)
    expect(lint({ 'topic:maps:body': 'Call read.csv(f) to load it, keep env.vars out.' })).toEqual([])
  })
  it('does not blame an edit for what the baseline already says', () => {
    const base = 'Old text mentions my_wells and map.addLayer(x) already.'
    expect(lint({ 'topic:maps:body': `${base} Added.` }, { 'topic:maps:body': base })).toEqual([])
  })
})
