import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir, symlink, link, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { ContextFolders } from './folders'

const roots: string[] = []
async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'ourgeo-context-folders-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('indexes only explicitly selected bounded text and applies nested ignore rules without following aliases', async () => {
  const root = await fixture(), outside = await fixture()
  await mkdir(join(root, 'notes')); await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, '.gitignore'), 'hidden.md\nnotes/private*\n')
  await writeFile(join(root, 'notes', '.ourgeoignore'), 'omit.md\n')
  await Promise.all(['public.md', 'hidden.md', '.env', 'binary.md', 'large.md'].map(name => writeFile(join(root, name), name === 'binary.md' ? '\0binary' : name === 'large.md' ? 'x'.repeat(1024 * 1024 + 1) : '# Example\nUseful project context')))
  await writeFile(join(root, 'notes', 'private.md'), 'private'); await writeFile(join(root, 'notes', 'omit.md'), 'omit'); await writeFile(join(root, 'notes', 'good.md'), 'good')
  await writeFile(join(root, 'node_modules', 'bad.md'), 'hidden')
  await writeFile(join(outside, 'secret.md'), 'must never disclose')
  await symlink(join(outside, 'secret.md'), join(root, 'alias.md'))
  await symlink(outside, join(root, 'linked-folder'))
  await link(join(outside, 'secret.md'), join(root, 'hard.md'))
  const service = new ContextFolders(() => 'lease')
  expect(service.catalogue('lease').documents).toEqual([])
  const result = await service.add(root, 'lease')
  expect(result.documents.map(doc => doc.title).sort()).toEqual(['notes/good.md', 'public.md'])
  const doc = result.documents.find(doc => doc.title === 'public.md')!
  expect(await service.read(doc.id, doc.revision, 'lease', { startLine: 2, endLine: 2 })).toBe('Useful project context')
})

it('refuses stale revisions, revoked scope, path substitutions and changed exclusions', async () => {
  const root = await fixture(), outside = await fixture()
  const path = join(root, 'doc.md')
  await writeFile(path, 'original'); await writeFile(join(outside, 'other.md'), 'external')
  let lease = 'first'
  const service = new ContextFolders(() => lease)
  let doc = (await service.add(root, lease)).documents[0]
  await writeFile(path, 'changed')
  await expect(service.read(doc.id, doc.revision, lease)).rejects.toThrow('STALE_REFERENCE')
  doc = (await service.refresh(doc.folderId, lease)).documents[0]
  await writeFile(join(root, '.gitignore'), 'doc.md\n')
  await expect(service.read(doc.id, doc.revision, lease)).rejects.toThrow('ignored')
  await rm(join(root, '.gitignore')); await rm(path); await symlink(join(outside, 'other.md'), path)
  await expect(service.read(doc.id, doc.revision, lease)).rejects.toThrow('outside')
  lease = 'next'; service.clear()
  await expect(service.read(doc.id, doc.revision, 'first')).rejects.toThrow('SCOPE_CHANGED')
  expect(service.catalogue('next').documents).toEqual([])
})

it('prevents a removed or old-workspace scan from registering late content', async () => {
  const root = await fixture()
  await writeFile(join(root, 'one.md'), 'one')
  let lease = 'one'
  const service = new ContextFolders(() => lease)
  const pending = service.add(root, lease)
  lease = 'two'; service.clear()
  await expect(pending).rejects.toThrow('SCOPE_CHANGED')
  expect(service.catalogue(lease).folders).toEqual([])
  const first = await service.add(root, lease)
  const scan = service.refresh(first.folders[0].id, lease)
  service.remove(first.folders[0].id, lease)
  await expect(scan).rejects.toThrow('SCOPE_CHANGED')
  expect(service.catalogue(lease).documents).toEqual([])
})

it('refuses home and disk roots and rejects unknown handles', async () => {
  const service = new ContextFolders(() => 'lease')
  await expect(service.add('/', 'lease')).rejects.toThrow('whole disk')
  await expect(service.add(homedir(), 'lease')).rejects.toThrow('home folder')
  await expect(service.read('../outside', 'fake', 'lease')).rejects.toThrow('SOURCE_UNAVAILABLE')
})

