// Stable chunk identity across edits.
//
// This is the crux of inline output: an id that survives typing, insertion,
// deletion and reordering, so a chunk's output stays attached to it.
//
// Rejected approaches:
//   * content hash — changes on every keystroke, throwing output away exactly
//     when the user is iterating on the chunk. Worse than the problem.
//   * positional index — inserting a chunk above shifts every id below it.
//
// What's used instead, in priority order: an explicit label (knitr already
// requires labels be unique per document, making it a perfect key), then exact
// code match, then a positional-similarity pass, then a fresh uuid. The ribbon
// auto-labels chunks it creates, so in practice almost everything takes path 1.
//
// Invariant: when a chunk's CODE changes, its id is preserved and its output is
// marked stale — never silently dropped.

import type { Chunk } from './chunks'
import { hashCode } from './chunks'

export interface IdentifiedChunk extends Chunk {
  /** True when the code changed since this id last ran. */
  codeChanged: boolean
}

/** Previous state the reconciler matches against. */
export interface PrevChunk {
  id: string
  label: string | null
  code: string
  index: number
}

const labelKey = (label: string): string => `label:${label}`

/**
 * Assign ids to the freshly-scanned chunks, reusing previous ids wherever the
 * chunk can be recognised.
 */
export function reconcileChunks(prev: PrevChunk[], next: Chunk[]): IdentifiedChunk[] {
  const out: IdentifiedChunk[] = new Array(next.length)
  const takenIds = new Set<string>()
  const unmatchedPrev = new Map<number, PrevChunk>()
  prev.forEach((p, i) => unmatchedPrev.set(i, p))

  const claim = (i: number, chunk: Chunk, id: string, prevCode: string | null): void => {
    takenIds.add(id)
    out[i] = { ...chunk, id, codeChanged: prevCode !== null && prevCode !== chunk.code }
  }

  // 1. Labelled chunks key off the label, which survives arbitrary edits and
  //    reordering. Duplicate labels are invalid knitr, so first wins.
  next.forEach((chunk, i) => {
    const label = chunk.header.label
    if (!label) return
    const id = labelKey(label)
    if (takenIds.has(id)) return
    const prevIdx = [...unmatchedPrev].find(([, p]) => p.id === id)?.[0]
    if (prevIdx !== undefined) unmatchedPrev.delete(prevIdx)
    claim(i, chunk, id, prevIdx !== undefined ? prev[prevIdx].code : null)
  })

  // 2. Unlabelled: exact code match, nearest previous index first — so a
  //    duplicated chunk claims the one it sat closest to.
  next.forEach((chunk, i) => {
    if (out[i]) return
    let best: number | undefined
    let bestDist = Infinity
    for (const [idx, p] of unmatchedPrev) {
      if (p.label !== null || p.code !== chunk.code || takenIds.has(p.id)) continue
      const dist = Math.abs(p.index - i)
      if (dist < bestDist) { bestDist = dist; best = idx }
    }
    if (best === undefined) return
    const p = prev[best]
    unmatchedPrev.delete(best)
    claim(i, chunk, p.id, p.code)
  })

  // 3. Edited-in-place: an unlabelled chunk at a similar position whose code has
  //    merely changed. This is what preserves output while a chunk is being
  //    typed. Guarded by a small positional window so unrelated chunks elsewhere
  //    in the document can't capture the id.
  next.forEach((chunk, i) => {
    if (out[i]) return
    let best: number | undefined
    let bestDist = Infinity
    for (const [idx, p] of unmatchedPrev) {
      if (p.label !== null || takenIds.has(p.id)) continue
      const dist = Math.abs(p.index - i)
      if (dist <= 1 && dist < bestDist) { bestDist = dist; best = idx }
    }
    if (best === undefined) return
    const p = prev[best]
    unmatchedPrev.delete(best)
    claim(i, chunk, p.id, p.code)
  })

  // 4. Genuinely new.
  next.forEach((chunk, i) => {
    if (out[i]) return
    let id = `anon:${hashCode(chunk.code + ':' + i)}`
    while (takenIds.has(id)) id = `anon:${hashCode(id)}`
    claim(i, chunk, id, null)
  })

  return out
}

/** Snapshot the current chunks as reconciler input for the next pass. */
export function toPrev(chunks: IdentifiedChunk[]): PrevChunk[] {
  return chunks.map((c) => ({
    id: c.id, label: c.header.label, code: c.code, index: c.index,
  }))
}
