import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { protectedPolicyAbsent } from './policy-store'

const dirs: string[] = []
afterEach(async () => { for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true }) })
it('allows source discovery on a fresh profile without treating existing protected files as an empty policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-policy-absence-')); dirs.push(directory)
  const context = join(directory, 'context')
  expect(await protectedPolicyAbsent(context)).toBe(true)
  await mkdir(context)
  expect(await protectedPolicyAbsent(context)).toBe(true)
  await writeFile(join(context, 'canonical.sqlite-wal'), 'unreadable encrypted policy')
  expect(await protectedPolicyAbsent(context)).toBe(false)
  await rm(join(context, 'canonical.sqlite-wal'))
  await writeFile(join(context, 'key'), 'unreadable key')
  expect(await protectedPolicyAbsent(context)).toBe(false)
  // A failed directory read also fails closed, rather than being caught as
  // ordinary absence. ENOTDIR is portable even when tests run as root.
  await expect(protectedPolicyAbsent(join(context, 'key', 'child'))).rejects.toThrow()
})