it('bounds catalogue size and redacts secrets before discovery or range delivery', async () => {
  const root = await fixture()
  await writeFile(join(root, 'secret.md'), 'password=hidden\n-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----')
  const service = new ContextFolders(() => 'lease')
  const result = await service.add(root, 'lease'), doc = result.documents[0]
  expect(doc.summary).not.toContain('password=hidden')
  expect(doc.summary).not.toContain('private material')
  expect(await service.read(doc.id, doc.revision, 'lease', { startLine: 3, endLine: 3 })).toBe('[redacted private key]')
})

it('stops at the descriptor ceiling without reading or returning an unbounded directory', async () => {
  const root = await fixture()
  for (let batch = 0; batch < 21; batch++) await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(join(root, `${batch}-${index}.md`), 'bounded synthetic note')))
  const service = new ContextFolders(() => 'lease')
  const result = await service.add(root, 'lease')
  expect(result.documents).toHaveLength(2000)
  expect(result.folders[0]).toMatchObject({ files: 2000, limited: true })
  expect(JSON.stringify(result).length).toBeLessThan(1_000_000)
})

it('invalidates cached excerpts immediately after a watched file or ignore rule changes', async () => {
  const root = await fixture()
  await writeFile(join(root, 'note.md'), 'original snapshot')
  let notify!: () => void
  const invalidated = new Promise<void>(resolve => { notify = resolve })
  const service = new ContextFolders(() => 'lease', notify)
  try {
    const first = await service.add(root, 'lease')
    expect(first.documents).toHaveLength(1)
    await writeFile(join(root, '.gitignore'), 'note.md\n')
    await Promise.race([invalidated, new Promise((_, reject) => setTimeout(() => reject(new Error('watcher did not invalidate')), 2000))])
    expect(service.catalogue('lease').documents).toEqual([])
    expect(service.catalogue('lease').folders).toHaveLength(1)
    expect((await service.refresh(first.folders[0].id, 'lease')).documents).toEqual([])
  } finally { service.clear() }
})


it('redacts private keys spanning the discovery excerpt and unclosed key blocks', async () => {
  const root = await fixture()
  await writeFile(join(root, 'long-key.md'), '-----BEGIN PRIVATE KEY-----\n' + 'private material'.repeat(250) + '\n-----END PRIVATE KEY-----')
  await writeFile(join(root, 'incomplete-key.md'), '-----BEGIN PRIVATE KEY-----\nprivate material without closing marker')
  const service = new ContextFolders(() => 'lease')
  const result = await service.add(root, 'lease')
  for (const doc of result.documents) {
    expect(doc.summary).not.toContain('private material')
    expect(await service.read(doc.id, doc.revision, 'lease')).not.toContain('private material')
  }
})


it('preserves opaque source identity across watcher invalidation so exclusions remain effective', async () => {
  const root = await fixture()
  await writeFile(join(root, 'note.md'), 'first version')
  let notify!: () => void
  const invalidated = new Promise<void>(resolve => { notify = resolve })
  const service = new ContextFolders(() => 'lease', notify)
  try {
    const first = await service.add(root, 'lease')
    await writeFile(join(root, 'note.md'), 'second version')
    await Promise.race([invalidated, new Promise((_, reject) => setTimeout(() => reject(new Error('watcher did not invalidate')), 2000))])
    const refreshed = await service.refresh(first.folders[0].id, 'lease')
    expect(refreshed.documents[0].id).toBe(first.documents[0].id)
    expect(refreshed.documents[0].revision).not.toBe(first.documents[0].revision)
  } finally { service.clear() }
})


it('honours zero-directory globstars and fails closed for unsupported ignore syntax', async () => {
  const root = await fixture()
  await writeFile(join(root, '.gitignore'), '**/secret.md\n')
  await writeFile(join(root, 'secret.md'), 'private')
  await writeFile(join(root, 'visible.md'), 'allowed')
  const service = new ContextFolders(() => 'lease')
  const first = await service.add(root, 'lease')
  expect(first.documents.map(doc => doc.title)).toEqual(['visible.md'])
  await writeFile(join(root, '.gitignore'), '[ab]*.md\n')
  expect((await service.refresh(first.folders[0].id, 'lease')).documents).toEqual([])
})
