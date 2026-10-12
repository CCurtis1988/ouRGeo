import type { PreflightInput, PreflightRequest, PreflightReport } from './data-preflight-types'
import { inspectRequest, executeChecked } from './data-preflight'

export interface VectorExportOptions {
  format: 'gpkg' | 'geojson'
  path: string
  layer: string
  mode: 'new' | 'add' | 'replace'
  precision: string
  omitFields: string
  textFields: string
}
export function vectorExportRequest(input: PreflightInput, options: VectorExportOptions): PreflightRequest {
  const { format, ...parameters } = options
  return { operationType: `export-${format}`, inputs: [input], parameters }
}
export async function exportVector(request: PreflightRequest, onProgress?: (report: PreflightReport) => void, signal?: AbortSignal, isCurrent: () => boolean = () => true) {
  const report = await inspectRequest(request, onProgress, signal)
  return executeChecked(report, isCurrent, onProgress, signal)
}
