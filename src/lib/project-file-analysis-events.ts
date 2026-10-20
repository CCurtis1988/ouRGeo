// Explicit import/rescan requests trigger optional inference. Catalogue hydration
// and application startup never become permission to upload an existing library.
export interface ProjectFileAnalysisRequest { projectId: string; workspaceEpoch: number; ids: string[] }
const listeners = new Set<(request: ProjectFileAnalysisRequest) => void>()
export function requestProjectFileAnalysis(request: ProjectFileAnalysisRequest): void {
  if (request.ids.length) for (const listener of listeners) listener({ ...request, ids: [...new Set(request.ids)] })
}
export function subscribeProjectFileAnalysisRequests(listener: (request: ProjectFileAnalysisRequest) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
