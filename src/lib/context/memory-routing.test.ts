import { describe, expect, it } from 'vitest'
import { turnStartMemories } from './memory-routing'
import { preferenceCategories } from './preferences'
import { ContextBroker, type BrokerHost } from './broker'
import type { ContextSource } from './types'

// Built the way sources/workspace.ts builds a memory source.
const memory = (id: string, statement: string, scope: 'project' | 'global' = 'project', timestamp = '2026-11-01T00:00:00Z'): ContextSource => ({
  id: `memory:${id}`, kind: 'memory', scope, title: statement.slice(0, 120), summary: `${statement} ${preferenceCategories(statement).join(' ')}`,
  revision: '1', timestamp, trust: 'user', read: () => JSON.stringify({ id, statement, status: 'active', scope, pinned: false }),
})
const DARK = memory('dark', 'Always make all plot dark themed')
const METRIC = memory('metric', 'Always use metric units in charts and reports')
const CENSUS = memory('census', 'We decided to use the 2020 census county boundaries')
const CLIENT = memory('client', 'The client for this project is the county planning office')
const LIBRARY = [DARK, METRIC, CENSUS, CLIENT]

describe('turn-start memory routing', () => {
  // The study's requests: none contains a memory keyword, and before this change
  // none of them brought in a memory (docs/context-memory-diagnosis.md).
  it.each([
    ['draw a histogram of depth in my quakes table', DARK],
    ['plot mag against depth for my quakes data', DARK],
    ['make a bar chart of mean mpg by cyl for my cars table', DARK],
    ['show me a boxplot of mpg by gear from cars', DARK],
    ['plot revenue over time from my sales table', DARK],
    ['make a map of nc coloured by BIR74', DARK],
    ['chart elevation gain for each trail', METRIC],
    ['write a short report on my trails table', METRIC],
  ])('"%s" brings in the memory it needs', (text, expected) => {
    expect(turnStartMemories(text, LIBRARY)).toContain(expected.id)
  })
  it('generalises to instructions no category was written for', () => {
    const caption = memory('caption', 'Always add a caption with the data source to every figure')
    const upper = memory('upper', 'Always name new columns in UPPER CASE')
    const rows = memory('rows', 'Always state how many rows were used in every report')
    const library = [caption, upper, rows, CENSUS, CLIENT]
    expect(turnStartMemories('draw a histogram of depth in my quakes table', library)).toContain(caption.id)
    expect(turnStartMemories('add a column to cars with mpg converted to kilometres per litre', library)).toContain(upper.id)
    expect(turnStartMemories('write a short report on my quakes table', library)).toContain(rows.id)
  })
  it('a request no memory fits selects none, so unrelated turns carry no memories', () => {
    expect(turnStartMemories("what's the mean mpg in my cars table?", LIBRARY)).toEqual([])
    expect(turnStartMemories('How do R lists work?', LIBRARY)).toEqual([])
    expect(turnStartMemories('Generate 100 rows of dummy data.', [memory('m', 'I prefer metric units', 'global')])).toEqual([])
  })
  it('generic verbs are not a match: "make a table" is not about making plots dark', () => {
    expect(turnStartMemories('make a table of counts by cyl', [DARK])).toEqual([])
  })
  it('takes at most two, best first, project before personal on a tie', () => {
    const personal = memory('personal', 'Always make all plot dark themed', 'global')
    expect(turnStartMemories('plot depth', [personal, DARK])).toEqual([DARK.id, personal.id])
    expect(turnStartMemories('make a bar chart for the report', LIBRARY)).toHaveLength(2)
  })
})

describe('memory prefetch is not crowded out', () => {
  const skill = (topic: string): ContextSource => ({ id: `skill:${topic}`, kind: 'skill', scope: 'application', title: topic, summary: topic, revision: '1', trust: 'host', read: () => 'x '.repeat(4800) })
  const host = (sources: ContextSource[]): BrokerHost => ({ identity: { chatId: 'c', projectId: 'p', workspaceEpoch: 1, policyRevision: 1 }, target: 'test', effort: 'balanced', signal: new AbortController().signal, current: () => true,
    sources: kinds => sources.filter(s => !kinds || kinds.includes(s.kind)), excluded: () => [] })
  const sources = [skill('maps'), skill('documents'), METRIC]
  it('an active skill plus a routed topic used to use up the shared allowance before the memory; read first, the memory arrives', async () => {
    // Old order: active skill attached, then one prefetch with topics ahead of memories.
    const before = new ContextBroker(host(sources))
    await before.loadSkill('skill:maps', 'active skill', 2500)
    await before.prefetch(['skill:documents', METRIC.id], 2400)
    expect(before.trace.selected.some(e => e.sourceId === METRIC.id)).toBe(false)

    // New order (AiChatPanel): memories read first, with their own allowance on top of what is selected.
    const after = new ContextBroker(host(sources))
    await after.loadSkill('skill:maps', 'active skill', 2500)
    const selected = after.trace.selected.reduce((sum, e) => sum + e.estimatedTokens, 0)
    await after.prefetch([METRIC.id], Math.min(2400, selected + 600))
    await after.prefetch(['skill:documents'], 2400)
    expect(after.trace.selected.some(e => e.sourceId === METRIC.id)).toBe(true)
  })
  it('memories the host reads at turn start do not spend the model\'s lookups; anything else it prefetches still does', async () => {
    const env: ContextSource = { id: 'environment:.GlobalEnv:nc', kind: 'environment', scope: 'conversation', title: 'nc', summary: 'nc', revision: '1', trust: 'observed', read: () => 'nc: sf, 100 rows' }
    const broker = new ContextBroker(host([METRIC, DARK, env]))
    await broker.prefetch([METRIC.id, DARK.id], 600)
    expect(broker.trace.retrievalCalls).toBe(0)
    await broker.prefetch([env.id], 600)
    expect(broker.trace.retrievalCalls).toBe(1)
  })
})
