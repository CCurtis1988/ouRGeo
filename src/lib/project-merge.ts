// Planning a three-way merge of two versions of a project
// (docs/project-persistence-spec.md §1.9). Pure: the flow that gathers the
// three versions and applies the result is lib/project-merge-flow.ts.
//
// The rule for every item, whole or textual, is the same three questions:
//   - do mine and theirs agree?            → nothing to decide
//   - did only theirs change it from base? → take theirs, and say so
//   - did only mine?                       → keep mine, and say so
//   - otherwise                            → the user decides
// A document both sides edited is merged line by line first, and only its
// overlapping hunks are left to decide.

import { merge3, conflictCount, type MergeSegment } from '@/lib/text-diff'
import type { MergeEnvItem } from '@/lib/r-client'

export type ItemKind = 'doc' | 'r' | 'layer' | 'plot' | 'chat' | 'file'
export type WholeChoice = 'mine' | 'theirs' | 'both'

export interface MergeItem<T = unknown> {
  kind: ItemKind
  key: string
  label: string
  base?: T
  mine?: T
  theirs?: T
  /** `auto-*`: one side changed it; `combined`: both edited a document in
   *  places that do not overlap; `conflict`: the user chooses. */
  status: 'auto-mine' | 'auto-theirs' | 'combined' | 'conflict'
  /** Documents edited on both sides: the line-level merge. */
  segments?: MergeSegment[]
}

const json = (value: unknown): string => JSON.stringify(value ?? null)

/** One kind of whole item, keyed. Unchanged-on-both-sides items are omitted. */
export function planKeyed<T>(
  kind: ItemKind,
  base: T[], mine: T[], theirs: T[],
  key: (item: T) => string, label: (item: T) => string,
  equal: (a: T | undefined, b: T | undefined) => boolean = (a, b) => json(a) === json(b),
): MergeItem<T>[] {
  const byKey = (list: T[]): Map<string, T> => new Map(list.map(item => [key(item), item]))
  const b = byKey(base), m = byKey(mine), t = byKey(theirs)
  const keys = [...new Set([...m.keys(), ...t.keys(), ...b.keys()])]
  const items: MergeItem<T>[] = []
  for (const k of keys) {
    const bi = b.get(k), mi = m.get(k), ti = t.get(k)
    if (equal(mi, ti)) continue
    const any = (mi ?? ti ?? bi) as T
    const item: MergeItem<T> = { kind, key: k, label: label(any), base: bi, mine: mi, theirs: ti, status: 'conflict' }
    if (equal(mi, bi)) item.status = 'auto-theirs'
    else if (equal(ti, bi)) item.status = 'auto-mine'
    items.push(item)
  }
  return items
}

export interface DocLike { id: string; fileName: string; content: string }

/** Documents: whole-item rules, then a line merge where both sides edited. */
export function planDocs<T extends DocLike>(base: T[], mine: T[], theirs: T[]): MergeItem<T>[] {
  return planKeyed('doc', base, mine, theirs, d => d.id, d => d.fileName, (a, b) => (a?.content ?? null) === (b?.content ?? null))
    .map(item => {
      if (item.status !== 'conflict' || !item.mine || !item.theirs) return item
      const segments = merge3(item.base?.content ?? '', item.mine.content, item.theirs.content)
      return { ...item, segments, status: conflictCount(segments) ? 'conflict' : 'combined' }
    })
}

/** R objects, from R's own comparison (r/lib/handlers-checkpoint.R). */
export function planR(items: MergeEnvItem[]): MergeItem<MergeEnvItem>[] {
  return items.filter(item => !item.mineEqTheirs).map(item => ({
    kind: 'r', key: item.name, label: item.name, base: item, mine: item, theirs: item,
    status: item.mineEqBase ? 'auto-theirs' : item.theirsEqBase ? 'auto-mine' : 'conflict',
  }))
}

/** The side an item resolves to: its automatic side, or the user's choice. */
export function resolvedSide(item: MergeItem, choice: WholeChoice | undefined): WholeChoice | null {
  if (item.status === 'auto-mine' || item.status === 'combined') return 'mine'
  if (item.status === 'auto-theirs') return 'theirs'
  return choice ?? null
}

/** Merge whole items into one list: mine's order first, then what only
 *  theirs has. `both` keeps theirs under its own key and adds mine renamed
 *  by `rename` — the `_mine` suffix (§1.9). */
export function mergeList<T>(
  mine: T[], theirs: T[], items: MergeItem<T>[], choices: Record<string, WholeChoice>,
  key: (item: T) => string, rename: (item: T, taken: Set<string>) => T,
): T[] {
  const decided = new Map(items.map(item => [item.key, resolvedSide(item, choices[`${item.kind}:${item.key}`]) ?? 'mine']))
  const theirsByKey = new Map(theirs.map(item => [key(item), item]))
  const out: T[] = []
  const taken = new Set<string>()
  const push = (item: T | undefined): void => { if (item) { out.push(item); taken.add(key(item)) } }
  for (const item of mine) {
    const k = key(item), side = decided.get(k)
    if (!side || side === 'mine') push(item)
    else if (side === 'theirs') push(theirsByKey.get(k))
    else { push(theirsByKey.get(k)); push(rename(item, taken)) }
  }
  for (const item of theirs) {
    const k = key(item)
    if (taken.has(k) || mine.some(m => key(m) === k)) continue
    const side = decided.get(k)
    if (side === 'theirs' || side === 'both') push(item)
  }
  return out
}

/** `name_mine`, then `name_mine_2`, … — never colliding with what is taken. */
export function mineName(name: string, taken: (candidate: string) => boolean): string {
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let n = 1, candidate = `${stem}_mine${ext}`
  while (taken(candidate)) candidate = `${stem}_mine_${++n}${ext}`
  return candidate
}

export function itemsNeedingChoice(items: MergeItem[], choices: Record<string, unknown>): MergeItem[] {
  return items.filter(item => item.status === 'conflict' && choices[`${item.kind}:${item.key}`] === undefined)
}
