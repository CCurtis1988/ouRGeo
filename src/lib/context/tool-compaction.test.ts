import { afterEach, describe, expect, it } from 'vitest'
import { compactToolResults, type ToolProtocol } from './tool-compaction'
import { boundedText, estimateTokens } from './budget'
import { ContextBroker } from './broker'
import { clearResultCache } from './result-cache'
import type { ContextIdentity } from './types'

const original = 'Observed 12.5 US survey feet. ' + 'large output '.repeat(500)
function receipt(text: string): string { return JSON.stringify({ status: 'compacted', excerpt: boundedText(text, 100).text, ref: 'ctx_original' }) }

describe('tool-loop compaction', () => {
  it.each(['openai', 'anthropic', 'google', 'responses'] as ToolProtocol[])('retains calls, exact user constraints and the pending batch for %s', protocol => {
    const result = (text: string, id: string) => protocol === 'openai' ? { role: 'tool', tool_call_id: id, content: text }
      : protocol === 'responses' ? { type: 'function_call_output', call_id: id, output: text }
        : protocol === 'anthropic' ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }
          : { role: 'user', parts: [{ functionResponse: { name: id, response: { output: text } } }] }
    const user = { role: 'user', content: 'Use exactly 12.5 US survey feet; keep the unresolved CRS question.' }
    const call = { role: 'assistant', tool_calls: [{ id: 'first', function: { name: 'read', arguments: '{"exact":12.5}' } }] }
    const pendingCall = { role: 'assistant', tool_calls: [{ id: 'pending' }] }
    const pending = result('Latest complete result.', 'pending')
    const messages = [user, call, result(original, 'first'), pendingCall, pending]
    const before = estimateTokens(messages)
    expect(compactToolResults(messages, protocol, 2000, () => messages, receipt)).toBe(1)
    expect(messages[0]).toBe(user)
    expect(messages[1]).toBe(call)
    expect(messages[3]).toBe(pendingCall)
    expect(messages[4]).toBe(pending)
    expect(JSON.stringify(messages)).toContain('ctx_original')
    expect(estimateTokens(messages)).toBeLessThan(before / 2)
    expect(compactToolResults(messages, protocol, 100, () => messages, receipt)).toBe(0)
  })
  it('preserves every result in a parallel pending call batch', () => {
    const messages = [{ role: 'assistant', tool_calls: [{ id: 'a' }, { id: 'b' }] }, { role: 'tool', tool_call_id: 'a', content: original }, { role: 'tool', tool_call_id: 'b', content: original }]
    expect(compactToolResults(messages, 'openai', 2000, () => messages, receipt)).toBe(0)
    expect(messages[1].content).toBe(original)
  })
})

describe('recoverable result isolation', () => {
  afterEach(() => clearResultCache())
  const identity: ContextIdentity = { chatId: 'one', projectId: 'saved', workspaceEpoch: 4, policyRevision: 3 }
  const broker = (scope = identity) => new ContextBroker({ identity: scope, effort: 'balanced', target: 'local', signal: new AbortController().signal, current: () => true, sources: () => [], excluded: () => [] })
  it('keeps the permitted original readable in a later turn in the same conversation', async () => {
    const archived = JSON.parse(broker().archiveResult(original, 'Earlier R result'))
    expect(archived.status).toBe('compacted')
    const next = JSON.parse(await broker().read({ ref: archived.ref }))
    expect(next.status).toBe('ok')
    expect(next.content).toContain('12.5 US survey feet')
    expect(next.content.length).toBeGreaterThan(archived.excerpt.length)
  })
  it('rejects old handles in another chat, workspace, project or permission revision', async () => {
    const archived = JSON.parse(broker().archiveResult(original, 'Private result'))
    for (const changed of [{ chatId: 'two' }, { projectId: 'other' }, { workspaceEpoch: 5 }, { policyRevision: 4 }]) {
      const result = JSON.parse(await broker({ ...identity, ...changed }).read({ ref: archived.ref }))
      expect(result).toEqual({ status: 'SOURCE_UNAVAILABLE' })
    }
    clearResultCache()
    expect(JSON.parse(await broker().read({ ref: archived.ref })).status).toBe('SOURCE_UNAVAILABLE')
  })
})
