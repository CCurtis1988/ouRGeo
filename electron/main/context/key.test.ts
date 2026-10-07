import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { protectedMemoryKey } from './key'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const fixtureProtection = { encryptString: (value: string) => Buffer.from(`fixture:${value}`), decryptString: (value: Buffer) => value.toString().slice(8) }
function directory(): string { const value = mkdtempSync(join(tmpdir(), 'ourgeo-key-test-')); directories.push(value); return value }

it('refuses a missing protected key without writing a replacement over an existing store', async () => {
  const dir = directory(), original = Buffer.from('preserve this encrypted database')
  writeFileSync(join(dir, 'canonical.sqlite'), original)
  await expect(protectedMemoryKey(dir, fixtureProtection)).rejects.toThrow('no replacement key was created')
  expect(readdirSync(dir)).toEqual(['canonical.sqlite'])
  expect(readFileSync(join(dir, 'canonical.sqlite'))).toEqual(original)
})

it('preserves an invalid key for recovery instead of replacing it', async () => {
  const dir = directory(), original = fixtureProtection.encryptString(Buffer.from('too short').toString('base64'))
  writeFileSync(join(dir, 'key'), original)
  await expect(protectedMemoryKey(dir, fixtureProtection)).rejects.toThrow('key is invalid')
  expect(readFileSync(join(dir, 'key'))).toEqual(original)
})

it('reuses the same newly created key on subsequent launches', async () => {
  const dir = directory(), first = await protectedMemoryKey(dir, fixtureProtection)
  expect(first).toHaveLength(32)
  expect(await protectedMemoryKey(dir, fixtureProtection)).toEqual(first)
})
