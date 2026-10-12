import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { MemoryStorage } from './storage'
import type { InferenceUsageInput } from '../../../src/lib/context/inference-usage'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ourgeo-inference-ledger-')); directories.push(directory)
  const path = join(directory, 'canonical.sqlite'), key = randomBytes(32), store = new MemoryStorage(path, Buffer.from(key))
  const input: InferenceUsageInput = { chatId: randomUUID(), turnId: randomUUID(), invocation: 1, attempt: 0, accountingScope: 'invocation', provider: 'openai', estimatedInputTokens: 100,
    reported: { inputTokens: 90, outputTokens: 30, cachedInputTokens: 10 }, delivery: 'acknowledged', final: true }
  return { directory, path, key, store, input }
}
it('keeps idempotent encrypted usage after transcripts are gone and survives a worker store restart', () => {
  const { directory, path, key, store, input } = fixture()
  const receipt = store.recordInferenceUsage(input, 'global')
  expect(store.recordInferenceUsage(input, 'global').id).toBe(receipt.id)
  expect(store.inferenceUsageSummary('global').receipts).toBe(1)
  for (const file of readdirSync(directory)) if (/sqlite(?:-wal)?$/u.test(file)) {
    expect(readFileSync(join(directory, file)).includes(Buffer.from(input.chatId))).toBe(false)
    expect(readFileSync(join(directory, file)).includes(Buffer.from('openai'))).toBe(false)
  }
  store.close()
  const restarted = new MemoryStorage(path, Buffer.from(key))
  try {
    expect(restarted.inferenceUsageSummary('global', input.chatId).reportedTotalTokens).toBe(120)
    expect(restarted.inferenceUsagePage('global').receipts[0].id).toBe(receipt.id)
  } finally { restarted.close() }
})
it('filters projects and chats before decoding pages and does not mix identical invocation aliases across scopes', () => {
  const { store, input } = fixture(), scope = `project:${randomUUID()}` as const
  try {
    const global = store.recordInferenceUsage(input, 'global')
    const project = store.recordInferenceUsage(input, scope)
    store.recordInferenceUsage({ ...input, chatId: randomUUID() }, scope)
    expect(global.id).not.toBe(project.id)
    expect(store.inferenceUsageSummary('global').receipts).toBe(1)
    expect(store.inferenceUsageSummary(scope).receipts).toBe(2)
    expect(store.inferenceUsageSummary(scope, input.chatId).receipts).toBe(1)
    expect(store.inferenceUsageSummary(`project:${randomUUID()}`).receipts).toBe(0)
    const page = store.inferenceUsagePage(scope, undefined, '', 1)
    expect(page.next).not.toBeNull()
    expect(store.inferenceUsagePage(scope, undefined, page.next!, 1).receipts).toHaveLength(1)
    expect(() => store.inferenceUsagePage(scope, undefined, '', 0)).toThrow('between 1 and 100')
  } finally { store.close() }
})
it('preserves the original receipt transactionally on conflicting final counters', () => {
  const { store, input } = fixture()
  try {
    store.recordInferenceUsage(input, 'global')
    expect(() => store.recordInferenceUsage({ ...input, reported: { inputTokens: 999 } }, 'global')).toThrow('final usage')
    expect(store.inferenceUsageSummary('global').reportedInputTokens).toBe(90)
  } finally { store.close() }
})
