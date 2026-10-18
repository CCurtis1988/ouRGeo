import type { ProjectFileCatalogue, ProjectFileEntry } from './project-files'

/** A remembered catalogue is not a live filesystem grant. After reopening,
 * losing a mount or detecting edits, only folder recovery metadata is usable
 * until a fresh local scan succeeds. Main repeats these checks on every read. */
export function projectFileAvailable(file: ProjectFileEntry, catalogue: ProjectFileCatalogue): boolean {
  return !file.storage || catalogue.linkedFolders?.some(folder => folder.id === file.storage?.folderId && folder.status === 'ready') === true
}
export function projectFileEvidenceAvailable(file: ProjectFileEntry, catalogue: ProjectFileCatalogue): boolean {
  return projectFileAvailable(file, catalogue) && (!file.storage || file.sha256.length > 0)
}
