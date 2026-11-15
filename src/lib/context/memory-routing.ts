import { memoryRelevance } from './preferences'
import type { ContextSource } from './types'

/**
 * The saved memories to read at the start of a turn: the ones that fit this
 * request, best first, project before personal, newest first on a tie.
 *
 * This runs on every message. It used to run only when the message contained a
 * memory keyword ("remember", "prefer", "units", "format", …), so a plain request
 * such as "draw a histogram of depth" never brought in "Always make all plots
 * dark themed", and the model followed the memory only when it happened to search
 * for it (18–25% of the time; docs/context-memory-diagnosis.md). Scoring a few
 * short local statements costs nothing, and a request that fits no memory still
 * selects none, so unrelated turns stay free of memories.
 */
export function turnStartMemories(text: string, memories: Iterable<ContextSource>, limit = 2): string[] {
  return [...memories]
    .map(source => ({ source, score: memoryRelevance(text, source.title, source.summary) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score
      || (a.source.scope === 'project' ? -1 : 1) - (b.source.scope === 'project' ? -1 : 1)
      || String(b.source.timestamp).localeCompare(String(a.source.timestamp)))
    .slice(0, limit)
    .map(candidate => candidate.source.id)
}
