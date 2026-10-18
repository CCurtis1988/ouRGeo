import { describe, expect, it, vi } from 'vitest'
import { ContextBroker, type BrokerHost } from './broker'
import type { ContextSource } from './types'
import { parseProjectFileCitation, validProjectFileLocation } from '@/lib/project-file-citations'

function fixture() {
  const read = vi.fn(async (location, offset) => ({ id: 'file', revision: 'v1', title: 'Report', text: 'The independently specified design threshold is 73 mm.'.slice(offset), location, coverage: '80 physical pages', complete: true }))
  const source: ContextSource = { id: 'project-file:project:file', kind: 'document', scope: 'project', group: 'project-files', title: 'Report', summary: 'Annual report', revision: 'v1', trust: 'untrusted', read: () => { throw new Error('Unbounded read') }, readLocated: read, projectFile: { projectId: 'project', id: 'file', mediaType: 'application/pdf', coverage: '80 physical pages' } }
  const state = { sources: [source], excluded: [] as string[], current: true }
  const host: BrokerHost = { identity: { chatId: 'chat', projectId: 'project', workspaceEpoch: 2, policyRevision: 0 }, effort: 'balanced', target: 'fixture', signal: new AbortController().signal, current: () => state.current, sources: kinds => state.sources.filter(source => !kinds || kinds.includes(source.kind)), excluded: () => state.excluded, contentSearch: vi.fn(async () => [{ sourceId: source.id, revision: 'v1', excerpt: '73 mm', location: { kind: 'pdf' as const, page: 80 } }]) }
  return { host, state, source, read, broker: new ContextBroker(host) }
}

describe('project file evidence', () => {
  it('discovers a term absent from the description and reads its real page without loading the library', async () => {
    const { broker, read } = fixture()
    const results = JSON.parse(await broker.searchWithMemory({ query: '73 mm', group: 'project-files' }))
    expect(results.results).toHaveLength(1)
    expect(results.results[0]).toMatchObject({ excerpt: '73 mm', location: { kind: 'pdf', page: 80 } })
    expect(read).not.toHaveBeenCalled()
    const page = JSON.parse(await broker.read({ ref: results.results[0].ref }))
    expect(page).toMatchObject({ status: 'ok', content: 'The independently specified design threshold is 73 mm.', location: { kind: 'pdf', page: 80 } })
    expect(parseProjectFileCitation(page.citation)).toMatchObject({ projectId: 'project', id: 'file', revision: 'v1', location: { kind: 'pdf', page: 80 } })
  })
  it('filters content hits against current exclusion and revision after asynchronous search', async () => {
    const { broker, host, state, source } = fixture()
    host.contentSearch = async () => { state.excluded = [source.id]; return [{ sourceId: source.id, revision: 'v1', excerpt: 'secret' }] }
    expect(JSON.parse(await broker.searchWithMemory({ query: 'secret' })).results).toEqual([])
  })
  it('refuses old bytes after replacement and location changes on a bound reference', async () => {
    const { broker, source } = fixture()
    const ref = JSON.parse(await broker.searchWithMemory({ query: '73 mm' })).results[0].ref
    expect(JSON.parse(await broker.read({ ref, location: { kind: 'pdf', page: 79 } })).status).toBe('SOURCE_UNAVAILABLE')
    source.revision = 'v2'
    expect(JSON.parse(await broker.read({ ref })).status).toBe('STALE_REFERENCE')
  })
  it('does not disclose content read while the project is switched', async () => {
    const { broker, read, state } = fixture()
    const ref = JSON.parse(await broker.searchWithMemory({ query: '73 mm' })).results[0].ref
    read.mockImplementation(async () => { state.current = false; return { id: 'file', revision: 'v1', title: 'Report', text: 'late bytes', location: undefined, coverage: '', complete: true } })
    await expect(broker.read({ ref })).rejects.toThrow('SCOPE_CHANGED')
  })
  it('reports incomplete extraction without fabricating an endless continuation after the available text', async () => {
    const { broker, read } = fixture()
    read.mockImplementation(async location => ({ id: 'file', revision: 'v1', title: 'Report', text: 'Only this section was extracted.', location, coverage: 'Partial extraction; select another section or reindex.', complete: false }))
    const ref = JSON.parse(await broker.searchWithMemory({ query: '73 mm' })).results[0].ref
    const page = JSON.parse(await broker.read({ ref }))
    expect(page).toMatchObject({ status: 'ok', completeness: 'partial', nextCursor: null })
    expect(page.content).toContain('Only this section')
  })
  it('revokes a prepared image if its file changes while bytes are being materialised', async () => {
    const { broker, host, source } = fixture()
    source.projectFile!.mediaType = 'image/png'
    host.image = async (_source, ref) => ({ ref, sourceId: source.id, revision: source.revision, title: source.title, width: 192, height: 128, complete: true, estimatedTokens: 8192, materialise: async () => { source.revision = 'replacement'; return 'data:image/png;base64,QUJD' } })
    const page = JSON.parse(await broker.attach({ sourceId: source.id, revision: source.revision, workspaceEpoch: 2, location: { kind: 'image' } }))
    expect(page.status).toBe('ok')
    expect(broker.images).toHaveLength(1)
    await expect(broker.images[0].materialise()).rejects.toThrow('STALE_REFERENCE')
  })
  it('rejects mixed or malformed selectors instead of broadening a read', () => {
    expect(validProjectFileLocation({ kind: 'pdf', page: 0 })).toBe(false)
    expect(validProjectFileLocation({ kind: 'pdf', page: 80, sheet: 'Secret' })).toBe(false)
    expect(validProjectFileLocation({ kind: 'sheet', sheet: 'Calculations', range: 'B2:D12' })).toBe(true)
    expect(validProjectFileLocation({ kind: 'sheet', sheet: 'Calculations', range: '../file' })).toBe(false)
  })
})
