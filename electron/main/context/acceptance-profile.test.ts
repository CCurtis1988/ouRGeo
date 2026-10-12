import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ app: { setPath: vi.fn() }, safeStorage: { isEncryptionAvailable: vi.fn() } }))
import { configureContextAcceptanceProfile } from './acceptance-profile'
const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
it('keeps an ordinary launch unchanged and refuses an existing unmarked profile', () => {
  const set = vi.fn(), directory = mkdtempSync(join(tmpdir(), 'ourgeo-context-profile-')); directories.push(directory)
  configureContextAcceptanceProfile(undefined, set)
  expect(set).not.toHaveBeenCalled()
  expect(() => configureContextAcceptanceProfile(directory, set)).toThrow()
  expect(() => configureContextAcceptanceProfile('relative-profile', set)).toThrow('absolute')
  expect(set).not.toHaveBeenCalled()
})
it('selects only a private synthetic profile with the exact acceptance marker', () => {
  const set = vi.fn(), directory = mkdtempSync(join(tmpdir(), 'ourgeo-context-profile-')); directories.push(directory)
  const marker = join(directory, '.context-acceptance')
  writeFileSync(marker, 'synthetic-context-profile-v1\n', { mode: 0o600 })
  configureContextAcceptanceProfile(directory, set)
  expect(set).toHaveBeenCalledWith('userData', directory)
  writeFileSync(marker, 'not a synthetic profile')
  expect(() => configureContextAcceptanceProfile(directory, set)).toThrow('unmarked')
})
