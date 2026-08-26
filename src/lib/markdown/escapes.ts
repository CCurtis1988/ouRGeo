// Take back the backslashes the markdown serializer did not need.
//
// remark-stringify escapes defensively: every `_`, `*` and `~` in a text node
// comes back with a backslash in front of it, whether or not it could have
// meant anything. For prose that is invisible noise. For an R Markdown document
// it is destructive in a way users notice immediately — `geom_line()` written in
// a sentence returns from Visual mode as `geom\_line()`, and a paragraph about
// `earthquake_url` turns into `earthquake\_url`. Nothing rendered differently;
// the source just quietly filled up with backslashes every time the user looked
// at the document in Visual mode.
//
// The safe way to remove an escape is not to reason about flanking rules — it is
// to try it and check. An escape may go if and only if the document still parses
// to the same tree without it, which is exactly the invariant the round-trip
// guard already uses. `x*y*z` keeps its backslashes (unescaped it becomes
// emphasis); `geom_line()` loses them (intraword `_` is not emphasis in
// CommonMark, so the tree is unchanged).

import { structuralSignature } from './remark'

/**
 * Escapes worth reconsidering.
 *
 * Deliberately not every ASCII punctuation mark: this is aimed at the ones that
 * turn up inside identifiers and prose, where a stray backslash is both common
 * and ugly. A backslash before a backslash is never touched — removing it would
 * change the text itself rather than just its escaping.
 */
const CANDIDATE_CHARS = new Set(['_', '*', '~', '`', '#', '.', '-', '+', '(', ')', '[', ']', '<', '>', '!', '&', '"', "'", '$', '%', ',', ':', ';', '=', '?', '@', '^', '{', '}', '|', '/'])

/** Ceiling on the per-group pass, which costs one parse per group. */
const MAX_GROUPS = 400

/** Offsets of the backslashes that are candidates for removal, left to right. */
function candidateEscapes(md: string): number[] {
  const out: number[] = []
  for (let i = 0; i < md.length - 1; i++) {
    if (md[i] !== '\\') continue
    const next = md[i + 1]
    // `\\` is a literal backslash: skip the pair outright so the second one is
    // never mistaken for the start of another escape.
    if (next === '\\') { i++; continue }
    if (CANDIDATE_CHARS.has(next)) out.push(i)
  }
  return out
}

/** Remove the backslashes at `positions` (which must be ascending). */
function without(md: string, positions: number[]): string {
  if (positions.length === 0) return md
  let out = ''
  let prev = 0
  for (const p of positions) {
    out += md.slice(prev, p)
    prev = p + 1
  }
  return out + md.slice(prev)
}

/**
 * Group the candidates by the line they are on and the character they escape.
 *
 * A group is all-or-nothing, and that is the point: `\_id\_` must keep both
 * backslashes or lose both, because dropping only the second leaves `\_id_`,
 * which means the same thing today but reads as a mistake and turns into
 * emphasis the moment somebody tidies up the remaining backslash. Whole groups
 * also keep the common case whole — a line of prose whose only escapes are the
 * underscores inside `geom_line()` is one group, and it goes in one step.
 */
function groupCandidates(md: string, positions: number[]): number[][] {
  const groups = new Map<string, number[]>()
  let line = 0
  let scanned = 0
  for (const p of positions) {
    for (; scanned < p; scanned++) if (md[scanned] === '\n') line++
    const key = `${line}:${md[p + 1]}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(p)
    else groups.set(key, [p])
  }
  return [...groups.values()]
}

/**
 * Drop every backslash the document does not need.
 *
 * Structure-preserving by construction: nothing is removed unless the result
 * parses to the same tree. The common case — a document where no escape was
 * load-bearing — costs two parses, because they are all tried at once first.
 * Only when that batch would change the meaning does it fall back to trying
 * each line's escapes of each character as its own group.
 */
export function minimizeEscapes(md: string): string {
  const positions = candidateEscapes(md)
  if (positions.length === 0) return md

  const target = structuralSignature(md)

  const all = without(md, positions)
  if (structuralSignature(all) === target) return all

  // Something in there was doing real work. Keep the groups that survive,
  // testing each against the removals already accepted so neighbours that only
  // work together are not split apart.
  const accepted: number[] = []
  // Each group costs a parse, so a pathological document is capped rather than
  // allowed to stall the mode switch. Past the cap the escapes simply stay:
  // the result is still correct, just less tidy.
  for (const group of groupCandidates(md, positions).slice(0, MAX_GROUPS)) {
    const merged = [...accepted, ...group].sort((a, b) => a - b)
    if (structuralSignature(without(md, merged)) === target) accepted.push(...group)
  }
  return without(md, accepted.sort((a, b) => a - b))
}
