import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { readAboutYouFile, sealAboutYou } from './memory-transfer'
import { MemoryStorage } from './storage'
import { aboutYouExport, plainAboutYouFile } from '../../../src/lib/context/memory-transfer'
import type { MemoryRecord } from '../../../src/lib/context/types'

const at = new Date().toISOString()
const memory = (statement: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement, evidence: [], assertion: 'user-declared', createdAt: at, updatedAt: at, status: 'active', supersedes: [], ...extra })
// The shipped cost is ~128 MiB per derivation; tests use the minimum the reader accepts.
const fast = { N: 2 ** 14, r: 8, p: 1 }

describe('passphrase-sealed About you file', () => {
  it('opens on another machine with only the passphrase, and never contains the statements in the clear', async () => {
    const payload = aboutYouExport([memory('Prefer metric units for distances.')])
    const text = await sealAboutYou(payload, 'correct horse battery', fast)
    expect(text).not.toContain('metric')
    expect(JSON.parse(text)).toMatchObject({ format: 'ourgeo-memory-backup', version: 1, cipher: 'aes-256-gcm', kdf: { name: 'scrypt' } })
    expect(await readAboutYouFile(text, 'correct horse battery')).toEqual({ payload, protection: 'passphrase' })
  })
  it('refuses a wrong passphrase and an export whose key-cost header was edited down', async () => {
    const text = await sealAboutYou(aboutYouExport([memory('Answer briefly.')]), 'correct horse battery', fast)
    await expect((async (t: string, pw: string) => (await readAboutYouFile(t, pw)).payload)(text, 'wrong horse battery')).rejects.toThrow('Wrong passphrase')
    const edited = JSON.parse(text); edited.kdf.r = 4
    await expect((async (t: string, pw: string) => (await readAboutYouFile(t, pw)).payload)(JSON.stringify(edited), 'correct horse battery')).rejects.toThrow('Wrong passphrase')
  })
  it('refuses short passphrases and a file asking for an unbounded key cost', async () => {
    await expect(sealAboutYou(aboutYouExport([]), 'short', fast)).rejects.toThrow('at least 8')
    const text = JSON.parse(await sealAboutYou(aboutYouExport([]), 'correct horse battery', fast)); text.kdf.N = 2 ** 24
    await expect((async (t: string, pw: string) => (await readAboutYouFile(t, pw)).payload)(JSON.stringify(text), 'correct horse battery')).rejects.toThrow('damaged')
  })
})

describe('plain About you file', () => {
  it('reads without a passphrase, carries its readme, and a sealed file still asks for one', async () => {
    const payload = aboutYouExport([memory('Prefer metric units.')])
    const text = plainAboutYouFile(payload)
    expect(JSON.parse(text)._readme.join(' ')).toContain('NOT encrypted')
    expect(await readAboutYouFile(text, '')).toEqual({ payload, protection: 'none' })
    await expect(readAboutYouFile(await sealAboutYou(payload, 'correct horse battery', fast), '')).rejects.toThrow('Enter its passphrase')
  })
  it('accepts an expert edit in ouRGeo’s format and names the entry and field when an edit breaks it', async () => {
    const file = JSON.parse(plainAboutYouFile(aboutYouExport([memory('Prefer metric units.'), memory('Answer briefly.')])))
    file.memories[0].statement = 'Prefer metric units, kilometres for distance.'
    file.memories.push({ ...file.memories[1], id: crypto.randomUUID(), statement: 'Cite the R object behind every figure.' })
    expect((await readAboutYouFile(JSON.stringify(file), '')).payload.memories.map(m => m.statement)).toEqual(['Prefer metric units, kilometres for distance.', 'Answer briefly.', 'Cite the R object behind every figure.'])
    const minimal = { ...file, memories: [{ statement: 'Use dark plots.' }] }
    await expect(readAboutYouFile(JSON.stringify(minimal), '')).rejects.toThrow('Memory 1 (“Use dark plots.”): id must be a UUID')
    const typo = { ...file, memories: [{ ...file.memories[0], pinnned: true }] }
    await expect(readAboutYouFile(JSON.stringify(typo), '')).rejects.toThrow('unknown field pinnned')
    const twin = { ...file, memories: [file.memories[0], { ...file.memories[1], id: file.memories[0].id }] }
    await expect(readAboutYouFile(JSON.stringify(twin), '')).rejects.toThrow('id is the same as memory 1')
    await expect(readAboutYouFile('{ "format": "ourgeo-about-you", ', '')).rejects.toThrow('fix the JSON syntax')
    await expect(readAboutYouFile(JSON.stringify({ ...file, note: 'x' }), '')).rejects.toThrow('fields ouRGeo does not write: note')
  })
})

describe('importing into the profile store', () => {
  it('replace makes About you match the file without touching project memory, and a forgotten memory stays forgotten', () => {
    const source = new MemoryStorage(':memory:', randomBytes(32))
    const kept = source.save(memory('Prefer metric units.')), dropped = source.save(memory('Use imperial units.'))
    source.forget(dropped.id)
    const file = aboutYouExport(source.list('global'))
    source.close()

    const target = new MemoryStorage(':memory:', randomBytes(32)), projectId = crypto.randomUUID()
    const project = target.save(memory('Project uses EPSG:2193.', { scope: 'project', projectId, category: 'decision' }))
    const local = target.save(memory('Answer briefly.'))
    target.save(memory('Plot in dark mode', { status: 'candidate' }))
    target.forget(kept.id)
    expect(target.importAboutYou(file.memories, 'merge')).toMatchObject({ added: 0, forgotten: 1 })

    const fresh = new MemoryStorage(':memory:', randomBytes(32))
    fresh.save(local)
    fresh.save(project)
    expect(fresh.importAboutYou(file.memories, 'replace')).toMatchObject({ added: 1, removed: 1 })
    expect(fresh.list('global').map(m => m.statement)).toEqual(['Prefer metric units.'])
    expect(fresh.list(`project:${projectId}`).map(m => m.id)).toEqual([project.id])
    expect(fresh.importAboutYou(file.memories, 'replace')).toMatchObject({ added: 0, unchanged: 1, removed: 0 })
    expect(fresh.search('metric').map(m => m.id)).toEqual([kept.id])
    target.close(); fresh.close()
  })
})
