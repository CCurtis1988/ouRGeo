import { describe, expect, it } from 'vitest'
import { destinationExpr, projectFileName, savePlotCode, writeTableCode } from './project-file-code'
import { matchProjectFiles, parseProjectFileTarget, replacedProjectFile, resolveProjectFile } from './project-file-targets'
import type { ProjectFileCatalogue, ProjectFileEntry } from './project-files'

const entry = (name: string, folder = '', storage?: ProjectFileEntry['storage']): ProjectFileEntry => ({ id: name + folder, name, originalName: name, folder, role: 'reference', userDescription: '', generatedDescription: '', sha256: 'a', bytes: 1, mediaType: 'text/csv', revision: 'r', importedAt: '', updatedAt: '', status: 'searchable', coverage: '', saved: true, ...(storage ? { storage } : {}) })

describe('naming a project file', () => {
  it('splits a logical folder from the display name, and joins an explicit folder in front', () => {
    expect(parseProjectFileTarget('figures/map.png')).toEqual({ folder: 'figures', name: 'map.png' })
    expect(parseProjectFileTarget('map.png', 'figures/2026')).toEqual({ folder: 'figures/2026', name: 'map.png' })
    expect(parseProjectFileTarget('.\\tables\\a.csv')).toEqual({ folder: 'tables', name: 'a.csv' })
  })
  it('refuses a name that would step outside the project, and says folders are labels', () => {
    expect(() => parseProjectFileTarget('../secrets.txt')).toThrow('folders are labels')
    expect(() => parseProjectFileTarget('  ')).toThrow('tables/summary.csv')
  })
  it('asks for a location when a name is both embedded and linked', () => {
    const catalogue: ProjectFileCatalogue = { projectId: 'p', revision: 1, savedRevision: 1, files: [entry('a.csv'), entry('a.csv', '', { kind: 'linked', folderId: 'f', relativePath: 'a.csv', fingerprint: 'x' })], linkedFolders: [{ id: 'f', name: 'Field', status: 'ready' }] }
    expect(() => resolveProjectFile(catalogue, 'a.csv')).toThrow('location = "project"')
    expect(resolveProjectFile(catalogue, 'a.csv', 'Field').storage?.folderId).toBe('f')
    expect(matchProjectFiles(catalogue, 'a.csv', 'project')).toHaveLength(1)
  })
})

describe('what an export would replace', () => {
  it('follows the library rule: same display name in any folder, never a linked file', () => {
    const imported = entry('sites.csv', 'data')
    const catalogue: ProjectFileCatalogue = { projectId: 'p', revision: 1, savedRevision: 1, files: [imported, entry('roads.gpkg', '', { kind: 'linked', folderId: 'f', relativePath: 'roads.gpkg', fingerprint: 'x' })] }
    // Exporting to tables/sites.csv replaces data/sites.csv: put matches by name.
    expect(replacedProjectFile(catalogue, 'tables/SITES.csv')).toBe(imported)
    expect(replacedProjectFile(catalogue, 'roads.gpkg')).toBeUndefined()
    expect(replacedProjectFile(catalogue, 'tables/other.csv')).toBeUndefined()
  })
})

describe('the R an export dialog writes', () => {
  it('changes only the path argument when the destination is Project Files', () => {
    const project = { kind: 'project', name: projectFileName('tables', 'sites.csv') } as const
    expect(writeTableCode('sites', 'csv', project)).toBe('write.csv(sites, ourgeo_project_path("tables/sites.csv"), row.names = FALSE)')
    expect(writeTableCode('sites', 'csv', { kind: 'disk', path: 'C:\\out\\sites.csv' })).toBe('write.csv(sites, "C:/out/sites.csv", row.names = FALSE)')
  })
  it('quotes a path the user typed, rather than splicing it into R', () => {
    expect(destinationExpr({ kind: 'disk', path: '/tmp/a"b.csv' })).toBe('"/tmp/a\\"b.csv"')
    expect(destinationExpr({ kind: 'project', name: 'a"b.csv' })).toBe('ourgeo_project_path("a\\"b.csv")')
  })
  it('saves the plot on screen with the dialog\'s own size, unit and resolution', () => {
    expect(savePlotCode({ kind: 'project', name: 'figures/plot.png' }, { width: 7, height: 5, units: 'in', dpi: 300, plotId: 'p4' }))
      .toBe('ourgeo_save_plot(ourgeo_project_path("figures/plot.png"), width = 7, height = 5, units = "in", dpi = 300, plot = "p4")')
  })
})
