import { describe, it, expect } from 'vitest'
import {
  planExtraction, readArchiveId, safeEntryPath, isDotPath,
  MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_BYTES, type ArchiveEntry,
} from './archive-policy'

// What a plugin archive may contain.
//
// Every case here was a hole before the policy existed, and the first one is
// the reason the module exists at all: `plugins:pack` walked dotfiles into the
// archive, `plugins:unpack` restored them, and the loader runs a cached bundle
// under `.build/<key>.js` WITHOUT compiling when the key matches — a key it
// derives from only the files `plugins:listFiles` reports, which skips
// dotfiles. So an archive could ship readable sources and unrelated code, and
// the code that ran was never the code anyone read.

const file = (name: string, size = 10): ArchiveEntry => ({ name, size, isDirectory: false })
const manifest = file('ourgeo-plugin.json', 40)

describe('planExtraction', () => {
  it('drops a compile-cache entry so the archive cannot decide what runs', () => {
    const plan = planExtraction([manifest, file('main.ts'), file('.build/abc123.js')])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.entries.map((e) => e.path)).toEqual(['ourgeo-plugin.json', 'main.ts'])
  })

  it('drops a store-origin sidecar, so an archive cannot claim to be from the store', () => {
    const plan = planExtraction([manifest, file('.ourgeo-store.json')])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.entries.map((e) => e.path)).toEqual(['ourgeo-plugin.json'])
  })

  it('refuses a path that climbs out of the plugin folder', () => {
    const plan = planExtraction([manifest, file('../../evil.js')])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('unsafe path')
  })

  it('keeps a file whose name merely contains two dots', () => {
    // The guard this replaced was `entryName.includes('..')`, which refused
    // this and accepted an absolute path — wrong in both directions.
    const plan = planExtraction([manifest, file('lib/a..b.ts')])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.entries.map((e) => e.path)).toContain('lib/a..b.ts')
  })

  it('refuses an absolute entry path', () => {
    expect(planExtraction([manifest, file('/etc/passwd')]).ok).toBe(false)
    expect(planExtraction([manifest, file('C:\\Windows\\evil.dll')]).ok).toBe(false)
  })

  it('refuses an archive with no manifest at its top level', () => {
    const plan = planExtraction([file('nested/ourgeo-plugin.json'), file('main.ts')])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('not an ouRGeo plugin')
  })

  it('caps the file count, and says what that suggests', () => {
    const many = Array.from({ length: MAX_ARCHIVE_ENTRIES + 2 }, (_, i) => file(`f${i}.ts`, 1))
    const plan = planExtraction([manifest, ...many])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('right file')
  })

  it('caps the total unpacked size', () => {
    const plan = planExtraction([manifest, file('big.bin', MAX_ARCHIVE_BYTES + 1)])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('MB')
  })

  it('ignores directory entries rather than writing them', () => {
    const plan = planExtraction([
      manifest,
      { name: 'r/', size: 0, isDirectory: true },
      file('r/helpers.R'),
    ])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.entries.map((e) => e.path)).toEqual(['ourgeo-plugin.json', 'r/helpers.R'])
  })

  it('normalises Windows separators to the path the loader will ask for', () => {
    const plan = planExtraction([manifest, file('lib\\util.ts')])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.entries.map((e) => e.path)).toContain('lib/util.ts')
    // The archive's own name is kept, because that is the key to read it back.
    expect(plan.entries.map((e) => e.name)).toContain('lib\\util.ts')
  })
})

describe('safeEntryPath', () => {
  it('collapses an inner .. that stays inside', () => {
    expect(safeEntryPath('lib/../main.ts')).toBe('main.ts')
  })
  it('refuses one that does not', () => {
    expect(safeEntryPath('lib/../../main.ts')).toBeNull()
  })
  it('refuses a path that is nothing at all', () => {
    expect(safeEntryPath('./')).toBeNull()
  })
})

describe('isDotPath', () => {
  it('is true for a dot segment anywhere, not just the first', () => {
    expect(isDotPath('.build/a.js')).toBe(true)
    expect(isDotPath('lib/.secret/a.js')).toBe(true)
    expect(isDotPath('lib\\.secret\\a.js')).toBe(true)
    expect(isDotPath('lib/a.js')).toBe(false)
  })
})

describe('readArchiveId', () => {
  it('reads a valid id', () => {
    expect(readArchiveId('{"id":"tide-tools"}')).toEqual({ id: 'tide-tools' })
  })

  it('refuses an id that would traverse, because the id becomes a folder name', () => {
    const r = readArchiveId('{"id":"../../etc"}')
    expect('error' in r).toBe(true)
  })

  it('names the rule rather than shrugging', () => {
    const r = readArchiveId('{"id":"Tide Tools"}')
    if (!('error' in r)) throw new Error('expected a refusal')
    expect(r.error).toContain('lowercase letters, digits and hyphens')
  })

  it('says the manifest is the problem when it will not parse', () => {
    const r = readArchiveId('{ not json')
    if (!('error' in r)) throw new Error('expected a refusal')
    expect(r.error).toContain('ourgeo-plugin.json')
  })
})
