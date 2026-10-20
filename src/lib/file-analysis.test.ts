import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendOptions } from './ai-client'
import type { ContextTrace } from './context/types'
import { estimateTokens } from './context/budget'
import { runFileAnalysis, type FileAnalysisOptions } from './file-analysis'

const mocks = vi.hoisted(() => ({ send: vi.fn(), capability: vi.fn(), probe: vi.fn(), resolve: vi.fn(), init: vi.fn(), begin: vi.fn(), end: vi.fn(), prepare: vi.fn(), record: vi.fn(), keys: { initialized: true, keys: {} as Record<string, string> }, traceInspector: vi.fn() }))
vi.mock('@/store/apiKeys', () => ({ useApiKeysStore: { getState: () => ({ ...mocks.keys, init: mocks.init }) } }))
vi.mock('@/store/context', () => ({ useContextStore: { getState: () => ({ prepareTraceUsage: mocks.prepare, recordTraceUsage: mocks.record, setTrace: mocks.traceInspector }) } }))
vi.mock('./ai-client', () => ({ sendMessage: mocks.send, imageCapability: mocks.capability, fetchLocalContextSize: mocks.probe, resolveContextSize: mocks.resolve,
  PROVIDER_LABELS: { ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', 'claude-cli': 'Claude Code' },
  isLocalProvider: (provider: string) => provider === 'ollama', requiresApiKey: (provider: string) => ['openai', 'anthropic', 'google'].includes(provider),
  localBaseUrl: (_provider: string, keys: Record<string, string>) => keys.ollama_url || 'http://localhost:11434',
  localApiKey: (_provider: string, keys: Record<string, string>) => keys.ollama_key || '',
  localCtxOverride: (_provider: string, keys: Record<string, string>) => keys.ollama_ctx ? Number(keys.ollama_ctx) : null,
}))

function input(): FileAnalysisOptions {
  return { task: 'document', target: { provider: 'ollama', model: 'selected-document-model' }, identity: { chatId: crypto.randomUUID(), projectId: 'project', workspaceEpoch: 1, policyRevision: 2 }, question: 'What is the requirement?', evidence: { ref: 'ref1', sourceId: 'project-file:project:file', kind: 'document', scope: 'project', title: 'Report.md', revision: 'hash:1', reason: 'Selected reference', content: 'Minimum freeboard is 0.6 m.', estimatedTokens: 20, completeness: 'complete' }, signal: new AbortController().signal, current: () => true, validate: vi.fn() }
}
function visual(): FileAnalysisOptions {
  const options = input(); options.task = 'image'; options.target.model = 'custom-vision:latest'
  options.image = { ref: options.evidence.ref, sourceId: options.evidence.sourceId, revision: options.evidence.revision, title: 'Figure', width: 512, height: 256, estimatedTokens: 8192, complete: false, materialise: vi.fn(async () => 'data:image/png;base64,AAAA') }
  return options
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.keys.initialized = true; mocks.keys.keys = {}; mocks.resolve.mockReturnValue(32768); mocks.probe.mockResolvedValue(24576); mocks.capability.mockResolvedValue('supported'); mocks.begin.mockResolvedValue('authority'); mocks.end.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue(undefined); mocks.record.mockResolvedValue(undefined)
  vi.stubGlobal('window', { electronAPI: { context: { lease: vi.fn(async () => ({ id: 'lease', projectId: 'project' })), beginInferenceUsage: mocks.begin, endInferenceUsage: mocks.end } } })
  mocks.send.mockImplementation(async (options: SendOptions) => {
    options.beforeInvocation?.({}, 500, options.contextSize!); await options.beforeDispatch?.()
    options.onInvocationUsage?.({ invocation: 1, scope: 'invocation', attempt: 0, inputTokens: 495, outputTokens: 25 })
    return 'The supplied report requires 0.6 m freeboard.'
  })
})

