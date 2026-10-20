import { useLayoutStore } from '@/store/layout'
import { useProjectFilesStore } from '@/store/project-files'
import type { ProjectFileEntry, ProjectFileLocation, ProjectFileRole, ProjectFileStatus, ProjectLinkedFolder } from './project-files'
import { projectFileDescription } from './project-file-description'

export function openProjectFiles(id?: string, location?: ProjectFileLocation): void {
  const layout = useLayoutStore.getState()
  layout.setPanelOpen('projectFiles', true)
  layout.setActivePanel('projectFiles')
  layout.focusPanel('projectFiles')
  if (id) useProjectFilesStore.getState().select([id], location)
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-ourgeo-id="projectFiles.panel"]')?.focus())
}

export const FILE_STATUS_LABELS: Record<ProjectFileStatus, string> = {
  queued: 'Queued', indexing: 'Indexing…', searchable: 'Searchable', partial: 'Partly searchable',
  preview: 'Preview only', stored: 'Stored only', password: 'Needs password', error: 'Could not index',
}
export type ProjectFileSort = 'name' | 'type' | 'description' | 'status'
export interface ProjectFileFilters {
  search: string
  role: ProjectFileRole | ''
  status: ProjectFileStatus | ''
  availability: '' | 'available' | 'excluded'
  folder: string
  location: string
  sort: ProjectFileSort
  descending: boolean
}
export function fileType(file: ProjectFileEntry): string {
  const detected: Record<string, string> = {
    'application/pdf': 'PDF', 'text/markdown': 'Markdown', 'text/csv': 'CSV',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/gif': 'GIF',
  }
  if (detected[file.mediaType]) return detected[file.mediaType]
  return file.originalName.includes('.') ? file.originalName.split('.').pop()!.toUpperCase() : file.mediaType
}
export function visibleProjectFiles(files: ProjectFileEntry[], filters: ProjectFileFilters, excluded: Set<string>): ProjectFileEntry[] {
  const query = filters.search.trim().toLocaleLowerCase()
  const value = (file: ProjectFileEntry): string => filters.sort === 'type' ? fileType(file)
    : filters.sort === 'description' ? projectFileDescription(file)
      : filters.sort === 'status' ? FILE_STATUS_LABELS[file.status] : file.name
  return files.filter(file => (!filters.role || file.role === filters.role)
    && (!filters.status || file.status === filters.status)
    && (!filters.folder || file.folder === filters.folder)
    && (!filters.location || (filters.location === 'embedded' ? !file.storage : file.storage?.folderId === filters.location))
    && (!filters.availability || excluded.has(file.id) === (filters.availability === 'excluded'))
    && (!query || [file.name, file.folder, projectFileDescription(file), file.generatedDescription].join(' ').toLocaleLowerCase().includes(query)))
    .sort((a, b) => (value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)) * (filters.descending ? -1 : 1))
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024, unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(1)} ${units[unit]}`
}

export const LINKED_FOLDER_STATUS_LABELS: Record<ProjectLinkedFolder['status'], string> = {
  ready: 'Ready', unlinked: 'Not linked on this device', missing: 'Folder missing',
  'needs-scan': 'Rescan needed', scanning: 'Scanning…', error: 'Could not scan',
}

export function linkedFileAvailability(file: ProjectFileEntry, folders: ProjectLinkedFolder[] = []): { available: boolean; reason?: string } {
  if (!file.storage) return { available: true }
  const folder = folders.find(folder => folder.id === file.storage?.folderId)
  if (!folder || folder.status !== 'ready') return { available: false, reason: folder ? `${LINKED_FOLDER_STATUS_LABELS[folder.status]}. Relink or rescan this folder before using it with the assistant.` : 'The folder is no longer linked. Relink it to use this file with the assistant.' }
  if (!file.sha256) return { available: false, reason: 'Metadata only. This external file exceeds the content-processing limits; its contents are unavailable to the assistant.' }
  return { available: true }
}

export function projectFileStorageTotals(files: ProjectFileEntry[]): { embedded: { count: number; bytes: number }; linked: { count: number; bytes: number } } {
  return files.reduce((totals, file) => { const target = file.storage ? totals.linked : totals.embedded; target.count++; target.bytes += file.bytes; return totals }, { embedded: { count: 0, bytes: 0 }, linked: { count: 0, bytes: 0 } })
}
