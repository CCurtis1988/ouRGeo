import { afterEach, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStorage } from './storage'
import type { MaintenanceReservation } from '../../../src/lib/context/providers/maintenance'
import type { ProviderResult } from '../../../src/lib/context/providers/types'

const stores: MemoryStorage[] = [], directories: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const now = Date.parse('2026-10-07T12:00:00Z')
function fixture(path = ':memory:', key = randomBytes(32)) {
  const store = new MemoryStorage(path, Buffer.from(key)); stores.push(store)
  const ledger = store.maintenance()
  const enable = () => ledger.configure({ revision: ledger.policy().revision + 1, currency: 'USD', mode: 'estimated', enabled: true, dailyMicros: 1000000, monthlyMicros: 2000000 })
  const reservation = (estimateMicros = 600000): MaintenanceReservation => ({ id: crypto.randomUUID(), scope: 'global', connectionId: crypto.randomUUID(), policyRevision: ledger.policy().revision, purpose: 'ingestion', estimateMicros, boundedOperation: true })
  const receipt = (id: string, cost?: number, estimated = false): Exclude<ProviderResult, { status: 'failed' }> => ({ operationId: id, status: 'ok', complete: true, records: [], usage: { ...(cost === undefined ? {} : { cost, currency: 'USD' as const }), estimated } })
  return { store, ledger, enable, reservation, receipt }
}

it('keeps paid maintenance off by default and refuses unbounded or zero-estimate work', () => {
  const { ledger, enable, reservation } = fixture()
  expect(ledger.policy()).toMatchObject({ enabled: false, mode: 'estimated' })
  expect(() => ledger.reserve(reservation(), now)).toThrow('off')
  enable()
  expect(() => ledger.reserve({ ...reservation(), boundedOperation: false } as unknown as MaintenanceReservation, now)).toThrow('bounded')
  expect(() => ledger.reserve(reservation(0), now)).toThrow('non-zero')
  expect(ledger.summary(now).unresolvedOperations).toBe(0)
})

it('reserves transactionally and does not count the same operation twice', () => {
  const { ledger, enable, reservation } = fixture(); enable()
  const request = reservation()
  const first = ledger.reserve(request, now)
  expect(ledger.reserve(request, now)).toEqual(first)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 600000, unresolvedOperations: 1 })
  expect(() => ledger.reserve(reservation(), now)).toThrow('budget is covered')
  expect(() => ledger.reserve({ ...request, scope: `project:${crypto.randomUUID()}` }, now)).toThrow('different operation')
})

it('rechecks consent before dispatch and never retries an uncertain paid operation blindly', () => {
  const { ledger, enable, reservation } = fixture(); enable()
  const request = reservation(); ledger.reserve(request, now)
  ledger.configure({ ...ledger.policy(), revision: 2, enabled: false })
  expect(() => ledger.markDispatched(request.id, now)).toThrow('policy')
  ledger.settle(request.id, undefined, false)
  expect(ledger.summary(now).outstandingMicros).toBe(0)
  enable()
  const next = reservation(); ledger.reserve(next, now); ledger.markDispatched(next.id, now)
  ledger.settle(next.id, undefined, true)
  expect(() => ledger.markDispatched(next.id, now)).toThrow('receipt')
})

it('keeps cancelled, missing and failed usage pending until an actual late receipt arrives', () => {
  const { ledger, enable, reservation, receipt } = fixture(); enable()
  const request = reservation(); ledger.reserve(request, now); ledger.markDispatched(request.id, now)
  ledger.settle(request.id, undefined, true)
  ledger.settle(request.id, { operationId: request.id, status: 'failed', code: 'PROVIDER_OFFLINE', recovery: 'Review the receipt.' }, true)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 600000, dailySpentMicros: 0 })
  ledger.settle(request.id, receipt(request.id, .25), true)
  ledger.settle(request.id, receipt(request.id, .25), true)
  ledger.settle(request.id, undefined, true)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 0, dailySpentMicros: 250000, unresolvedOperations: 0 })
})

