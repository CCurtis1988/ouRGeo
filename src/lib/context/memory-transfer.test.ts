import { describe, expect, it } from 'vitest'
import { aboutYouExport, planAboutYouImport, validateAboutYouPayload } from './memory-transfer'
import type { MemoryRecord } from './types'

const at = '2026-11-01T00:00:00.000Z'
const memory = (statement: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement, evidence: [crypto.randomUUID()], assertion: 'user-declared', createdAt: at, updatedAt: at, status: 'active', supersedes: [], ...extra })
const none = new Set<string>()
const plan = (current: MemoryRecord[], imported: MemoryRecord[], mode: 'merge' | 'replace', forgotten = none, foreign = none) => planAboutYouImport(current, imported, mode, forgotten, foreign, () => '00000000-0000-4000-8000-000000000001')

describe('About you export', () => {
  it('carries accepted About you memories only, without this machine’s chat evidence', () => {
    const accepted = memory('Prefer metric units.', { pinned: true })
    const payload = aboutYouExport([accepted, memory('Suggested: dark plots', { status: 'candidate' }), memory('Project rule', { scope: 'project', projectId: crypto.randomUUID() }), memory('Old', { status: 'superseded' })])
    expect(payload.memories).toEqual([{ ...accepted, evidence: [], supersedes: [] }])
    expect(validateAboutYouPayload(JSON.parse(JSON.stringify(payload))).memories).toEqual(payload.memories)
  })
  it('refuses a whole file with one damaged memory, a credential or a suggestion, naming the entry but never echoing the credential', () => {
    const good = aboutYouExport([memory('Prefer metric units.')])
    expect(() => validateAboutYouPayload({ ...good, memories: [...good.memories, { ...good.memories[0], id: crypto.randomUUID(), statement: 'My key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }] })).toThrow(/^Memory 2: statement looks like it contains a credential/)
    expect(() => validateAboutYouPayload({ ...good, memories: [{ ...good.memories[0], status: 'candidate' }] })).toThrow('status must be "active"')
    expect(() => validateAboutYouPayload({ ...good, version: 2 })).toThrow('Update ouRGeo')
    expect(() => validateAboutYouPayload({ format: 'something-else' })).toThrow('not an ouRGeo About you export')
  })
})

describe('planning an About you import', () => {
  it('adds what is new, keeps ids, and importing the same file twice changes nothing', () => {
    const incoming = aboutYouExport([memory('Prefer metric units.'), memory('Answer briefly.')]).memories
    const first = plan([], incoming, 'merge')
    expect(first.receipt).toMatchObject({ added: 2, removed: 0 })
    expect(first.save.map(m => m.id)).toEqual(incoming.map(m => m.id))
    const second = plan(first.save, incoming, 'merge')
    expect(second.save).toEqual([])
    expect(second.receipt).toMatchObject({ added: 0, unchanged: 2 })
  })
  it('never revives a memory forgotten on this machine, in either mode', () => {
    const incoming = aboutYouExport([memory('Use imperial units.')]).memories
    for (const mode of ['merge', 'replace'] as const) {
      const result = plan([], incoming, mode, new Set([incoming[0].id]))
      expect(result.save).toEqual([])
      expect(result.receipt.forgotten).toBe(1)
    }
  })
  it('merge keeps your own wording of a shared memory; replace takes the file’s', () => {
    const local = memory('Prefer metric units.')
    const incoming = [{ ...local, statement: 'Prefer metric units, kilometres for distance.', evidence: [] }]
    const merged = plan([local], incoming, 'merge')
    expect(merged.save).toEqual([])
    expect(merged.receipt.kept).toBe(1)
    const replaced = plan([local], incoming, 'replace')
    expect(replaced.save).toMatchObject([{ id: local.id, revision: 2, statement: incoming[0].statement }])
    expect(replaced.forget).toEqual([])
  })
  it('replace forgets what the file lacks, including suggestions, but keeps a same-worded twin instead of churning it', () => {
    const twin = memory('Answer briefly.', { pinned: true })
    const extra = memory('Use dark plots.'), suggestion = memory('Maybe cite sources', { status: 'candidate' })
    const incoming = aboutYouExport([memory('answer briefly.'), memory('Prefer metric units.')]).memories
    const result = plan([twin, extra, suggestion], incoming, 'replace')
    expect(result.forget.sort()).toEqual([extra.id, suggestion.id].sort())
    expect(result.save.map(m => m.statement)).toEqual(['Prefer metric units.'])
    expect(result.receipt).toMatchObject({ added: 1, unchanged: 1, removed: 2 })
  })
  it('accepts a local suggestion the other machine had accepted', () => {
    const suggestion = memory('Prefer metric units.', { status: 'candidate' })
    const result = plan([suggestion], aboutYouExport([memory('Prefer metric units.')]).memories, 'merge')
    expect(result.save).toMatchObject([{ id: suggestion.id, status: 'active', revision: 2 }])
  })
  it('imports a copy when the id already belongs to a project here', () => {
    const incoming = aboutYouExport([memory('Prefer metric units.')]).memories
    const result = plan([], incoming, 'merge', none, new Set([incoming[0].id]))
    expect(result.save[0].id).toBe('00000000-0000-4000-8000-000000000001')
  })
})
