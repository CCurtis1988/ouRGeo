import type { ProjectFileLocation } from './project-files'

export interface ProjectFileCitation { projectId: string; id: string; revision: string; location?: ProjectFileLocation }
export function projectFileCitation(value: ProjectFileCitation): string {
  const portable = { projectId: value.projectId, id: value.id, revision: value.revision, ...(value.location ? { location: value.location } : {}) }
  return `ourgeo-project-file:${encodeURIComponent(JSON.stringify(portable))}`
}
export function parseProjectFileCitation(value: string): ProjectFileCitation | null {
  if (!value.startsWith('ourgeo-project-file:') || value.length > 4096) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice('ourgeo-project-file:'.length)))
    if (!parsed || typeof parsed.projectId !== 'string' || typeof parsed.id !== 'string' || typeof parsed.revision !== 'string') return null
    if (parsed.location !== undefined && !validProjectFileLocation(parsed.location)) return null
    return { projectId: parsed.projectId, id: parsed.id, revision: parsed.revision, ...(parsed.location ? { location: parsed.location } : {}) }
  } catch { return null }
}
export function validProjectFileLocation(value: unknown): value is ProjectFileLocation {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  switch (item.kind) {
    case 'lines': return positive(item.start) && positive(item.end) && item.end >= item.start && Object.keys(item).every(key => ['kind', 'start', 'end'].includes(key))
    case 'pdf': return positive(item.page) && (item.endPage === undefined || positive(item.endPage) && item.endPage >= item.page) && Object.keys(item).every(key => ['kind', 'page', 'endPage'].includes(key))
    case 'docx': return positive(item.section) && Object.keys(item).every(key => ['kind', 'section'].includes(key))
    case 'sheet': return typeof item.sheet === 'string' && item.sheet.length > 0 && item.sheet.length <= 255 && (item.range === undefined || typeof item.range === 'string' && /^[A-Z]+[1-9][0-9]*(?::[A-Z]+[1-9][0-9]*)?$/i.test(item.range)) && Object.keys(item).every(key => ['kind', 'sheet', 'range'].includes(key))
    case 'image': return Object.keys(item).length === 1
    default: return false
  }
}

/** Save As creates a distinct project namespace; portable citations follow the
 * copied originals while opaque live handles remain revoked by the caller. */
export function rebindProjectFileReferences<T>(value: T, from: string, to: string): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return item.replace(/ourgeo-project-file:[^\s)<>"']+/g, uri => {
      const citation = parseProjectFileCitation(uri)
      return citation?.projectId === from ? projectFileCitation({ ...citation, projectId: to }) : uri
    })
    if (Array.isArray(item)) return item.map(visit)
    if (!item || typeof item !== 'object') return item
    const object = item as Record<string, unknown>
    if (object.projectId === from && typeof object.id === 'string' && typeof object.revision === 'string') return { ...object, projectId: to }
    return Object.fromEntries(Object.entries(object).map(([key, nested]) => [key, visit(nested)]))
  }
  return visit(value) as T
}