it('never converts estimated, invalid or absent costs into confirmed zero spend', () => {
  const { ledger, enable, reservation, receipt } = fixture(); enable()
  const request = reservation(); ledger.reserve(request, now); ledger.markDispatched(request.id, now)
  for (const cost of [undefined, Infinity, -1]) ledger.settle(request.id, receipt(request.id, cost), true)
  ledger.settle(request.id, receipt(request.id, .8, true), true)
  ledger.settle(request.id, undefined, false)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 800000, dailySpentMicros: 0 })
  ledger.settle(request.id, receipt(request.id, 0), true)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 0, dailySpentMicros: 0, unresolvedOperations: 0 })
})

it('retains headroom for incomplete processing even when an interim receipt reports a lower charge', () => {
  const { ledger, enable, reservation, receipt } = fixture(); enable()
  const request = reservation(); ledger.reserve(request, now); ledger.markDispatched(request.id, now)
  const interim = { ...receipt(request.id, .8), status: 'pending' as const, complete: false }
  ledger.settle(request.id, interim, true)
  ledger.settle(request.id, { ...interim, usage: { cost: .1, currency: 'USD', estimated: false } }, true)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 800000, dailySpentMicros: 0 })
  ledger.settle(request.id, receipt(request.id, .35), true)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 0, dailySpentMicros: 350000 })
})

it('keeps a charge unknown when the provider omits its currency instead of assuming USD', () => {
  const { ledger, enable, reservation, receipt } = fixture(); enable()
  const request = reservation(); ledger.reserve(request, now); ledger.markDispatched(request.id, now)
  const result = receipt(request.id, .1)
  delete result.usage.currency
  ledger.settle(request.id, result, true)
  expect(ledger.summary(now)).toMatchObject({ outstandingMicros: 600000, dailySpentMicros: 0 })
})

it('carries unresolved charges across day and month changes and attributes late actual usage to dispatch', () => {
  const { ledger, enable, reservation, receipt } = fixture(); enable()
  const request = reservation(); ledger.reserve(request, now); ledger.markDispatched(request.id, now)
  const nextMonth = Date.parse('2026-11-01T00:00:00Z')
  expect(ledger.summary(nextMonth).outstandingMicros).toBe(600000)
  expect(() => ledger.reserve(reservation(), nextMonth)).toThrow('budget is covered')
  ledger.settle(request.id, receipt(request.id, .4), true)
  expect(ledger.summary(nextMonth)).toMatchObject({ outstandingMicros: 0, dailySpentMicros: 0, monthlySpentMicros: 0 })
  expect(ledger.summary(now).dailySpentMicros).toBe(400000)
})

it('stops additional scheduling when actual receipts exceed estimates and refuses conflicting final charges', () => {
  const { ledger, enable, reservation, receipt } = fixture(); enable()
  const request = reservation(); ledger.reserve(request, now); ledger.markDispatched(request.id, now)
  ledger.settle(request.id, receipt(request.id, 1.2), true)
  expect(ledger.summary(now).exceeded).toBe(true)
  expect(() => ledger.reserve(reservation(1), now)).toThrow('budget is covered')
  expect(() => ledger.settle(request.id, receipt(request.id, .1), true)).toThrow('Conflicting')
  expect(ledger.summary(now).dailySpentMicros).toBe(1200000)
})

it('preserves encrypted reservations and unknown charges across restart and serialises competing writers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ourgeo-maintenance-')); directories.push(directory)
  const path = join(directory, 'canonical.sqlite'), key = randomBytes(32)
  const first = fixture(path, key); first.enable()
  const request = first.reservation(); first.ledger.reserve(request, now); first.ledger.markDispatched(request.id, now)
  const second = fixture(path, key)
  expect(() => second.ledger.reserve(second.reservation(), now)).toThrow('budget is covered')
  second.ledger.settle(request.id, undefined, true)
  const reopened = fixture(path, key)
  expect(reopened.ledger.summary(now).outstandingMicros).toBe(600000)
  for (const suffix of ['', '-wal']) expect(readFileSync(path + suffix).includes(Buffer.from(request.connectionId))).toBe(false)
})
