import type { MemoryRecord } from './types'
import { memoryCandidate } from './learning'

const politePrefix = /^(?:please\s+|(?:can|could|would) you\s+(?:please\s+)?|I (?:want|would like) you to\s+)?/i
export function rememberIntent(text: string, savedProject = false): { statement: string; scope: 'project' | 'global'; followup?: true } | null {
  const command = text.trim().replace(politePrefix, '')
  const request = /^remember\s+(?:(globally|about me)\s+)?(?:that\s+)?([\s\S]+)$/i.exec(command)
  const body = request?.[2]?.trim()
  if (!body || /\b(?:for|in) (?:this|the current) (?:chat|conversation)\b/i.test(body) || /^(?:this|that|it)[.!?]*$/i.test(body) || /\b(?:do not|don['’]?t|never)\s+(?:remember|save|retain|store)\b/i.test(body)) return null
  const secondary = /(?:[.!?]\s+(?:now |then |also |can |could |please |help |generate |calculate |explain |make |create |show |run )|\s+and (?:then |also )?(?:please )?(?:help |generate |calculate |explain |make |create |show |run ))/i.exec(body)
  const statement = (secondary ? body.slice(0, secondary.index) : body).trim()
  const followup = secondary ? { followup: true as const } : {}
  if (/\b(?:for|in) this project\b/i.test(statement)) return { statement, scope: 'project', ...followup }
  if (request?.[1] || memoryCandidate(statement)?.scope === 'global' || /^I am (?:a |an )?(?:beginner|new to R|experienced|an expert)\b/i.test(statement)) return { statement, scope: 'global', ...followup }
  // A project definition or historical finding is not an implicit global
  // preference. Scratch needs a deliberate About you choice for other notes.
  return savedProject ? { statement, scope: 'project', ...followup } : null
}

/** An explicit saved-project instruction supplies its own retention intent.
 * Temporary instructions and quoted examples remain conversation material. */
export function projectInstruction(text: string): { statement: string; scope: 'project' } | null {
  const command = text.trim().replace(politePrefix, '')
  const convention = '(?:metric(?: units)?|imperial(?: units)?|miles|kilometres|metres|feet|hectares|acres|EPSG:\\d{3,6}|British English|American English|concise answers)'
  if (!new RegExp(`^(?:use ${convention} for this project|for this project[, :]+use ${convention})[.!]?$`, 'i').test(command)) return null
  const candidate = memoryCandidate(command)
  return candidate?.scope === 'project' && candidate.category === 'instruction' ? { statement: candidate.statement, scope: 'project' } : null
}

/** A deletion verb elsewhere in a data task does not authorise personal-memory
 * deletion. Ambiguity is resolved in the library, never by a model-selected ID. */
export function isForgetRequest(text: string): boolean {
  const command = text.trim().replace(politePrefix, '')
  return /^(?:forget\s+|(?:remove|delete)\s+(?:my\s+)?(?:memory|preference|decision)\s+)/i.test(command)
}

export function forgetIntent(text: string, records: MemoryRecord[]): MemoryRecord | null {
  const command = text.trim().replace(politePrefix, '')
  const request = /^forget\s+([\s\S]+)|^(?:remove|delete)\s+(?:my\s+)?(?:memory|preference|decision)\s+(?:about|for|that)?\s*([\s\S]+)/i.exec(command)
  if (!request) return null
  const query = request[1] ?? request[2]
  if (/\b(?:all|everything|everywhere)\b/i.test(query)) return null
  const ignored = new Set(['my', 'the', 'this', 'that', 'a', 'i', 'for', 'about', 'preference', 'memory', 'decision', 'prefer', 'remember', 'project', 'in', 'global', 'globally', 'me'])
  const words = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].filter(word => word.length > 1 && !ignored.has(word))
  if (!words.length) return null
  const scope = /\b(?:for|in) this project\b/i.test(text) ? 'project' : /\b(?:global|globally|about me)\b/i.test(text) ? 'global' : null
  const candidates = records.filter(record => ['active', 'candidate', 'superseded'].includes(record.status) && (!scope || record.scope === scope)
    && words.every(word => record.statement.toLocaleLowerCase().includes(word)))
  return candidates.length === 1 ? candidates[0] : null
}
