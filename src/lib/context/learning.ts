import { redactContext } from './policy'

export type LearningPolicy = 'asked' | 'suggest' | 'automatic'
export interface MemoryLearningSettings {
  globalLearning: LearningPolicy
  projectLearning: LearningPolicy
  scratchLearning: boolean
}
export const defaultLearning: MemoryLearningSettings = { globalLearning: 'suggest', projectLearning: 'suggest', scratchLearning: false }
export interface MemoryCandidate { scope: 'global' | 'project'; category: 'preference' | 'instruction' | 'decision'; statement: string }

/** Only narrow user-declared cues qualify. Assistant claims, copied source
 * prose, sensitive traits and data rows are never mined for a biography. This
 * zero-download path does not call an extractor or infer analytical findings. */
export function memoryCandidate(text: string): MemoryCandidate | null {
  const statement = text.trim().replace(/[.!]$/, '')
  if (!statement || statement.length > 500 || /[\r\n]/.test(statement) || redactContext(statement) !== statement
      || /\b(?:do not|don['’]?t|never)\s+(?:remember|save|keep this)\b/i.test(statement)
      || /\b(?:temporarily|for now|for today|for this (?:chat|conversation)|in this (?:chat|conversation)|until|only this (?:task|turn|answer|analysis))\b/i.test(statement)
      || /\b(?:password|token|credential|secret|diagnosis|religion|ethnicity|political|latitude|longitude)\b/i.test(statement)) return null
  if (/^(?:for this project[, :]+(?:use|keep|always)|use .+ for this project$|we (?:have )?decided (?:to|that)\b)/i.test(statement)) {
    return { scope: 'project', category: /^we /i.test(statement) ? 'decision' : 'instruction', statement }
  }
  if (!/^(?:I prefer|I always prefer|please always (?:use|write|give|respond))\b/i.test(statement)) return null
  const units = /\b(?:metric|imperial|metres|meters|kilometres|kilometers|miles|feet|hectares|acres|SI units)\b/i.test(statement)
  const communication = /\b(?:concise|brief|detailed|plain language|British English|American English|bullet points|step by step|large text)\b/i.test(statement)
  const formats = /\b(?:CSV|JSON|GeoPackage|Markdown|R Markdown|Quarto|PDF)\b/i.test(statement)
  return units || communication || formats ? { scope: 'global', category: 'preference', statement } : null
}

export function learningSettings(input: unknown): MemoryLearningSettings {
  const value = input && typeof input === 'object' ? input as Partial<MemoryLearningSettings> : {}
  const policy = (value: unknown, fallback: LearningPolicy): LearningPolicy => ['asked', 'suggest', 'automatic'].includes(String(value)) ? value as LearningPolicy : fallback
  return { globalLearning: policy(value.globalLearning, defaultLearning.globalLearning), projectLearning: policy(value.projectLearning, defaultLearning.projectLearning), scratchLearning: value.scratchLearning === true }
}
