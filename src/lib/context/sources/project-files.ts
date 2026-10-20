import type { ContextSource } from '../types'
import { projectFileAvailable } from '@/lib/project-file-availability'
import { projectFileDescription } from '@/lib/project-file-description'
import { projectFileSourceId, type ProjectFileCatalogue, type ProjectFileApi, type ProjectFileHit } from '@/lib/project-files'

/** Only catalogue metadata is enumerated. A read acquires a fresh main-process
 * lease, so renderer references never become arbitrary filesystem access. */
export function projectFileSources(catalogue: ProjectFileCatalogue, api: ProjectFileApi, lease: () => Promise<string>): ContextSource[] {
  if (!catalogue.projectId) return []
  const projectId = catalogue.projectId
  return catalogue.files.filter(file => projectFileAvailable(file, catalogue)).map(file => ({
    id: projectFileSourceId(projectId, file.id), kind: 'document', scope: 'project', group: 'project-files',
    title: file.name, summary: `${file.storage && !file.sha256 ? 'Metadata only; original exceeds the read budget and contents are not indexed. ' : ''}${file.storage ? `Linked file ${file.storage.relativePath} · ` : ''}${file.folder ? `${file.folder}/` : ''}${file.name} · ${file.role} · ${projectFileDescription(file)} · ${file.status}: ${file.coverage}`.slice(0, 1500),
    revision: file.revision, timestamp: file.updatedAt, trust: 'untrusted',
    projectFile: { projectId, id: file.id, mediaType: file.mediaType, coverage: file.coverage, ...(file.storage && !file.sha256 ? { metadataOnly: true } : {}) },
    read: async signal => { signal?.throwIfAborted(); if (file.storage && !file.sha256) throw new Error('BUDGET_LIMIT: this linked file is available as metadata only; its original exceeds the read budget and its contents are not indexed. Choose a smaller supported reference for assistant evidence.'); const result = await api.read(file.id, file.revision, await lease()); signal?.throwIfAborted(); return result.text },
    readLocated: async (location, offset, signal) => { signal?.throwIfAborted(); if (file.storage && !file.sha256) throw new Error('BUDGET_LIMIT: this linked file is available as metadata only; its original exceeds the read budget and its contents are not indexed. Choose a smaller supported reference for assistant evidence.'); const result = await api.read(file.id, file.revision, await lease(), location, offset); signal?.throwIfAborted(); return result },
  }))
}

export function projectFileContentHits(projectId: string, hits: ProjectFileHit[]): { sourceId: string; revision: string; excerpt: string; location?: ProjectFileHit['location'] }[] {
  return hits.map(hit => ({ sourceId: projectFileSourceId(projectId, hit.id), revision: hit.revision, excerpt: hit.excerpt, location: hit.location }))
}
