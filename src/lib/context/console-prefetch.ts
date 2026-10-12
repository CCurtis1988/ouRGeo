import type { ContextSource } from './types'
import { prepareLexicalQuery, scoreLexicalQuery } from './router'

/** Resolve only a unique failure from local descriptions. Generic error words
 * must not make a noisy console pick an unrelated command for the user. */
export function consoleFailurePrefetch(sources: Iterable<ContextSource>, text: string): string[] {
  const failures = [...sources].filter(source => source.kind === 'console' && /^Fail(?:ure|ed)\b/u.test(source.title))
  if (failures.length === 1) return [failures[0].id]
  const query = prepareLexicalQuery(text.normalize('NFKC'))
  query.words = query.words.filter(word => !['help', 'fix', 'error', 'failed', 'failure', 'warning', 'debug', 'console', 'the', 'that', 'this', 'why', 'how', 'with', 'please'].includes(word))
  if (!query.words.length) return []
  query.text = query.words.join(' ')
  let winner: string | undefined, best = 0, tied = false
  for (const source of failures) {
    const score = scoreLexicalQuery(query, source.title.toLowerCase(), source.summary.toLowerCase())
    if (score > best) { best = score; winner = source.id; tied = false }
    else if (score === best) tied = true
  }
  return winner && !tied ? [winner] : []
}
