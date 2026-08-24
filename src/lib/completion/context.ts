import { AES_VERBS, MASKING_VERBS, PACKAGE_ARG_FNS, PACKAGE_MULTIARG_FNS } from './keywords'

/**
 * The syntactic situation at the cursor, used by the engine to pick sources.
 * `from`/`to` bound the token to be replaced by the accepted completion.
 */
export type Context =
  | { type: 'none' }
  | { type: 'identifier'; prefix: string; from: number; to: number }
  | {
      type: 'member'
      object: string
      prefix: string
      from: number
      to: number
      quoted: boolean
    }
  | { type: 'namespace'; pkg: string; prefix: string; from: number; to: number }
  | { type: 'column'; frames: string[]; prefix: string; from: number; to: number }
  | { type: 'argument'; fn: string; prefix: string; from: number; to: number }
  | { type: 'package'; prefix: string; from: number; to: number; quoted: boolean }

const IDENT = /[A-Za-z0-9._]/
const WORD_LEFT = /[A-Za-z0-9._]*$/

interface ScanState {
  /** 1 where a character sits inside a string literal or comment */
  mask: Uint8Array
  inString: boolean
  inComment: boolean
  stringStart: number
}

/** One forward pass: build a string/comment mask and capture state at `offset`. */
function scan(text: string, offset: number): ScanState {
  const mask = new Uint8Array(text.length)
  let inString = false
  let quote = ''
  let inComment = false
  let stringStart = -1
  let atInString = false
  let atInComment = false
  let atStringStart = -1

  for (let i = 0; i < text.length; i++) {
    if (i === offset) {
      atInString = inString
      atInComment = inComment
      atStringStart = stringStart
    }
    const ch = text[i]
    if (inComment) {
      mask[i] = 1
      if (ch === '\n') inComment = false
      continue
    }
    if (inString) {
      mask[i] = 1
      if (ch === '\\') {
        if (i + 1 < text.length) mask[i + 1] = 1
        i++
        continue
      }
      if (ch === quote) {
        inString = false
        quote = ''
      }
      continue
    }
    if (ch === '#') {
      inComment = true
      mask[i] = 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true
      quote = ch
      stringStart = i
      mask[i] = 1
      continue
    }
  }
  if (offset >= text.length) {
    atInString = inString
    atInComment = inComment
    atStringStart = stringStart
  }
  return { mask, inString: atInString, inComment: atInComment, stringStart: atStringStart }
}

/** Read an R identifier ending at `end` (exclusive), skipping leading spaces. */
function readIdentLeft(text: string, end: number): { name: string; start: number } {
  let i = end
  while (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) i--
  const wordEnd = i
  while (i > 0 && IDENT.test(text[i - 1])) i--
  return { name: text.slice(i, wordEnd), start: i }
}

/** Index of the '(' of the call directly enclosing `pos`, or -1. Mask-aware. */
function enclosingOpenParen(text: string, pos: number, mask: Uint8Array): number {
  let depth = 0
  for (let i = pos - 1; i >= 0; i--) {
    if (mask[i]) continue
    const ch = text[i]
    if (ch === ')' || ch === ']' || ch === '}') depth++
    else if (ch === '(') {
      if (depth === 0) return i
      depth--
    } else if (ch === '[' || ch === '{') {
      if (depth === 0) return -1
      depth--
    }
  }
  return -1
}

