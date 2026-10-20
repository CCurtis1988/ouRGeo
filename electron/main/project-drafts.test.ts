import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.path } }))
vi.mock('./context/ipc', () => ({ requireContextOwner: () => undefined }))
import {
  writeDraft, readDraft, discardDraft, setBase, listDrafts, deleteDrafts, draftKey,
  acquireLock, releaseLock, checkpointTarget, commitCheckpoint,
} from './project-drafts'

let project: string
beforeEach(() => {
  state.path = mkdtempSync(join(tmpdir(), 'ourgeo-drafts-'))
  project = join(state.path, 'work.ourgeoproj')
  writeFileSync(project, 'bundle-v1')
})
afterEach(() => rmSync(state.path, { recursive: true, force: true }))

describe('drafts', () => {
  it('writes slices and one file per document, and reads them back', async () => {
    const meta = await writeDraft(project, { meta: { changed: true, name: 'work' }, slices: { ui: '{"version":1}', view: '{"editors":{}}' }, docs: { a: '{"content":"x","savedContent":""}', b: '{"content":"y","savedContent":""}' } })
    expect(meta.changed).toBe(true)
    const draft = await readDraft(project)
    expect(draft.slices.ui).toBe('{"version":1}')
    expect(Object.keys(draft.docs).sort()).toEqual(['a', 'b'])
    expect(draft.unreadable).toEqual([])
  })

  it('names an unreadable document and keeps the others (§3.3, C3)', async () => {
    await writeDraft(project, { docs: { good: '{"content":"x","savedContent":""}', bad: '{"content":"y","savedContent":""}' } })
    writeFileSync(join(state.path, 'project-drafts', draftKey(project), 'docs', 'bad.json'), '{not json')
    const draft = await readDraft(project)
    expect(Object.keys(draft.docs)).toEqual(['good'])
    expect(draft.unreadable).toEqual(['doc:bad'])
  })

  it('deletes closed documents when told which to keep', async () => {
    await writeDraft(project, { docs: { a: '{}', b: '{}' } })
    await writeDraft(project, { keepDocs: ['a'] })
    expect(Object.keys((await readDraft(project)).docs)).toEqual(['a'])
  })

  it('leaves no temp files behind and never a torn file', async () => {
    await writeDraft(project, { slices: { ui: '{"a":1}' } })
    const dir = join(state.path, 'project-drafts', draftKey(project))
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('discard drops the changes and keeps the view and base', async () => {
    await setBase(project)
    await writeDraft(project, { meta: { changed: true }, slices: { ui: '{}', layers: '{}', view: '{"editors":{}}' }, docs: { a: '{}' } })
    const meta = await discardDraft(project)
    const draft = await readDraft(project)
    expect(meta.changed).toBe(false)
    expect(draft.slices.ui).toBeUndefined()
    expect(draft.slices.view).toBeDefined()
    expect(draft.docs).toEqual({})
    expect(draft.hasBase).toBe(true)
    expect(meta.baseSignature).toMatch(/^[a-f0-9]{64}$/)
  })

  it('lists drafts with whether their project file still exists, and deletes only drafts', async () => {
    await writeDraft(project, { meta: { changed: true, name: 'work' }, slices: { ui: '{}' } })
    const gone = join(state.path, 'gone.ourgeoproj')
    await writeDraft(gone, { meta: { changed: true, name: 'gone' }, slices: { ui: '{}' } })
    const listed = await listDrafts()
    expect(listed.map(d => [d.name, d.fileExists]).sort()).toEqual([['gone', false], ['work', true]])
    expect(await deleteDrafts([draftKey(gone)])).toBe(1)
    expect((await listDrafts()).map(d => d.name)).toEqual(['work'])
    expect(existsSync(project)).toBe(true)
  })

  it('refuses to delete the draft of a project open in this window', async () => {
    await writeDraft(project, { slices: { ui: '{}' } })
    await acquireLock(project)
    expect(await deleteDrafts([draftKey(project)])).toBe(0)
    await releaseLock(project)
    expect(await deleteDrafts([draftKey(project)])).toBe(1)
  })

  it('takes over a lock left by a process that is gone (§1.10, N13)', async () => {
    const dir = join(state.path, 'project-drafts', draftKey(project))
    await writeDraft(project, {})
    writeFileSync(join(dir, 'lock.json'), JSON.stringify({ pid: 999_999_999, start: null, acquiredAt: new Date().toISOString() }))
    expect(await acquireLock(project)).toEqual({ ok: true })
    await releaseLock(project)
  })

  it('commits a checkpoint by rename, and refuses a path outside the draft', async () => {
    const target = await checkpointTarget(project)
    writeFileSync(target.temp, 'RDX3')
    const meta = await commitCheckpoint(project, target.temp, '2026-10-20T10:00:00.000Z', 1234)
    expect(meta.checkpointAt).toBe('2026-10-20T10:00:00.000Z')
    expect(meta.checkpointMs).toBe(1234)
    expect((await readDraft(project)).envPath).toBe(target.final)
    await expect(commitCheckpoint(project, join(state.path, 'environment.1.partial.RData'), 'x', 1)).rejects.toThrow(/outside the draft/)
  })
})
