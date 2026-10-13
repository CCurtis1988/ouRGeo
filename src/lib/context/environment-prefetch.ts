import type { ContextSource } from './types'

/** Resolve named objects without requiring composer brackets. A bare name
 * shared by environments remains ambiguous and requires explicit discovery. */
export function environmentPrefetch(sources: ContextSource[], text: string): string[] {
  const brackets = [...text.matchAll(/\[([^\]\n]+)\]/g)].map(match => match[1])
  const mentioned = (name: string): boolean => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\p{L}\\p{N}_.:])${escaped}(?![\\p{L}\\p{N}_:]|[.][\\p{L}\\p{N}_])`, 'u').test(text)
  }
  const ids: string[] = []
  for (const source of sources) {
    const name = source.resource?.name
    if (!name || !text.includes(name)) continue
    const qualified = brackets.includes(source.title) || mentioned(source.title)
    const bare = brackets.includes(name) || mentioned(name)
    if (qualified || bare && sources.filter(candidate => candidate.resource?.name === name).length === 1) ids.push(source.id)
    if (ids.length === 2) break
  }
  return ids
}
