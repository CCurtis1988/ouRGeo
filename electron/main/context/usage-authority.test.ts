import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { UsageAuthority } from './usage-authority'
import type { InferenceUsageInput } from '../../../src/lib/context/inference-usage'

const input = (): InferenceUsageInput => ({ chatId: randomUUID(), turnId: randomUUID(), provider: 'openai', invocation: 1, attempt: 0, accountingScope: 'invocation', delivery: 'sent', final: false })
it('settles cancelled turns in the original project after switching and refuses other turn identities', () => {
  const authority = new UsageAuthority(), receipt = input()
  const lease = { id: randomUUID(), projectId: randomUUID() }
  const token = authority.begin(lease, lease.id, receipt.chatId, receipt.turnId, receipt.provider)
  lease.id = randomUUID()
  const original = lease.projectId
  lease.projectId = randomUUID()
  expect(authority.scope(token, [{ ...receipt, delivery: 'uncertain', final: true }])).toBe(`project:${original}`)
  for (const change of [{ chatId: randomUUID() }, { turnId: randomUUID() }, { provider: 'ollama' as const }]) {
    expect(() => authority.scope(token, [{ ...receipt, ...change }])).toThrow('another turn')
  }
  expect(() => authority.begin(lease, 'old-lease', receipt.chatId, receipt.turnId, receipt.provider)).toThrow('SCOPE_CHANGED')
  expect(() => authority.scope(token, [{ ...receipt, content: 'private' } as InferenceUsageInput])).toThrow('excerpts')
})
it('keeps scratch accounting global across saving and rejects expired or released authority', () => {
  let now = 0
  const authority = new UsageAuthority(() => now), receipt = input(), lease = { id: randomUUID(), projectId: null }
  const begin = () => authority.begin(lease, lease.id, receipt.chatId, receipt.turnId, receipt.provider)
  const token = begin()
  expect(authority.scope(token, [receipt])).toBe('global')
  now = 86_400_000
  expect(() => authority.scope(token, [receipt])).toThrow('expired')
  const next = begin()
  authority.end(next)
  expect(() => authority.scope(next, [receipt])).toThrow('expired')
})
it('bounds unfinished grants without evicting authorised active turns and frees settled capacity', () => {
  const authority = new UsageAuthority(), receipt = input(), lease = { id: randomUUID(), projectId: null }
  const begin = () => authority.begin(lease, lease.id, receipt.chatId, receipt.turnId, receipt.provider)
  const tokens = Array.from({ length: 256 }, begin)
  expect(() => begin()).toThrow('busy')
  expect(authority.scope(tokens[0], [receipt])).toBe('global')
  expect(() => authority.scope(tokens[0], Array.from({ length: 65 }, () => receipt))).toThrow('bounded')
  authority.end(tokens[0])
  expect(begin()).toBeTypeOf('string')
})
