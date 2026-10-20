// Line diffs and three-way merge, for documents (docs/project-persistence-spec.md
// §1.9, §2.4). Pure: no editor, no store.
//
// The diff is the classic longest-common-subsequence one after trimming the
// common prefix and suffix, which is where nearly all of a real edit's lines
// are. A pathological pair (both sides still thousands of lines different
// after trimming) is reported as one replaced block rather than spending
// seconds on a table: for a merge that only means the user resolves one larger
// hunk by hand, which is honest, never wrong.

export const splitLines = (text: string): string[] => text === '' ? [] : text.split(/\r?\n/)

/** One change: `base[start, end)` replaced by `lines`. */
export interface Change { start: number; end: number; lines: string[] }

const MAX_TABLE = 4_000_000

export function diffLines(a: string[], b: string[]): Change[] {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const am = a.slice(prefix, a.length - suffix), bm = b.slice(prefix, b.length - suffix)
  if (!am.length && !bm.length) return []
  if (!am.length || !bm.length || am.length * bm.length > MAX_TABLE) return [{ start: prefix, end: prefix + am.length, lines: bm }]
  // LCS lengths, suffix-wise, so the walk below can go forwards.
  const n = am.length, m = bm.length, w = m + 1
  const table = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i * w + j] = am[i] === bm[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1])
  }
  const changes: Change[] = []
  let i = 0, j = 0, open: Change | null = null
  const close = (): void => { if (open) { changes.push(open); open = null } }
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) { close(); i++; j++; continue }
    open ??= { start: prefix + i, end: prefix + i, lines: [] }
    if (j < m && (i >= n || table[i * w + j + 1] >= table[(i + 1) * w + j])) { open.lines.push(bm[j]); j++ }
    else { open.end++; i++ }
  }
  close()
  return changes
}

export function diffStats(before: string, after: string): { added: number; removed: number } {
  let added = 0, removed = 0
  for (const change of diffLines(splitLines(before), splitLines(after))) { added += change.lines.length; removed += change.end - change.start }
  return { added, removed }
}

/** A stretch of the merged document: agreed text, or a conflict to resolve. */
export type MergeSegment =
  | { kind: 'text'; lines: string[] }
  | { kind: 'conflict'; base: string[]; mine: string[]; theirs: string[] }

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((line, i) => line === b[i])

/**
 * Three-way merge. Changes made on only one side are taken; changes made the
 * same way on both are taken once; overlapping different changes become a
 * conflict carrying all three versions of that stretch.
 */
export function merge3(base: string, mine: string, theirs: string): MergeSegment[] {
  const b = splitLines(base), m = splitLines(mine), t = splitLines(theirs)
  const cm = diffLines(b, m).map(c => ({ ...c, side: 'mine' as const }))
  const ct = diffLines(b, t).map(c => ({ ...c, side: 'theirs' as const }))
  const all = [...cm, ...ct].sort((x, y) => x.start - y.start || x.end - y.end)
  const segments: MergeSegment[] = []
  const pushText = (lines: string[]): void => {
    if (!lines.length) return
    const last = segments[segments.length - 1]
    if (last?.kind === 'text') last.lines.push(...lines)
    else segments.push({ kind: 'text', lines: [...lines] })
  }
  // Apply one side's changes to a base range, for that side's view of a group.
  const view = (changes: Change[], from: number, to: number): string[] => {
    const out: string[] = []
    let at = from
    for (const change of changes) { out.push(...b.slice(at, change.start), ...change.lines); at = change.end }
    out.push(...b.slice(at, to))
    return out
  }
  let cursor = 0, k = 0
  while (k < all.length) {
    // A group: changes whose base ranges overlap or touch. Touching counts,
    // as it does in git: two edits to adjacent lines are one decision. One
    // side's own changes never touch each other — the diff separates them by
    // at least one unchanged line — so only the other side can join them.
    const start = all[k].start
    let end = all[k].end
    const group = [all[k++]]
    while (k < all.length && all[k].start <= end) { end = Math.max(end, all[k].end); group.push(all[k++]) }
    pushText(b.slice(cursor, start))
    const mineChanges = group.filter(c => c.side === 'mine'), theirChanges = group.filter(c => c.side === 'theirs')
    const mineView = view(mineChanges, start, end), theirView = view(theirChanges, start, end)
    if (!theirChanges.length) pushText(mineView)
    else if (!mineChanges.length) pushText(theirView)
    else if (same(mineView, theirView)) pushText(mineView)
    else segments.push({ kind: 'conflict', base: b.slice(start, end), mine: mineView, theirs: theirView })
    cursor = end
  }
  pushText(b.slice(cursor))
  return segments
}

export type HunkChoice = 'mine' | 'theirs' | 'both' | { edited: string }

/** Join merged segments into text, resolving each conflict in order. */
export function resolveMerge(segments: MergeSegment[], choices: HunkChoice[]): string {
  const out: string[] = []
  let c = 0
  for (const segment of segments) {
    if (segment.kind === 'text') { out.push(...segment.lines); continue }
    const choice = choices[c++] ?? 'mine'
    if (choice === 'mine') out.push(...segment.mine)
    else if (choice === 'theirs') out.push(...segment.theirs)
    else if (choice === 'both') out.push(...segment.mine, ...segment.theirs)
    else out.push(...splitLines(choice.edited))
  }
  return out.join('\n')
}

export const conflictCount = (segments: MergeSegment[]): number => segments.filter(s => s.kind === 'conflict').length
