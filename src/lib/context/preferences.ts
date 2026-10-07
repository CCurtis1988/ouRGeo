import type { MemoryRecord } from './types'
import { lexicalScore } from './router'

/** Routing categories describe working conventions, not personal traits. They
 * never broaden source access and keep unrelated turns free of a profile. */
export function preferenceCategories(text: string): string[] {
  const categories: string[] = []
  if (/\b(?:units?|metric|imperial|metres?|meters?|kilometres?|kilometers?|miles?|feet|distance|length|area|hectares?|acres?|buffer)\b/i.test(text)) categories.push('units')
  if (/\b(?:concise|brief|detailed|plain language|British English|American English|bullet points|step by step|large text|writing style|explain|explanation)\b/i.test(text)) categories.push('communication')
  if (/\b(?:CSV|JSON|GeoPackage|Markdown|R Markdown|Quarto|PDF|output format|export format)\b/i.test(text)) categories.push('formats')
  if (/\b(?:CRS|EPSG|coordinate reference system|projection)\b/i.test(text)) categories.push('crs')
  return categories
}

/** Supersession needs a single, unambiguous setting. "Metric with miles in
 * parentheses" and arbitrary prose stay separate rather than being guessed
 * away. Project and global instructions are compared only in their own scope. */
export function preferenceSetting(text: string): { key: string; value: string } | null {
  if (!/^(?:I (?:always )?prefer|(?:please )?(?:always )?use|for this project[, :]+use)\b/i.test(text.trim())
      || /\b(?:not|never|don['’]?t|except|temporarily|for now|until)\b/i.test(text)) return null
  const values = [
    { key: 'unit-system', values: ['metric', 'imperial'] },
    { key: 'english-variant', values: ['British English', 'American English'] },
  ]
  for (const setting of values) {
    const matches = setting.values.filter(value => new RegExp(`\\b${value}\\b`, 'i').test(text))
    if (matches.length === 1 && /\b(?:prefer|use|always|units|English)\b/i.test(text)) return { key: setting.key, value: matches[0].toLowerCase() }
  }
  return null
}

export function applyMemoryRevision(records: MemoryRecord[], incoming: MemoryRecord): { record: MemoryRecord; records: MemoryRecord[]; changed: MemoryRecord[] } {
  const setting = incoming.status === 'active' && incoming.assertion === 'user-declared' ? preferenceSetting(incoming.statement) : null
  const superseded = setting ? records.filter(record => {
    const previous = preferenceSetting(record.statement)
    return record.id !== incoming.id && record.status === 'active' && record.assertion === 'user-declared'
      && record.scope === incoming.scope && record.projectId === incoming.projectId
      && previous?.key === setting.key && previous.value !== setting.value
  }) : []
  const ids = new Set(superseded.map(record => record.id))
  const record = { ...incoming, supersedes: [...new Set([...incoming.supersedes, ...ids])] }
  if (record.supersedes.length > 32) throw new Error('More than 32 conflicting preferences need review. Forget obsolete records in the Memory library before saving this replacement.')
  const changed = superseded.map(previous => ({ ...previous, status: 'superseded' as const, revision: previous.revision + 1, updatedAt: incoming.updatedAt }))
  const replacements = new Map(changed.map(previous => [previous.id, previous]))
  return { record, records: [...records.filter(previous => previous.id !== incoming.id).map(previous => replacements.get(previous.id) ?? previous), record], changed }
}

export function preferenceMatch(query: string, statement: string): boolean {
  const categories = preferenceCategories(query)
  return categories.some(category => preferenceCategories(statement).includes(category))
}

export function memoryRelevance(query: string, title: string, summary: string): number {
  // "this project" appears in many instructions; it cannot outweigh the
  // convention actually needed for a distance or CRS question.
  const stop = new Set(['a', 'an', 'the', 'this', 'that', 'my', 'our', 'your', 'in', 'for', 'of', 'to', 'we', 'did', 'do', 'is', 'are', 'was', 'what', 'which', 'why', 'how', 'i', 'use', 'used', 'project', 'please'])
  const words = (query.match(/[\p{L}\p{N}_.:$-]+/gu) ?? []).filter(word => !stop.has(word.toLowerCase())).join(' ')
  return (preferenceMatch(query, `${title} ${summary}`) ? 40 : 0) + (words ? lexicalScore(words, title, summary) : 0)
}
