import { createHash } from 'node:crypto'
import type { ProjectFileEntry, ProjectFileExtraction } from '../../../src/lib/project-files'
export const fixtureBytes = Buffer.from('Independent report requirement: clearance 17 metres.\n')
export const fixtureHash = createHash('sha256').update(fixtureBytes).digest('hex')
export const fixtureEntry = (overrides: Partial<ProjectFileEntry> = {}): ProjectFileEntry => ({ id: '4d67478e-91f7-41ce-b507-afc7b6e4077f', name: 'reference.md', originalName: 'reference.md', folder: '', role: 'reference', userDescription: '', generatedDescription: 'Reference report', sha256: fixtureHash, bytes: fixtureBytes.length, mediaType: 'text/markdown', revision: `${fixtureHash}:1`, importedAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', status: 'searchable', coverage: 'All lines indexed.', saved: true, ...overrides })
export const fixtureExtraction = (): ProjectFileExtraction => ({ version: 'project-files-1', status: 'searchable', description: 'Reference report, one line.', coverage: 'All lines indexed.', sections: [{ title: 'Requirement', location: { kind: 'lines', start: 1, end: 1 }, text: fixtureBytes.toString('utf8').trim() }] })
