import { describe, expect, it } from 'vitest'
import { routeContext, routeSkillDescriptors } from './router'
import { buildContextContract } from './compiler'
import { assertInvocationBudget, boundedText, estimateTokens } from './budget'
import { selectConversation } from './compaction'
import { forkProjectContext, validateProjectContext } from './memory-schema'
import { validateSkills } from './skills'
import type { MemoryRecord } from './types'

describe('selective planning', () => {
  it.each(['Generate 100 rows of dummy data.', 'Hello', 'Explain R vector recycling.'])('selects no auxiliary sources for %s', text => {
    expect(routeContext(text)).toEqual({ topics: [], environment: false, console: false, documents: false, memory: false })
  })
  it('routes combinations rather than picking a single keyword winner', () => {
    const route = routeContext('Fix this knit error and use an autumn theme for the document')
    expect(route.topics).toEqual(['themes', 'documents'])
    expect(route.console).toBe(true)
  })
  it('uses declarative plugin aliases and negative examples without loading bodies', () => {
    const descriptors = [{ topic: 'flood:workflow', triggers: ['flood exposure', 'exposición a inundaciones'], exclusions: ['general explanation of floods'] }]
    expect(routeSkillDescriptors('Assess flood exposure on these parcels', descriptors)).toEqual(['flood:workflow'])
    expect(routeSkillDescriptors('Evaluar la exposición a inundaciones', descriptors)).toEqual(['flood:workflow'])
    expect(routeSkillDescriptors('A general explanation of floods and flood exposure', descriptors)).toEqual([])
    expect(routeSkillDescriptors('Generate 100 rows of dummy data.', descriptors)).toEqual([])
  })
  it('keeps the contract under its hard token ceiling for every switch combination', () => {
    for (const autoPilot of [false, true]) for (const web of [false, true]) for (const terminal of [false, true]) for (const viaMcp of [false, true]) {
      const contract = buildContextContract({ autoPilot, web, terminal, viaMcp })
      expect(estimateTokens(contract)).toBeLessThanOrEqual(1200)
      expect(contract).not.toContain('full visibility')
    }
  })
  it('accounts for schemas and wrappers, not only message text', () => {
    expect(() => assertInvocationBudget({ text: 'Hi', tools: ['x'.repeat(12000)] }, 4096, 512)).toThrow('BUDGET_LIMIT')
  })
  it('bounds multilingual content without damaging surrogate pairs', () => {
    const result = boundedText('測定😀'.repeat(1000), 100)
    expect(result.complete).toBe(false)
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(100)
    expect(result.text).not.toMatch(/[\uD800-\uDBFF]$/)
  })
  it('preserves an early exact user constraint while removing excessive old assistant output', () => {
    const messages = [{ id: 'first', role: 'user' as const, content: 'Use exactly 12.5 US survey feet; do not convert to international feet.', timestamp: 0 }, { id: 'long', role: 'assistant' as const, content: 'old output '.repeat(5000), timestamp: 1 }, { id: 'last', role: 'user' as const, content: 'Continue.', timestamp: 2 }]
    const view = selectConversation(messages, 4000)
    expect(view.messages.find(m => m.id === 'first')).toEqual(messages[0])
    expect(view.omitted).toEqual(['long'])
    expect(view.messages[0].content).toContain('"messageId":"first"')
    expect(view.messages[0].content).toContain('not privileged guidance')
    expect(estimateTokens(view.messages)).toBeLessThanOrEqual(4000 * .85)
    expect(messages).toHaveLength(3)
  })
})

describe('portable project identity', () => {
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'project', projectId: 'original', category: 'decision', statement: 'Use metres.', evidence: ['message-1'], assertion: 'user-declared', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', status: 'active', supersedes: [] }
  it('forks canonical IDs and writable scope while retaining snapshot lineage', () => {
    const original = { version: 1 as const, revision: 4, memories: [record] }
    const copy = forkProjectContext(original, 'copy')
    expect(copy.memories[0].projectId).toBe('copy')
    expect(copy.memories[0].id).not.toBe(record.id)
    expect(copy.memories[0].lineage).toBe(record.id)
    expect(original.memories[0].projectId).toBe('original')
  })
  it('drops foreign scope, secrets, malformed provenance and untrusted extra fields', () => {
    const safe = { ...record, arbitraryEndpoint: 'https://example.invalid' }
    const result = validateProjectContext({ version: 1, revision: 4, memories: [safe,
      { ...record, id: crypto.randomUUID(), projectId: 'other' },
      { ...record, id: crypto.randomUUID(), statement: 'api_key=private' },
      { ...record, id: crypto.randomUUID(), evidence: ['api_key=private'] },
      { ...record, id: crypto.randomUUID(), evidence: ['sk-' + 'credential'.repeat(4)] },
      { ...record, id: crypto.randomUUID(), supersedes: ['api_key=private'] },
      { ...record, id: crypto.randomUUID(), lineage: 'api_key=private' },
      { ...record, id: crypto.randomUUID(), status: 'deleted' },
    ] }, 'original')
    expect(result.memories).toEqual([record])
  })
  it('refuses a skill body outside the plugin and future required context versions', () => {
    expect(() => validateSkills({ version: 1, skills: [{ id: 'flood', summary: 'Assess floods', bodyFile: '../secrets.md' }] })).toThrow('inside the plugin')
    expect(() => validateSkills({ version: 2, skills: [] })).toThrow('version 1')
  })
})
