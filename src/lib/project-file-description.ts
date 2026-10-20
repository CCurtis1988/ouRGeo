import type { ProjectFileEntry } from './project-files'

/** A description from an older extraction/disclosure revision is not current. */
export function projectFileDescription(file: ProjectFileEntry): string {
  return file.userDescription || (file.aiDescription?.revision === file.revision ? `AI description: ${file.aiDescription.text}` : '') || file.generatedDescription
}
