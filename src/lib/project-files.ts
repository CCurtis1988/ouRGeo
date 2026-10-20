// Shared wire data: the library owns bytes in main; the renderer and assistant
// carry project-qualified references, never authority to read arbitrary paths.
export type ProjectFileRole = 'reference' | 'standard' | 'example'
export type ProjectFileStatus = 'queued' | 'indexing' | 'searchable' | 'partial' | 'preview' | 'stored' | 'password' | 'error'
export interface ProjectLinkedFolder {
  id: string
  name: string
  status: 'ready' | 'unlinked' | 'missing' | 'needs-scan' | 'scanning' | 'error'
  path?: string
  lastScannedAt?: string
  issue?: string
  omitted?: number
  limited?: boolean
}
export interface PortableLinkedFolder { id: string; name: string; ignoredPaths?: string[] }
export type ProjectFileLocation =
  | { kind: 'lines'; start: number; end: number }
  | { kind: 'pdf'; page: number; endPage?: number }
  | { kind: 'docx'; section: number }
  | { kind: 'sheet'; sheet: string; range?: string }
  | { kind: 'image' }
export interface ProjectFileSection { title: string; location: ProjectFileLocation; text: string }
export interface ProjectFileAnalysis { text: string; revision: string; provider: string; model: string; createdAt: string; coverage: string }
export type ProjectFileAnalysisInput = Pick<ProjectFileAnalysis, 'text' | 'provider' | 'model' | 'coverage'>
export interface ProjectFileExtraction {
  version: string
  status: ProjectFileStatus
  description: string
  sections: ProjectFileSection[]
  coverage: string
  issue?: string
  image?: { width: number; height: number }
}
export interface ProjectFileEntry {
  id: string
  name: string
  originalName: string
  folder: string
  role: ProjectFileRole
  userDescription: string
  generatedDescription: string
  sha256: string
  bytes: number
  mediaType: string
  revision: string
  importedAt: string
  updatedAt: string
  status: ProjectFileStatus
  coverage: string
  issue?: string
  saved: boolean
  descriptionNeedsReview?: boolean
  includeHidden?: boolean
  storage?: { kind: 'linked'; folderId: string; relativePath: string; fingerprint: string }
  aiDescription?: ProjectFileAnalysis
}
export interface ProjectFileOperation { id: string; label: string; completed: number; total: number; cancellable: boolean }
export interface ProjectFileCatalogue {
  projectId: string | null
  revision: number
  savedRevision: number
  files: ProjectFileEntry[]
  linkedFolders?: ProjectLinkedFolder[]
  operation?: ProjectFileOperation
  notice?: string
  recoveries?: { id: string; files: number; label: string }[]
}
export interface ProjectFileRead {
  id: string
  revision: string
  title: string
  text: string
  location?: ProjectFileLocation
  coverage: string
  complete: boolean
  next?: number
}
export interface ProjectFilePreview extends ProjectFileRead {
  kind: 'text' | 'image' | 'pdf' | 'table' | 'stored'
  url?: string
  mediaType: string
  width?: number
  height?: number
  imageComplete?: boolean
  table?: { sheets: string[]; sheet: string; columns: string[]; rows: { row: number; cells: { address: string; value: string; raw?: string; type?: string; formula?: string }[] }[]; truncated: boolean }
}
export interface ProjectFileHit { id: string; revision: string; title: string; excerpt: string; location?: ProjectFileLocation }
export interface ProjectFileImportResult { catalogue: ProjectFileCatalogue; ids: string[]; errors: string[] }
/** A named write into the embedded library (R helpers, export dialogs).
 *  `name` may carry a logical folder: "figures/map.png". */
export interface ProjectFilePutTarget { name: string; folder?: string; description?: string; role?: ProjectFileRole; overwrite?: boolean }
export interface ProjectFilePutResult { action: 'added' | 'replaced' | 'unchanged'; id: string; revision: string; name: string; folder: string; bytes: number }
export interface ProjectFileApi {
  pathForFile(file: File): string
  catalogue(lease: string): Promise<ProjectFileCatalogue>
  add(lease: string, paths?: string[]): Promise<ProjectFileImportResult>
  update(id: string, revision: string, changes: Partial<Pick<ProjectFileEntry, 'name' | 'folder' | 'role' | 'userDescription'>>, lease: string): Promise<ProjectFileCatalogue>
  replace(id: string, revision: string, lease: string): Promise<ProjectFileCatalogue>
  /** Save bytes rendered in the window (a map image) into the library by name. */
  putBytes(lease: string, base64: string, target: ProjectFilePutTarget): Promise<ProjectFilePutResult>
  remove(ids: string[], lease: string): Promise<ProjectFileCatalogue>
  undo(lease: string): Promise<ProjectFileCatalogue>
  reindex(ids: string[] | undefined, lease: string): Promise<ProjectFileCatalogue>
  read(id: string, revision: string, lease: string, location?: ProjectFileLocation, offset?: number): Promise<ProjectFileRead>
  preview(id: string, revision: string, lease: string, location?: ProjectFileLocation, options?: { includeHidden?: boolean }): Promise<ProjectFilePreview>
  search(query: string, lease: string): Promise<ProjectFileHit[]>
  exportFile(id: string, revision: string, lease: string): Promise<boolean>
  cancel(operationId: string, lease: string): Promise<void>
  discard(lease: string): Promise<ProjectFileCatalogue>
  recoverIntoCopy(id: string, lease: string): Promise<ProjectFileCatalogue>
  setIncludeHidden(id: string, revision: string, enabled: boolean, lease: string): Promise<ProjectFileCatalogue>
  setAnalysis(id: string, revision: string, analysis: ProjectFileAnalysisInput, lease: string): Promise<ProjectFileCatalogue>
  linkFolder(lease: string, path?: string, name?: string): Promise<ProjectFileCatalogue>
  createFolder(lease: string, name: string, parentPath?: string, label?: string): Promise<ProjectFileCatalogue>
  rescanFolders(ids: string[] | undefined, lease: string): Promise<ProjectFileCatalogue>
  forgetFolder(id: string, lease: string): Promise<ProjectFileCatalogue>
  relinkFolder(id: string, lease: string, path?: string): Promise<ProjectFileCatalogue>
  renameLinkedFolder(id: string, name: string, lease: string): Promise<ProjectFileCatalogue>
  onChanged(callback: () => void): () => void
}
export const EMPTY_PROJECT_FILES: ProjectFileCatalogue = { projectId: null, revision: 0, savedRevision: 0, files: [] }
export const PROJECT_FILE_LIMITS = { count: 2000, fileBytes: 100 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024, textBytes: 20 * 1024 * 1024, projectTextBytes: 250 * 1024 * 1024 } as const
export const projectFileSourceId = (projectId: string, id: string): string => `project-file:${projectId}:${id}`
