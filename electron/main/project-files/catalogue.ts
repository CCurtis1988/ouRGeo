import type { PortableLinkedFolder, ProjectFileCatalogue, ProjectFileEntry } from '../../../src/lib/project-files'
import { PROJECT_FILE_LIMITS } from '../../../src/lib/project-files'

import { safeRelativePath } from './linked'
export interface PortableLibrary { version: 1 | 2; revision: number; files: ProjectFileEntry[]; linkedFolders?: PortableLinkedFolder[] }
export const emptyLibrary = (): PortableLibrary => ({ version: 1, revision: 0, files: [] })
const statuses = new Set(['queued', 'indexing', 'searchable', 'partial', 'preview', 'stored', 'password', 'error'])
export function validateLibrary(input: unknown): PortableLibrary {
  if (!input || typeof input !== 'object') throw new Error('Project file catalogue is missing. Restore a complete project bundle.')
  const data = input as PortableLibrary
  const required = (input as { requiredCapabilities?: unknown }).requiredCapabilities
  if (required !== undefined && (!Array.isArray(required) || required.length)) throw new Error('Project files require unsupported capabilities. Open with a compatible ouRGeo version.')
  if (![1, 2].includes(data.version) || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.files) || data.files.length > PROJECT_FILE_LIMITS.count) throw new Error('Project file catalogue is unsupported or exceeds its limit. Open with a compatible ouRGeo version.')
  const ids = new Set<string>(); let total = 0
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0')
  const folderIds = new Set<string>()
  if (data.linkedFolders !== undefined && (!Array.isArray(data.linkedFolders) || data.linkedFolders.length > 32 || data.version !== 2 && data.linkedFolders.length)) throw new Error('Linked folder catalogue is unsupported. Open with a compatible ouRGeo version.')
  const linkedFolders = (data.linkedFolders ?? []).map((folder): PortableLinkedFolder => {
    if (!folder || !/^[a-f0-9-]{36}$/i.test(folder.id) || folderIds.has(folder.id) || !text(folder.name, 240) || !folder.name.trim() || folder.ignoredPaths !== undefined && (!Array.isArray(folder.ignoredPaths) || folder.ignoredPaths.length > 2000 || !folder.ignoredPaths.every(safeRelativePath))) throw new Error('Linked folder metadata is invalid. Preserve the original project.')
    folderIds.add(folder.id)
    return { id: folder.id, name: folder.name, ...(folder.ignoredPaths?.length ? { ignoredPaths: [...new Set(folder.ignoredPaths)] } : {}) }
  })
  const files = data.files.map((f): ProjectFileEntry => {
    const linked = f?.storage
    if (linked && (data.version !== 2 || linked.kind !== 'linked' || !folderIds.has(linked.folderId) || !safeRelativePath(linked.relativePath) || !/^[a-f0-9]{64}$/.test(linked.fingerprint))) throw new Error('Linked file metadata is invalid. Restore a healthy project catalogue.')
    const validHash = linked && f.bytes > PROJECT_FILE_LIMITS.fileBytes ? f.sha256 === '' : /^[a-f0-9]{64}$/.test(f?.sha256)
    if (!f || !/^[a-f0-9-]{36}$/i.test(f.id) || ids.has(f.id) || !validHash || !text(f.name, 240) || !f.name.trim() || !text(f.originalName, 240) || !text(f.folder, 500) || !text(f.userDescription, 4000) || !text(f.generatedDescription, 2000) || !text(f.mediaType, 150) || !text(f.coverage, 2000) || !text(f.revision, 128) || !f.revision.startsWith(`${f.sha256 || 'linked'}:`) || !text(f.importedAt, 40) || !text(f.updatedAt, 40) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || !linked && f.bytes > PROJECT_FILE_LIMITS.fileBytes || !['reference', 'standard', 'example'].includes(f.role) || !statuses.has(f.status) || f.issue !== undefined && !text(f.issue, 4000)) throw new Error('Project file metadata is invalid. Restore the original bundle or export its healthy files.')
    const analysis = f.aiDescription
    if (analysis !== undefined && (!analysis || typeof analysis !== 'object' || !text(analysis.text, 2000) || !analysis.text.trim() || !text(analysis.revision, 128) || !analysis.revision || !text(analysis.provider, 40) || !analysis.provider.trim() || !text(analysis.model, 200) || !analysis.model.trim() || !text(analysis.coverage, 500) || !text(analysis.createdAt, 40) || !Number.isFinite(Date.parse(analysis.createdAt)))) throw new Error('AI file-description metadata is invalid. Restore a healthy catalogue or regenerate the description.')
    ids.add(f.id); if (!linked) total += f.bytes
    return { id: f.id, name: f.name, originalName: f.originalName, folder: f.folder, role: f.role, userDescription: f.userDescription, generatedDescription: f.generatedDescription, sha256: f.sha256, bytes: f.bytes, mediaType: f.mediaType, revision: f.revision, importedAt: f.importedAt, updatedAt: f.updatedAt, status: f.status, coverage: f.coverage, ...(f.issue ? { issue: f.issue } : {}), saved: true, ...(f.descriptionNeedsReview ? { descriptionNeedsReview: true } : {}), ...(linked ? { storage: { kind: 'linked', folderId: linked.folderId, relativePath: linked.relativePath, fingerprint: linked.fingerprint } } : {}), ...(analysis ? { aiDescription: { text: analysis.text, revision: analysis.revision, provider: analysis.provider, model: analysis.model, createdAt: analysis.createdAt, coverage: analysis.coverage } } : {}) }
  })
  if (total > PROJECT_FILE_LIMITS.totalBytes) throw new Error('Project files exceed the 1 GiB library limit. Restore a smaller project.')
  return { version: data.version, revision: data.revision, files, ...(data.version === 2 ? { linkedFolders } : {}) }
}
export function portableCatalogue(catalogue: ProjectFileCatalogue): PortableLibrary {
  return validateLibrary({ version: catalogue.linkedFolders?.length || catalogue.files.some(file => file.storage) ? 2 : 1, revision: catalogue.revision, files: catalogue.files, ...(catalogue.linkedFolders?.length ? { linkedFolders: catalogue.linkedFolders } : {}) })
}