/** Index of the '(' matching the ')' at `closeIdx`, or -1. */
function matchOpen(text: string, closeIdx: number, mask: Uint8Array): number {
  let depth = 0
  for (let i = closeIdx; i >= 0; i--) {
    if (mask[i]) continue
    const ch = text[i]
    if (ch === ')') depth++
    else if (ch === '(') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Climb the pipe/verb chain to the left of `end` and return the head data
 * identifier — e.g. for `df |> group_by(x) |> filter(` returns `df`.
 */
function resolvePipeSource(text: string, end: number, mask: Uint8Array): string | null {
  let i = end
  for (let guard = 0; guard < 64; guard++) {
    while (i > 0 && /\s/.test(text[i - 1])) i--
    if (i <= 0) return null
    const j = i - 1
    if (mask[j]) {
      i = j
      continue
    }
    const ch = text[j]
    // magrittr / native pipe to the left?
    if (ch === '>' && j > 0 && text[j - 1] === '|') {
      i = j - 1
      continue
    }
    if (ch === '%' && j >= 2 && text[j - 1] === '>' && text[j - 2] === '%') {
      i = j - 2
      continue
    }
    if (ch === ')') {
      const open = matchOpen(text, j, mask)
      if (open < 0) return null
      const verb = readIdentLeft(text, open)
      i = verb.name ? verb.start : open
      continue
    }
    if (IDENT.test(ch)) {
      const id = readIdentLeft(text, i)
      return id.name || null
    }
    return null
  }
  return null
}

/** First positional (or `data =`) argument identifier of a call opened at `open`. */
function firstArgIdent(text: string, open: number): string | null {
  let i = open + 1
  while (i < text.length && /\s/.test(text[i])) i++
  const start = i
  while (i < text.length && IDENT.test(text[i])) i++
  const tok = text.slice(start, i)
  if (!tok) return null
  let k = i
  while (k < text.length && /\s/.test(text[k])) k++
  const next = text[k]
  if (next === ',' || next === ')') return tok
  if (next === '=' && text[k + 1] !== '=') {
    // named arg: `data = frame` is the common form we can resolve.
    if (tok !== 'data' && tok !== 'x' && tok !== '.data') return null
    let m = k + 1
    while (m < text.length && /\s/.test(text[m])) m++
    const s = m
    while (m < text.length && IDENT.test(text[m])) m++
    return text.slice(s, m) || null
  }
  return null
}

/** True if the current argument segment already contains a top-level `=`. */
function currentArgHasEquals(text: string, open: number, cursor: number, mask: Uint8Array): boolean {
  let depth = 0
  let segStart = open + 1
  for (let i = open + 1; i < cursor; i++) {
    if (mask[i]) continue
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0 && ch === ',') segStart = i + 1
  }
  for (let i = segStart; i < cursor; i++) {
    if (mask[i]) continue
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (
      depth === 0 &&
      ch === '=' &&
      text[i - 1] !== '=' &&
      text[i - 1] !== '!' &&
      text[i - 1] !== '<' &&
      text[i - 1] !== '>' &&
      text[i + 1] !== '='
    )
      return true
  }
  return false
}

/** Count top-level (unparenthesized) commas between `open` and `cursor`. */
function topLevelCommaCount(text: string, open: number, cursor: number, mask: Uint8Array): number {
  let depth = 0
  let count = 0
  for (let i = open + 1; i < cursor; i++) {
    if (mask[i]) continue
    const ch = text[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0 && ch === ',') count++
  }
  return count
}

/**
 * True if a package name is completable at `cursor` inside the call opened at
 * `open` with head `verb`: the verb takes a package argument, and the cursor is
 * in an eligible slot (first positional arg, or any arg for multi-package fns).
 */
function isPackageArgSlot(
  text: string,
  open: number,
  verb: string,
  cursor: number,
  mask: Uint8Array
): boolean {
  const multi = PACKAGE_MULTIARG_FNS.has(verb)
  if (!multi && !PACKAGE_ARG_FNS.has(verb)) return false
  return multi || topLevelCommaCount(text, open, cursor, mask) === 0
}

/**
 * Analyze the completion context at `offset` within `text`.
 * `knownFrame` reports whether an identifier is a data-frame in scope, so the
 * frame resolver can discard non-frame receivers.
 */
export function analyzeContext(
  text: string,
  offset: number,
  knownFrame: (name: string) => boolean
): Context {
  const st = scan(text, offset)
  const before = text.slice(0, offset)

  // Current identifier token under the cursor.
  const wordMatch = before.match(WORD_LEFT)
  const prefix = wordMatch ? wordMatch[0] : ''
  const from = offset - prefix.length
  const to = offset

  // Inside a string: only the `obj[["partial` column form is completable.
  if (st.inString) {
    const q = st.stringStart
    let k = q
    while (k > 0 && /\s/.test(text[k - 1])) k--
    if (k >= 2 && text[k - 1] === '[' && text[k - 2] === '[') {
      const obj = readIdentLeft(text, k - 2)
      if (obj.name) {
        return {
          type: 'member',
          object: obj.name,
          prefix: text.slice(q + 1, offset),
          from: q + 1,
          to: offset,
          quoted: true,
        }
      }
    }
    // A quoted package name: require("sf"), install.packages("dplyr"), etc.
    const strOpen = enclosingOpenParen(text, q, st.mask)
    if (strOpen >= 0) {
      const v = readIdentLeft(text, strOpen)
      if (v.name && isPackageArgSlot(text, strOpen, v.name, q, st.mask)) {
        return { type: 'package', prefix: text.slice(q + 1, offset), from: q + 1, to: offset, quoted: true }
      }
    }
    return { type: 'none' }
  }
  if (st.inComment) return { type: 'none' }

  // `obj$partial` — member access.
  if (from > 0 && text[from - 1] === '$' && text[from - 2] !== '$') {
    const obj = readIdentLeft(text, from - 1)
    if (obj.name) {
      return { type: 'member', object: obj.name, prefix, from, to, quoted: false }
    }
  }

  // `pkg::partial` / `pkg:::partial` — namespace access.
  if (from >= 2 && text[from - 1] === ':' && text[from - 2] === ':') {
    let colonStart = from - 2
    if (colonStart > 0 && text[colonStart - 1] === ':') colonStart--
    const pkg = readIdentLeft(text, colonStart)
    if (pkg.name) return { type: 'namespace', pkg: pkg.name, prefix, from, to }
  }

  // Inside a call: dplyr/ggplot column context, or generic argument position.
  const open = enclosingOpenParen(text, from, st.mask)
  if (open >= 0) {
    const verb = readIdentLeft(text, open)
    // library(dplyr) / require(sf) — bare package name.
    if (verb.name && isPackageArgSlot(text, open, verb.name, offset, st.mask)) {
      return { type: 'package', prefix, from, to, quoted: false }
    }
    if (verb.name && (MASKING_VERBS.has(verb.name) || AES_VERBS.has(verb.name))) {
      const frames = resolveFrames(text, open, verb.name, verb.start, st.mask, knownFrame)
      if (frames.length > 0) return { type: 'column', frames, prefix, from, to }
    }
    if (verb.name && !currentArgHasEquals(text, open, offset, st.mask)) {
      return { type: 'argument', fn: verb.name, prefix, from, to }
    }
  }

  return { type: 'identifier', prefix, from, to }
}

/** Collect in-scope data-frame identifiers feeding a masking/aes call. */
function resolveFrames(
  text: string,
  open: number,
  verb: string,
  verbStart: number,
  mask: Uint8Array,
  knownFrame: (name: string) => boolean
): string[] {
  const out: string[] = []
  const add = (n: string | null): void => {
    if (n && knownFrame(n) && !out.includes(n)) out.push(n)
  }

  add(resolvePipeSource(text, verbStart, mask))
  add(firstArgIdent(text, open))

  // aes(...) inside ggplot(frame, ...) — climb to the ggplot data argument.
  if (AES_VERBS.has(verb)) {
    const outerOpen = enclosingOpenParen(text, verbStart, mask)
    if (outerOpen >= 0) {
      const outer = readIdentLeft(text, outerOpen)
      add(firstArgIdent(text, outerOpen))
      if (outer.name) add(resolvePipeSource(text, outer.start, mask))
    }
  }
  return out
}
