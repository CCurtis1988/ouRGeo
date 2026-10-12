import { expect, it } from 'vitest'
import { contextOverflow, reduceOverflowMessages } from './overflow'
import { estimateTokens } from './budget'
import type { ToolProtocol } from './tool-compaction'

it('recognises rejected context sizes without retrying authentication, rate limits or upload limits', () => {
  expect(contextOverflow(400, '{"error":{"code":"context_length_exceeded"}}')).toBe(true)
  expect(contextOverflow(400, '{"error":{"message":"prompt is too long: 33000 tokens"}}')).toBe(true)
  expect(contextOverflow(422, '{"error":"input exceeds maximum context length"}')).toBe(true)
  for (const status of [401, 403, 429, 500]) expect(contextOverflow(status, '{"error":{"code":"context_length_exceeded"}}')).toBe(false)
  expect(contextOverflow(413, 'Uploaded file exceeds maximum size')).toBe(false)
  expect(contextOverflow(400, '{"error":{"message":"tool arguments are invalid"}}')).toBe(false)
})

it.each(['openai', 'anthropic', 'google', 'responses'] as ToolProtocol[])('reduces older prose while preserving exact user text, newest reply and complete exchanges for %s', protocol => {
  const text = 'Earlier optional assistant reply. '.repeat(200)
  const old = protocol === 'google' ? { role: 'model', parts: [{ text }] } : { role: 'assistant', content: text }
  const latest = protocol === 'google' ? { role: 'model', parts: [{ text: 'Latest task state.' }] } : { role: 'assistant', content: 'Latest task state.' }
  const user = { role: 'user', content: 'Use exactly 12.5 US survey feet. Never overwrite [roads].' }
  const call = protocol === 'responses' ? { type: 'function_call', call_id: 'c1', name: 'read', arguments: '{"name":"roads"}' }
    : protocol === 'google' ? { role: 'model', parts: [{ functionCall: { name: 'read', args: { name: 'roads' } } }] }
      : protocol === 'anthropic' ? { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read', input: { name: 'roads' } }] }
        : { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{"name":"roads"}' } }] }
  const result = protocol === 'responses' ? { type: 'function_call_output', call_id: 'c1', output: 'Authoritative source.' }
    : protocol === 'google' ? { role: 'user', parts: [{ functionResponse: { name: 'read', response: { output: 'Authoritative source.' } } }] }
      : protocol === 'anthropic' ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Authoritative source.' }] }
        : { role: 'tool', tool_call_id: 'c1', content: 'Authoritative source.' }
  const messages = [user, old, latest, call, result]
  const payload = () => ({ messages, system: 'Essential rules.', tools: [{ name: 'read' }] })
  const before = estimateTokens(payload())
  expect(reduceOverflowMessages(messages, protocol, payload)).toBe(true)
  expect(estimateTokens(payload())).toBeLessThan(before)
  for (const value of [user, latest, call, result]) expect(messages).toContain(value)
  expect(messages).not.toContain(old)
  expect(messages[0]).toBe(user)
  expect(JSON.stringify(messages)).toContain('omitted replies are searchable')
})

it('restores the exact order when a reduction plus its receipt would enlarge the request', () => {
  const messages = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'second' }, { role: 'assistant', content: 'b' }, { role: 'assistant', content: 'latest' }]
  const original = [...messages]
  expect(reduceOverflowMessages(messages, 'openai', () => messages)).toBe(false)
  expect(messages).toEqual(original)
})

it('never cuts original instructions or drops reasoning and working-state cards to force a fit', () => {
  const messages = [{ role: 'user', content: 'Essential original instruction. '.repeat(1000) }, { type: 'reasoning', encrypted_content: 'opaque' }, { role: 'assistant', content: 'Derived conversation working state ' + 'critical 12.5 feet '.repeat(100) }, { role: 'assistant', content: 'latest' }]
  const before = JSON.stringify(messages)
  expect(reduceOverflowMessages(messages, 'responses', () => messages)).toBe(false)
  expect(JSON.stringify(messages)).toBe(before)
})
