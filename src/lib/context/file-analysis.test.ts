import { describe, expect, it, vi } from 'vitest'
import { ContextBroker, type BrokerHost } from './broker'
import type { ContextSource } from './types'
import { estimateTokens } from './budget'

function fixture() {
  const source: ContextSource = { id: 'project-file:project:report', kind: 'document', scope: 'project', title: 'Drainage report', summary: 'Drainage design', revision: 'v1', trust: 'untrusted', projectFile: { projectId: 'project', id: 'report', mediaType: 'text/markdown', coverage: 'Indexed text' }, read: () => { throw new Error('Unbounded read forbidden') }, readLocated: vi.fn(async location => ({ id: 'report', revision: 'v1', title: 'Drainage report', text: 'The required freeboard is 0.75 metres.', complete: true, coverage: 'Selected lines only', location: location ?? { kind: 'lines', start: 1, end: 3 } })) }
  const state = { current: true, excluded: [] as string[] }
  const host: BrokerHost = { identity: { chatId: 'chat', projectId: 'project', workspaceEpoch: 1, policyRevision: 0 }, target: 'assistant/model', effort: 'balanced', signal: new AbortController().signal, current: () => state.current, sources: () => [source], excluded: () => state.excluded }
  const broker = new ContextBroker(host)
  const reference = () => JSON.parse(broker.search({ query: 'Drainage' })).results[0].ref as string
  return { source, state, host, broker, reference }
}

describe('separate file-analysis models in context retrieval', () => {
  it('keeps exact source evidence and citations alongside a labelled, bounded derived interpretation', async () => {
    const { broker, reference, host } = fixture()
    host.documentAnalysis = vi.fn(async (_source, evidence) => {
      expect(evidence.content).toBe('The required freeboard is 0.75 metres.')
      expect(evidence.location).toEqual({ kind: 'lines', start: 1, end: 3 })
      return { model: 'Local / document-specialist', text: 'Interpretation of the selected requirement. '.repeat(1000) }
    })
    const result = JSON.parse(await broker.read({ ref: reference() }))
    expect(result).toMatchObject({ status: 'ok', content: 'The required freeboard is 0.75 metres.', analysis: { model: 'Local / document-specialist', coverage: expect.stringContaining('excerpt only') } })
    expect(result.citation).toContain('ourgeo-project-file:')
    expect(estimateTokens(JSON.stringify(result))).toBeLessThanOrEqual(1800)
    expect(broker.trace.selected.at(-1)!.content).toContain('Document analysis (Local / document-specialist; excerpt only)')
  })

  it('reuses an identical interpretation only after rechecking the original through the located reader', async () => {
    const { broker, reference, host, source } = fixture()
    host.documentAnalysis = vi.fn(async () => ({ model: 'specialist', text: 'Keep 0.75 m.' }))
    const ref = reference()
    await broker.read({ ref }); await broker.read({ ref })
    expect(source.readLocated).toHaveBeenCalledTimes(2)
    expect(host.documentAnalysis).toHaveBeenCalledOnce()
  })

  it('does not call an analyser for an excluded source or expose late analysis after a source revision changes', async () => {
    const { broker, reference, host, state, source } = fixture()
    host.documentAnalysis = vi.fn(async () => { source.revision = 'v2'; return { model: 'specialist', text: 'UNAUTHORISED_LATE_ANALYSIS' } })
    const ref = reference()
    state.excluded = [source.id]
    expect(JSON.parse(await broker.read({ ref })).status).toBe('SOURCE_UNAVAILABLE')
    expect(host.documentAnalysis).not.toHaveBeenCalled()
    state.excluded = []
    const late = await broker.read({ ref })
    expect(JSON.parse(late).status).toBe('STALE_REFERENCE')
    expect(late).not.toContain('UNAUTHORISED_LATE_ANALYSIS')
    expect(broker.trace.selected).toHaveLength(1)
  })

  it('refuses delegated failure rather than silently substituting the assistant model', async () => {
    const { broker, reference, host } = fixture()
    host.documentAnalysis = vi.fn(async () => { throw new Error('Document model unavailable. Review File analysis models.') })
    await expect(broker.read({ ref: reference() })).rejects.toThrow('Document model unavailable')
    expect(broker.trace.selected).toHaveLength(1)
  })

  it('keeps inherited document reads local and unmodified', async () => {
    const { broker, reference } = fixture()
    const result = JSON.parse(await broker.read({ ref: reference() }))
    expect(result.content).toBe('The required freeboard is 0.75 metres.')
    expect(result.analysis).toBeUndefined()
  })

  it('returns a specialist visual interpretation as derived text without attaching image bytes to chat', async () => {
    const { broker, reference, host, source } = fixture()
    source.projectFile!.mediaType = 'image/png'
    host.image = vi.fn(async () => ({ interpretation: 'Three labelled blue bars.', model: 'Ollama / visual-specialist', complete: false }))
    const result = JSON.parse(await broker.read({ ref: reference(), location: { kind: 'image' } }))
    expect(result).toMatchObject({ status: 'ok', completeness: 'partial', trust: 'untrusted' })
    expect(result.content).toContain('Ollama / visual-specialist')
    expect(result.content).toContain('Three labelled blue bars.')
    expect(result.coverage).toContain('not image pixels')
    expect(broker.images).toHaveLength(0)
    expect(broker.trace.selected.at(-1)!.reason).toContain('separate image model')
  })

  it('discards a visual interpretation that completes after a workspace switch', async () => {
    const { broker, reference, host, source, state } = fixture()
    source.projectFile!.mediaType = 'image/png'
    host.image = async () => { state.current = false; return { interpretation: 'Late pixels.', model: 'specialist', complete: true } }
    await expect(broker.read({ ref: reference() })).rejects.toThrow('SCOPE_CHANGED')
    expect(broker.images).toHaveLength(0)
    expect(broker.trace.selected).toHaveLength(1)
  })
})
