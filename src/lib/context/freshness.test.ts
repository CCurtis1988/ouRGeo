import { afterEach, expect, it, vi } from 'vitest'
import { ContextBroker, type BrokerHost } from './broker'
import type { ContextSource } from './types'
import { clearResultCache } from './result-cache'
import { checkInvocation, type SendOptions } from '@/lib/ai-client'
import { estimateTokens } from './budget'

afterEach(() => clearResultCache())
function fixture() {
  const source: ContextSource = { id: 'environment:global:roads', kind: 'environment', scope: 'workspace', title: 'roads', summary: 'roads schema', revision: 'r1', trust: 'observed', read: () => JSON.stringify({ observation: 'current schema only', columns: ['income'] }) }
  const state = { sources: [source], excluded: [] as string[] }
  const host: BrokerHost = { identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 0 }, target: 'local/test', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: () => state.sources, excluded: () => state.excluded }
  return { broker: new ContextBroker(host), state, source }
}
async function evidence(broker: ContextBroker): Promise<string> {
  const ref = JSON.parse(broker.search({ query: 'roads', kinds: ['environment'] })).results[0].ref
  return broker.read({ ref })
}

it('refuses a prepared schema changed before its first disclosure even when object dimensions match', async () => {
  const { broker, state, source } = fixture()
  const text = await evidence(broker)
  state.sources = [{ ...source, revision: 'r2' }]
  expect(() => broker.prepareInvocation({ messages: [{ role: 'user', content: text }] })).toThrow('STALE_REFERENCE')
  expect(broker.trace.invocations).toEqual([])
})

it('labels previously delivered schema as historical after R execution while preserving a complete tool exchange', async () => {
  const { broker, state, source } = fixture()
  const text = await evidence(broker)
  const messages = [{ role: 'user', content: text }]
  broker.recordInvocation(estimateTokens(messages), 32000, { messages })
  state.sources = [{ ...source, revision: 'r2' }]
  expect(() => broker.validateSend()).not.toThrow()
  const result = broker.storeResult('Authorised current computation: 42', 'R execution result')
  const payload = { messages: [...messages, { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'execute_r', arguments: JSON.stringify({ code: `print("${broker.trace.selected[0].ref}")` }) } }] }, { role: 'tool', tool_call_id: 'call_1', content: result }] }
  const originalCalls = JSON.stringify(payload.messages[1])
  broker.prepareInvocation(payload)
  expect(payload.messages[0].content).toContain('Host freshness notice')
  expect(payload.messages[0].content).toContain('are historical')
  expect(payload.messages[0].content).toContain(text)
  expect(JSON.stringify(payload.messages[1])).toBe(originalCalls)
  expect('tool_call_id' in payload.messages[2] && payload.messages[2].tool_call_id).toBe('call_1')
  expect(() => broker.recordInvocation(estimateTokens(payload), 32000, payload)).not.toThrow()
  const once = JSON.stringify(payload)
  broker.prepareInvocation(payload)
  expect(JSON.stringify(payload)).toBe(once)
})

it('keeps signatures, private reasoning, executable arguments and tool schemas intact during historical annotation', async () => {
  const { broker, state, source } = fixture(), text = await evidence(broker)
  broker.recordInvocation(1000, 32000, { content: text })
  state.sources = [{ ...source, revision: 'r2' }]
  const payload = { messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'thinking', thinking: text, signature: text }, { type: 'tool_use', id: 'call', name: 'execute_r', input: { content: text } }] }], tools: [{ description: text }] }
  const protectedBlocks = JSON.stringify(payload.messages[0].content.slice(1)), tools = JSON.stringify(payload.tools)
  broker.prepareInvocation(payload)
  expect(payload.messages[0].content[0].text).toContain('are historical')
  expect(JSON.stringify(payload.messages[0].content.slice(1))).toBe(protectedBlocks)
  expect(JSON.stringify(payload.tools)).toBe(tools)
})

it('still refuses source exclusion or removal after delivery and refuses a new invocation without the correction', async () => {
  const { broker, state, source } = fixture(), text = await evidence(broker)
  broker.recordInvocation(1000, 32000, { content: text })
  state.sources = [{ ...source, revision: 'r2' }]
  expect(() => broker.recordInvocation(1000, 32000, { content: text })).toThrow('host freshness notice')
  state.excluded = [source.id]
  expect(() => broker.validateSend()).toThrow('STALE_REFERENCE')
  state.excluded = []; state.sources = []
  expect(() => broker.validateSend()).toThrow('STALE_REFERENCE')
})

it('budgets the actual host correction before recording an invocation, including compacted text without an old handle', async () => {
  const { broker, state, source } = fixture(), text = await evidence(broker)
  broker.recordInvocation(1000, 32000, { content: text })
  state.sources = [{ ...source, revision: 'r2' }]
  const payload = { messages: [{ role: 'tool', tool_call_id: 'call', content: 'Completed computation: 42' }] }
  const before = estimateTokens(payload), recorded = vi.fn()
  const options: SendOptions = { model: 'fixture', provider: 'ollama', apiKey: '', messages: [], systemPrompt: '', onChunk: () => undefined, contextSize: 32000, maxOutputTokens: 4000, prepareInvocation: value => broker.prepareInvocation(value), beforeInvocation: recorded }
  checkInvocation(options, payload)
  expect(payload.messages[0].content).toContain('are historical')
  expect(recorded.mock.calls[0][1]).toBe(estimateTokens(payload))
  expect(recorded.mock.calls[0][1]).toBeGreaterThan(before)
})
