import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, copyFile, rename, link, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { duplicateProjectLocation } from './project-location'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

it('distinguishes a copied bundle from a move and aliases of the same file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-project-identity-')); directories.push(directory)
  const original = join(directory, 'original.ourgeoproj'), copy = join(directory, 'copy.ourgeoproj')
  await writeFile(original, 'synthetic bundle')
  await copyFile(original, copy)
  expect(await duplicateProjectLocation(original, copy)).toBe(true)
  const moved = join(directory, 'moved.ourgeoproj')
  await rename(copy, moved)
  expect(await duplicateProjectLocation(copy, moved)).toBe(false)
  const hardlink = join(directory, 'hardlink.ourgeoproj'), symbolic = join(directory, 'symbolic.ourgeoproj')
  await link(original, hardlink)
  await symlink(original, symbolic)
  expect(await duplicateProjectLocation(original, hardlink)).toBe(false)
  expect(await duplicateProjectLocation(original, symbolic)).toBe(false)
})
