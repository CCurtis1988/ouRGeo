import type { ProjectFileExtraction } from '../../../src/lib/project-files'
import { runExtraction } from './worker-client'
import type { ExtractionOptions } from './extraction'
export { EXTRACTION_VERSION } from './extraction'
export type { ExtractionOptions } from './extraction'

export async function extractProjectFile(path: string, mediaType: string, signal?: AbortSignal, originalName?: string, options?: ExtractionOptions): Promise<ProjectFileExtraction> {
  return runExtraction(path, mediaType, signal, originalName, options)
}
