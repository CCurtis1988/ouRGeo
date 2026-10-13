import { expect, it } from 'vitest'
import { ConsoleIndex, type ConsoleEvent } from './console-index'

const event = (id: string, type: string, text: string): ConsoleEvent => ({ id, type, text, timestamp: 0 })

it('indexes appended failures with their exact command and keeps unrelated descriptors stable', async () => {
  const index = new ConsoleIndex()
  const first = [event('run', 'input', 'mean(roads$income)'), event('error', 'error', 'object income not found')]
  const original = index.update(first, 'epoch:1')
  expect(index.update(first, 'epoch:1')).toBe(original)
  const nextEvents = [...first, event('next', 'input', 'nrow(roads)')]
  const next = index.update(nextEvents, 'epoch:1')
  expect(next[1]).toBe(original[0])
  expect(await next[1].read()).toBe('Historical console execution at 1970-01-01T00:00:00.000Z. This records what happened then; it does not establish current object contents or schema.\n\nCommand:\nmean(roads$income)\n\nEvents (in order):\nerror: object income not found')
  const appended = index.update([...nextEvents, event('output', 'output', '[1] 4102')], 'epoch:1')
  expect(appended[0].revision).not.toBe(next[0].revision)
  expect(await next[0].read()).not.toContain('4102')
  expect(await appended[0].read()).toContain('[1] 4102')
})

it('ignores retrieval audits and invalidates revisions on clear, replacement or R/workspace change', async () => {
  const index = new ConsoleIndex()
  const first = [event('run', 'input', 'stop("actual error")'), event('failure', 'error', 'actual error')]
  const original = index.update(first, 'epoch:1')
  const audited = [...first, event('audit', 'info', 'AI: searched console')]
  expect(index.update(audited, 'epoch:1')).toBe(original)
  const replacement = [first[0], event('failure', 'error', 'corrected error'), audited[2]]
  const replaced = index.update(replacement, 'epoch:1')
  expect(replaced[0].summary).toBe('corrected error')
  expect(replaced[0].revision).not.toBe(original[0].revision)
  const restarted = index.update(replacement, 'epoch:2')
  expect(restarted[0].revision).not.toBe(replaced[0].revision)
  expect(index.update([], 'epoch:2')).toEqual([])
  expect(index.update(first, 'epoch:2')[0].revision).not.toBe(original[0].revision)
})

it('keeps standalone failures and warning order discoverable without requiring a preceding input', async () => {
  const index = new ConsoleIndex()
  const sources = index.update([event('warning', 'warning', 'first'), event('error', 'error', 'exact failure'), event('output', 'output', 'after failure')], 'epoch:1')
  expect(sources).toHaveLength(1)
  expect(await sources[0].read()).toBe('Historical console execution at 1970-01-01T00:00:00.000Z. This records what happened then; it does not establish current object contents or schema.\n\nCommand:\n(command unavailable)\n\nEvents (in order):\nwarning: first\nerror: exact failure\noutput: after failure')
})


it('attributes an earlier failure to its execution time after a later command repairs the object', async () => {
  const index = new ConsoleIndex()
  const earlier = { id: 'failed', type: 'input', text: 'left_join(parcels, owners, by = "parcel_id")', timestamp: Date.parse('2026-10-01T12:00:00Z') }
  const sources = index.update([earlier, event('failure', 'error', 'Problem with parcel_id'), event('repair', 'input', 'parcels$parcel_id <- seq_len(nrow(parcels))')], 'same-runtime')
  const prior = await sources[1].read()
  expect(prior).toContain('Historical console execution at 2026-10-01T12:00:00.000Z')
  expect(prior).toContain('does not establish current object contents or schema')
  expect(prior).toContain(earlier.text)
  expect(prior).not.toContain('parcels$parcel_id <-')
})
