import { beforeEach, expect, it, vi } from 'vitest'
let privateColumns = false
vi.mock('@/store/column-disclosure', () => ({ hasColumnExclusions: () => privateColumns }))
import { clearFolderSources, folderCatalogueSnapshot, folderSources, folderSourceScan, refreshFolderSources } from './folder-sources'
import { rankSourcePage } from './rank'
import type { FolderCatalogue, FolderContextApi } from './folders'

const catalogue: FolderCatalogue = { folders: [{ id: 'folder', title: 'Synthetic notes', files: 1, omitted: 0, limited: false }], documents: [{ id: 'file', folderId: 'folder', title: 'note.md', summary: 'A project note', revision: 'rev' }] }
const api: FolderContextApi = { folderCatalogue: vi.fn(async () => catalogue), chooseContextFolder: vi.fn(), refreshContextFolder: vi.fn(), removeContextFolder: vi.fn(), readContextFile: vi.fn(async () => 'bounded evidence') }
beforeEach(() => { privateColumns = false; clearFolderSources(); vi.clearAllMocks() })

it('discovers descriptors without reading files and invalidates handles after revocation', async () => {
  await refreshFolderSources(api, 'lease')
  const source = folderSources(api)[0]
  expect(api.readContextFile).not.toHaveBeenCalled()
  expect(await source.read()).toBe('bounded evidence')
  expect(api.readContextFile).toHaveBeenCalledWith('file', 'rev', 'lease')
  clearFolderSources()
  await expect(source.read()).rejects.toThrow('SCOPE_CHANGED')
  expect(folderSources(api)).toEqual([])
})

it('discards late catalogue and range receipts when the workspace changes', async () => {
  let complete!: (value: FolderCatalogue) => void
  const slow = { ...api, folderCatalogue: () => new Promise<FolderCatalogue>(resolve => { complete = resolve }) }
  const pending = refreshFolderSources(slow, 'old')
  clearFolderSources(); complete(catalogue); await pending
  expect(folderCatalogueSnapshot().documents).toEqual([])
  await refreshFolderSources(api, 'new')
  let release!: (value: string) => void
  const slowRead = { ...api, readContextFile: () => new Promise<string>(resolve => { release = resolve }) }
  const source = folderSources(slowRead)[0]
  const read = source.readRange!({ startLine: 2, endLine: 3 })
  clearFolderSources(); release('old content')
  await expect(read).rejects.toThrow('SCOPE_CHANGED')
})

it('streams broad folder pages with stable selected readers and revokes a paused scan on refresh', async () => {
  const large = { ...api, folderCatalogue: vi.fn(async () => ({ folders: catalogue.folders, documents: Array.from({ length: 2100 }, (_, row) => ({ ...catalogue.documents[0], id: `document:folder-${row}`, title: `note-${row}.md` })) })) }
  await refreshFolderSources(large, 'lease')
  const page = rankSourcePage('', () => folderSourceScan(large), 10, 5)
  expect(page.total).toBe(2100)
  expect(new Set(page.hits.map(hit => hit.source.id)).size).toBe(5)
  expect(large.readContextFile).not.toHaveBeenCalled()
  for (const hit of page.hits) {
    await hit.source.read()
    expect(large.readContextFile).toHaveBeenLastCalledWith(hit.source.id, 'rev', 'lease')
  }
  const scan = folderSourceScan(large)[Symbol.iterator]()
  scan.next()
  await refreshFolderSources(large, 'lease')
  expect(() => scan.next()).toThrow('SCOPE_CHANGED')
  await expect(page.hits[0].source.read()).rejects.toThrow('SCOPE_CHANGED')
})

it('does not reuse an empty pending snapshot after a same-workspace refresh and blocks newly private reads', async () => {
  await refreshFolderSources(api, 'lease')
  let complete!: (value: FolderCatalogue) => void
  const pending = refreshFolderSources({ ...api, folderCatalogue: () => new Promise<FolderCatalogue>(resolve => { complete = resolve }) }, 'lease')
  expect(folderSources(api)).toEqual([])
  complete({ ...catalogue, documents: [{ ...catalogue.documents[0], revision: 'new-revision', title: 'updated.md' }] })
  await pending
  const refreshed = folderSources(api)[0]
  expect(refreshed.title).toBe('updated.md')
  expect(refreshed.revision).toBe('new-revision')
  privateColumns = true
  expect(folderSources(api)).toEqual([])
  await expect(refreshed.read()).rejects.toThrow('SCOPE_CHANGED')
  expect(api.readContextFile).not.toHaveBeenCalled()
})
