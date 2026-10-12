import { expect, it } from 'vitest'
import { MemoryStorage } from './storage'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('encrypts profile-local column policies across restart without sharing fork writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ourgeo-columns-')), path = join(dir, 'memory.sqlite'), key = randomBytes(32), project = randomUUID(), fork = randomUUID()
  try {
    let store = new MemoryStorage(path, Buffer.from(key))
    expect(store.columnPolicies(project)).toEqual({ revision: 0, selections: {} })
    store.saveColumnPolicies(project, { revision: 0, selections: { 'environment:private:roads': ['private_column_name'] } })
    store.forkColumnPolicies(project, fork)
    store.saveColumnPolicies(fork, { revision: 1, selections: {} })
    store.close()
    expect(readFileSync(path).includes(Buffer.from('private_column_name'))).toBe(false)
    store = new MemoryStorage(path, Buffer.from(key))
    expect(store.columnPolicies(project).selections).toEqual({ 'environment:private:roads': ['private_column_name'] })
    expect(store.columnPolicies(fork).selections).toEqual({})
    store.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('refuses racing revisions and invalid scope without changing committed exclusions', () => {
  const store = new MemoryStorage(':memory:', randomBytes(32)), project = randomUUID()
  store.saveColumnPolicies(project, { revision: 0, selections: { 'environment:x:roads': ['income'] } })
  expect(() => store.saveColumnPolicies(project, { revision: 0, selections: {} })).toThrow('changed')
  expect(() => store.saveColumnPolicies('scratch', { revision: 0, selections: {} })).toThrow('save this workspace')
  expect(() => store.forkColumnPolicies(project, project)).toThrow('already exist')
  expect(store.columnPolicies(project).selections).toEqual({ 'environment:x:roads': ['income'] })
  store.close()
})
