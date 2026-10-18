import { describe, expect, it, vi } from 'vitest'
vi.mock('@/store/layout', () => ({ useLayoutStore: {} }))
vi.mock('@/store/project-files', () => ({ useProjectFilesStore: {} }))
import { visibleProjectFiles, linkedFileAvailability, projectFileStorageTotals, type ProjectFileFilters } from './project-files-ui'
import type { ProjectFileEntry } from './project-files'

const filters: ProjectFileFilters = { search: '', role: '', status: '', availability: '', folder: '', location: '', sort: 'name', descending: false }
const file = (id: string, name: string, folder: string, role: ProjectFileEntry['role']): ProjectFileEntry => ({ id, name, folder, role, originalName: name, userDescription: '', generatedDescription: 'Reference example', sha256: '', bytes: 1, mediaType: 'text/plain', revision: 'r1', importedAt: '', updatedAt: '', status: 'searchable', coverage: 'Complete', saved: true })
const files = [file('a', 'Report 10.md', 'Reports', 'reference'), file('b', 'Report 2.md', 'Reports', 'standard'), file('c', 'Figure.png', 'Figures', 'example')]

describe('browsing project files', () => {
  it('combines folder, role, description and assistant filters without changing the catalogue', () => {
    const before = [...files]
    expect(visibleProjectFiles(files, { ...filters, search: 'reference', folder: 'Reports', role: 'standard', availability: 'excluded' }, new Set(['b']))).toEqual([files[1]])
    expect(files).toEqual(before)
    expect(visibleProjectFiles(files, { ...filters, folder: 'Reports', availability: 'available' }, new Set(['b']))).toEqual([files[0]])
  })
  it('sorts numbered filenames naturally and reverses deliberately', () => {
    expect(visibleProjectFiles(files, filters, new Set()).map(file => file.id)).toEqual(['c', 'b', 'a'])
    expect(visibleProjectFiles(files, { ...filters, descending: true }, new Set()).map(file => file.id)).toEqual(['a', 'b', 'c'])
  })
  it('filters external locations without counting their bytes as embedded originals', () => {
    const external = { ...files[0], id: 'linked', bytes: 1024 ** 4, sha256: 'hash', storage: { kind: 'linked' as const, folderId: 'root', relativePath: 'Report.md', fingerprint: 'v1' } }
    const catalogue = [...files, external]
    expect(visibleProjectFiles(catalogue, { ...filters, location: 'embedded' }, new Set())).toHaveLength(3)
    expect(visibleProjectFiles(catalogue, { ...filters, location: 'root' }, new Set())).toEqual([external])
    expect(projectFileStorageTotals(catalogue)).toEqual({ embedded: { count: 3, bytes: 3 }, linked: { count: 1, bytes: 1024 ** 4 } })
  })
  it('keeps missing and oversized linked files discoverable without claiming assistant access', () => {
    const external = { ...files[0], storage: { kind: 'linked' as const, folderId: 'root', relativePath: 'Report.md', fingerprint: 'v1' } }
    expect(linkedFileAvailability(external, [{ id: 'root', name: 'Reports', status: 'missing' }]).available).toBe(false)
    expect(linkedFileAvailability(external, [{ id: 'root', name: 'Reports', status: 'ready' }]).available).toBe(false)
    expect(linkedFileAvailability({ ...external, sha256: 'content' }, [{ id: 'root', name: 'Reports', status: 'ready' }]).available).toBe(true)
  })
})