describe('isolated file-task inference', () => {
  it('uses the separately selected target, one bounded message and a fresh accounted turn without tools, chat or retained CLI sessions', async () => {
    const options = input(); mocks.keys.keys = { ollama_url: 'http://local-model:11434', ollama_key: 'private-key' }
    expect(await runFileAnalysis(options)).toContain('0.6 m')
    const sent: SendOptions = mocks.send.mock.calls[0][0]
    expect(sent).toMatchObject({ provider: 'ollama', model: 'selected-document-model', localUrl: 'http://local-model:11434', localApiKey: 'private-key', contextSize: 32768, ollamaContextSize: 32768, tools: [], maxOutputTokens: 320 })
    expect(sent.messages).toHaveLength(1); expect(sent.messages[0].role).toBe('user')
    expect(sent.messages[0].content).toContain(options.evidence.content)
    for (const key of ['claudeSessionId', 'claudeResume', 'claudeContextUsed', 'sessionContext', 'onToolCall', 'onOpenAiMessages', 'onClaudeSession']) expect(sent).not.toHaveProperty(key)
    expect(mocks.probe).toHaveBeenCalledWith('ollama', 'http://local-model:11434', 'private-key', 'selected-document-model')
    const trace: ContextTrace = mocks.record.mock.calls.at(-1)![0]
    expect(mocks.begin).toHaveBeenCalledWith(options.identity.chatId, trace.turnId, 'ollama', 'lease', options.target.model)
    expect(trace.turnId).not.toBe(options.identity.chatId); expect(trace.state).toBe('acknowledged')
    expect(trace.usage?.[0].outputTokens).toBe(25)
    expect(mocks.prepare).toHaveBeenCalledWith(trace, 'ollama', 320, 'authority')
    expect(mocks.record).toHaveBeenLastCalledWith(trace, 'ollama', true, 'authority')
    expect(mocks.end).toHaveBeenCalledWith('authority'); expect(mocks.traceInspector).not.toHaveBeenCalled()
  })
  it('bounds excerpts, questions and outputs while preserving partial coverage and redacting credentials', async () => {
    const options = input(); options.evidence.content = 'private API_KEY=do-not-send\n' + '報告'.repeat(30000); options.question = 'Q'.repeat(30000)
    mocks.send.mockImplementation(async (sent: SendOptions) => { sent.beforeInvocation?.({}, 500, sent.contextSize!); await sent.beforeDispatch?.(); return '解釈'.repeat(30000) })
    const result = await runFileAnalysis(options), sent: SendOptions = mocks.send.mock.calls[0][0]
    expect(estimateTokens(result)).toBeLessThanOrEqual(320)
    expect(estimateTokens(sent.messages[0].content)).toBeLessThan(7500)
    expect(sent.messages[0].content).toContain('Evidence (partial)'); expect(sent.messages[0].content).not.toContain('do-not-send')
  })
  it('resolves the independent target context cap and refuses an image that cannot fit instead of using the chat model', async () => {
    mocks.keys.keys = { ollama_ctx: '4096' }; mocks.resolve.mockReturnValue(4096)
    await expect(runFileAnalysis(visual())).rejects.toThrow('BUDGET_LIMIT')
    expect(mocks.probe).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled()
  })
  it('routes a custom Ollama vision model only after explicit capability and original-source checks', async () => {
    const options = visual(); await runFileAnalysis(options)
    expect(mocks.capability).toHaveBeenCalledWith('ollama', 'custom-vision:latest', 'http://localhost:11434', '', options.signal)
    const sent: SendOptions = mocks.send.mock.calls[0][0], image = sent.imageEvidence!()[0]
    expect(sent.model).toBe('custom-vision:latest'); expect(image.complete).toBe(false)
    await expect(image.materialise()).resolves.toContain('data:image/')
    expect(options.validate).toHaveBeenCalled()
  })
  it.each(['unsupported', 'unknown'])('refuses %s image support without sending metadata as an image or falling back', async capability => {
    mocks.capability.mockResolvedValue(capability)
    await expect(runFileAnalysis(visual())).rejects.toThrow('no fallback')
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled()
  })
  it('requires real matching image evidence and never sends pixels to the document model', async () => {
    const options = visual(); options.image!.revision = 'stale'
    await expect(runFileAnalysis(options)).rejects.toThrow('metadata alone')
    const document = visual(); document.task = 'document'
    await expect(runFileAnalysis(document)).rejects.toThrow('no image was sent')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('uses configured cloud credentials and refuses a missing key with no fallback', async () => {
    const options = input(); options.target = { provider: 'google', model: 'selected-document-model' }
    await expect(runFileAnalysis(options)).rejects.toThrow('Configure Google credentials')
    expect(mocks.send).not.toHaveBeenCalled()
    mocks.keys.keys = { google_gemini: 'secret-key' }; await runFileAnalysis(options)
    expect(mocks.send.mock.calls[0][0]).toMatchObject({ provider: 'google', apiKey: 'secret-key' })
    expect(mocks.probe).not.toHaveBeenCalled()
  })
  it('waits for asynchronous source validation before reserving or sending and after preparing accounting', async () => {
    const options = input(), events: string[] = []
    options.validate = async () => { await Promise.resolve(); events.push('validate') }
    mocks.prepare.mockImplementation(async () => { events.push('prepare'); await Promise.resolve() })
    mocks.send.mockImplementation(async (sent: SendOptions) => { sent.beforeInvocation?.({}, 500, sent.contextSize!); await sent.beforeDispatch?.(); events.push('dispatch'); return 'Supported finding.' })
    await runFileAnalysis(options)
    const index = events.indexOf('prepare'); expect(events[index - 1]).toBe('validate'); expect(events[index + 1]).toBe('validate'); expect(events[index + 2]).toBe('dispatch')
  })
  it.each(['abort', 'scope'])('stops %s changes during accounting preparation and settles the original authority', async change => {
    const options = input(), controller = new AbortController(); let current = true
    options.signal = controller.signal; options.current = () => current
    mocks.prepare.mockImplementation(async () => { if (change === 'abort') controller.abort(); else current = false })
    await expect(runFileAnalysis(options)).rejects.toThrow()
    const trace: ContextTrace = mocks.record.mock.calls.at(-1)![0]
    expect(trace.state).toBe('uncertain'); expect(mocks.record).toHaveBeenLastCalledWith(trace, 'ollama', true, 'authority'); expect(mocks.end).toHaveBeenCalledWith('authority')
  })
  it('retains provider usage on a canceled response, releases its authority and never returns stale prose', async () => {
    const options = input(), controller = new AbortController(); options.signal = controller.signal
    mocks.send.mockImplementation(async (sent: SendOptions) => { sent.beforeInvocation?.({}, 500, sent.contextSize!); await sent.beforeDispatch?.(); controller.abort(); sent.onInvocationUsage?.({ invocation: 1, scope: 'invocation', attempt: 0, inputTokens: 497, outputTokens: 3 }); return 'STALE RESPONSE' })
    await expect(runFileAnalysis(options)).rejects.toThrow()
    const trace: ContextTrace = mocks.record.mock.calls.at(-1)![0]; expect(trace.state).toBe('uncertain'); expect(trace.usage?.[0].outputTokens).toBe(3); expect(mocks.end).toHaveBeenCalled()
  })
  it('rejects preexisting cancellation and stale-source failures without starting inference', async () => {
    const options = input(), controller = new AbortController(); controller.abort(); options.signal = controller.signal
    await expect(runFileAnalysis(options)).rejects.toThrow()
    const stale = input(); stale.validate = async () => { throw new Error('STALE_REFERENCE') }
    await expect(runFileAnalysis(stale)).rejects.toThrow('STALE_REFERENCE')
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled()
  })
})
