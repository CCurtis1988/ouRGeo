import { describe, expect, it } from 'vitest'
import { evaluateContext } from './evaluation'
import type { EvaluationFixture, EvaluationReference } from './evaluation'

const fixture: EvaluationFixture = { version: 1, id: 'test', plugin: { topic: 'flood', summary: 'flood', triggers: [], exclusions: [], body: 'flood' }, heldOutSkills: [{ text: 'unrecognised paraphrase', skill: 'themes' }],
  resources: [
    { id: 'environment:roads', kind: 'environment', scope: 'workspace', title: 'roads', summary: 'roads schema', body: 'road_id integer' },
    { id: 'memory:foreign', kind: 'memory', scope: 'project', title: 'foreign', summary: 'foreign private', body: 'Never disclose', authorised: false },
    { id: 'document:excluded', kind: 'document', scope: 'workspace', title: 'excluded', summary: 'excluded private', body: 'Never disclose', excluded: true },
  ], turns: [
    { id: 'simple', text: 'Generate 100 rows of dummy data.', contextFree: true },
    { id: 'data', text: 'Which columns are in [roads]?', search: { query: 'roads', kinds: ['environment'] }, expected: ['environment:roads'] },
    { id: 'foreign', text: 'Find foreign memory', search: { query: 'foreign', kinds: ['memory'] }, expected: [] },
    { id: 'excluded', text: 'Find excluded document', search: { query: 'excluded', kinds: ['document'] }, expected: [] },
  ] }
const references: EvaluationReference[] = [{ topic: 'themes', summary: 'theme templates contrast', triggers: [], exclusions: [], body: 'Copy a template and check contrast.' }]
const options = { schemas: [{ name: 'context_search', parameters: { query: 'string' } }], legacyContract: 'Legacy permanent document instructions '.repeat(100) }

describe('offline complete-turn evaluation', () => {
  it('accounts for initial, search and read invocations rather than counting only the first prompt', async () => {
    const report = await evaluateContext(fixture, references, options)
    expect(report.totals.invocations).toBe(8)
    expect(report.turns[1].invocations.map(invocation => invocation.phase)).toEqual(['initial', 'after-search', 'after-read'])
    expect(report.totals.estimatedInputTokens).toBe(report.turns.flatMap(turn => turn.invocations).reduce((sum, invocation) => sum + invocation.estimatedInputTokens, 0))
    expect(report.totals.estimatedInputTokens).toBeGreaterThan(report.turns.reduce((sum, turn) => sum + turn.invocations[0].estimatedInputTokens, 0))
    expect(report.gates.contextFree).toBe(true)
    expect(report.turns[0].sourceDiscoveries).toBe(0)
    expect(report.turns[0].selectedAuxiliarySources).toBe(0)
  })
  it('keeps scope filtering at the fixture host boundary and still verifies broker exclusions', async () => {
    const report = await evaluateContext(fixture, references, options)
    expect(report.gates.authorisedFixtureBoundary).toBe(true)
    expect(report.turns[2].hitIds).toEqual([])
    expect(report.turns[3].hitIds).toEqual([])
    expect(report.turns.every(turn => turn.providerCalls === 0)).toBe(true)
    expect(report.modelTaskSuccess.status).toBe('not-measured')
    expect(report.humanReview.status).toBe('not-performed')
  })
  it('reports failed discovery instead of turning fixture expectations into successful results', async () => {
    const report = await evaluateContext(fixture, references, options)
    expect(report.heldOutSkills[0].withinTwoSteps).toBe(false)
    expect(report.gates.skillDiscoveryWithinTwoSteps).toBe(0)
    const missed: EvaluationFixture = { ...fixture, turns: [{ id: 'missing', text: 'Find missing', search: { query: 'missing', kinds: ['environment'] }, expected: ['environment:roads'] }] }
    expect((await evaluateContext(missed, references, options)).gates.recallAt5).toBe(0)
  })
  it('counts literal serialised multilingual wrappers and refuses overflowing app-selected material', async () => {
    const report = await evaluateContext(fixture, references, { ...options, schemas: { description: '測定😀'.repeat(30) } })
    expect(report.totals.estimatedInputTokens).toBeGreaterThan((await evaluateContext(fixture, references, options)).totals.estimatedInputTokens)
    await expect(evaluateContext(fixture, references, { ...options, window: 4096 })).rejects.toThrow('BUDGET_LIMIT')
  })
})
