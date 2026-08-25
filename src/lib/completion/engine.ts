import type { ColumnInfo } from '@/lib/r-client'
import { analyzeContext, type Context } from './context'
import { analyzeMarkdownContext } from './context-markdown'
import { mdSlashCandidates, mdMatchTerms } from './markdown-keywords'
import { keywordCandidates, snippetCandidates } from './keywords'
import { fuzzyMatch } from './match'
import type { CompletionCandidate, CompletionMode, CompletionResult, EngineDeps, IndexedPackage } from './types'

const MAX_RESULTS = 60

/**
 * Produce ranked completion candidates for `text` at caret `offset`.
 * Pure and synchronous: async data (sf columns, formals) is read from the
 * cached getters in `deps`; anything missing is reported in `result.wants` so
 * the controller can fetch it and re-run.
 */
export function getCompletions(
  text: string,
  offset: number,
  deps: EngineDeps,
  mode: CompletionMode = 'r',
): CompletionResult {
  const { index } = deps
  const knownFrame = (name: string): boolean => !!index.byName.get(name)?.isDataFrame

  // Markdown analysis is a different world (prose, not R), and the default keeps
  // the R path byte-identical — which is what stops the shared console
  // controller from ever seeing markdown candidates.
  const ctx = mode === 'r'
    ? analyzeContext(text, offset, knownFrame)
    : analyzeMarkdownContext(text, offset, knownFrame, mode === 'rmarkdown')
  const wants: CompletionResult['wants'] = { columns: [], formals: [] }
  const empty: CompletionResult = { from: offset, to: offset, candidates: [], wants }

  if (ctx.type === 'none') return empty

  if (ctx.type === 'md-slash') {
    const raw = mdSlashCandidates(text, mode === 'rmarkdown')
    const terms = mdMatchTerms(mode === 'rmarkdown')
    return {
      from: ctx.from,
      to: ctx.to,
      candidates: rank(raw, ctx, terms),
      wants,
      // `/` with nothing typed still opens the menu.
      autoOpen: true,
    }
  }

  const raw: CompletionCandidate[] = []
  // A function is called with `()` unless the caret is already before one.
  const followedByParen = text[offset] === '('

  switch (ctx.type) {
    case 'member': {
      pushColumns(raw, ctx.object, deps, wants, ctx.quoted)
      break
    }
    case 'namespace': {
      for (const fn of index.functions) {
        if (fn.pkg === ctx.pkg) raw.push(functionCandidate(fn.name, fn.pkg, followedByParen))
      }
      break
    }
    case 'column': {
      for (const frame of ctx.frames) pushColumns(raw, frame, deps, wants, false)
      // Functions are common inside verbs (e.g. filter(str_detect(...))).
      pushFunctions(raw, deps, followedByParen, 3)
      break
    }
    case 'package': {
      for (const p of deps.getPackages()) raw.push(packageCandidate(p))
      break
    }
    case 'argument': {
      const formals = deps.getFormals(ctx.fn)
      if (formals === undefined) wants.formals.push(ctx.fn)
      else for (const a of formals) raw.push(argumentCandidate(a.name, a.default))
      pushObjects(raw, deps)
      pushFunctions(raw, deps, followedByParen, 4)
      break
    }
    case 'identifier': {
      pushObjects(raw, deps)
      pushFunctions(raw, deps, followedByParen, 4)
      raw.push(...snippetCandidates())
      raw.push(...keywordCandidates())
      break
    }
  }

  const candidates = rank(raw, ctx)
  return { from: ctx.from, to: ctx.to, candidates, wants }
}

function pushColumns(
  out: CompletionCandidate[],
  frame: string,
  deps: EngineDeps,
  wants: CompletionResult['wants'],
  quoted: boolean
): void {
  const obj = deps.index.byName.get(frame)
  const cols = deps.getColumns(frame, obj?.envName ?? '.GlobalEnv')
  if (cols === undefined) {
    // Unknown yet — request a lazy fetch if this could be a data frame.
    if (!obj || obj.isDataFrame) wants.columns.push({ name: frame, envName: obj?.envName ?? '.GlobalEnv' })
    return
  }
  for (const c of cols) out.push(columnCandidate(c, frame, quoted))
}

function pushObjects(out: CompletionCandidate[], deps: EngineDeps): void {
  for (const o of deps.index.objects) {
    out.push({
      id: `obj:${o.envName}:${o.name}`,
      label: o.name,
      insertText: o.name,
      kind: 'object',
      rType: o.rClass,
      detail: o.isDataFrame && o.columns ? `${o.columns.length} cols` : undefined,
      bias: 0,
    })
  }
}

function pushFunctions(
  out: CompletionCandidate[],
  deps: EngineDeps,
  followedByParen: boolean,
  bias: number
): void {
  for (const fn of deps.index.functions) out.push(functionCandidate(fn.name, fn.pkg, followedByParen, bias))
}

function functionCandidate(
  name: string,
  pkg: string | undefined,
  followedByParen: boolean,
  bias = 4
): CompletionCandidate {
  return {
    id: `fn:${pkg ?? ''}:${name}`,
    label: name,
    insertText: followedByParen ? name : `${name}()`,
    cursorOffset: followedByParen ? 0 : -1,
    kind: 'function',
    rType: 'function',
    detail: pkg,
    bias,
  }
}

function packageCandidate(p: IndexedPackage): CompletionCandidate {
  return {
    id: `pkg:${p.name}`,
    label: p.name,
    insertText: p.name,
    kind: 'package',
    rType: 'package',
    // Show version, flagging already-attached packages.
    detail: p.loaded ? `${p.version ? p.version + ' · ' : ''}loaded` : p.version,
    // Attached packages surface first; quoted vs bare doesn't change ranking.
    bias: p.loaded ? -1 : 0,
  }
}

function columnCandidate(col: ColumnInfo, frame: string, quoted: boolean): CompletionCandidate {
  return {
    id: `col:${frame}:${col.name}`,
    label: col.name,
    insertText: col.name,
    kind: 'column',
    rType: col.type,
    detail: frame,
    bias: quoted ? 0 : -1, // columns lead in their contexts
  }
}

function argumentCandidate(name: string, def: string): CompletionCandidate {
  return {
    id: `arg:${name}`,
    label: name,
    insertText: `${name} = `,
    kind: 'argument',
    rType: 'argument',
    detail: def || undefined,
    bias: -2,
  }
}

/** Filter by the typed prefix, then order by match quality, bias and length. */
function rank(
  raw: CompletionCandidate[],
  ctx: { prefix?: string },
  /** Extra terms to match against, beyond the label (slash-menu keywords). */
  terms?: Map<string, string[]>,
): CompletionCandidate[] {
  const prefix = 'prefix' in ctx ? (ctx.prefix ?? '') : ''
  const scored: CompletionCandidate[] = []
  const seen = new Set<string>()
  for (const c of raw) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    // Match on the label first so the highlight offsets stay meaningful; fall
    // back to keywords (`/todo` → "Task list") with a small score penalty.
    let m = fuzzyMatch(prefix, c.label)
    if (!m && terms) {
      for (const t of terms.get(c.id) ?? []) {
        const alt = fuzzyMatch(prefix, t)
        if (alt) { m = { score: alt.score - 50, matched: [] }; break }
      }
    }
    if (!m) continue
    scored.push({ ...c, score: m.score, matched: m.matched })
  }
  scored.sort((a, b) => {
    const bias = (a.bias ?? 0) - (b.bias ?? 0)
    // Bias groups the list (columns/args first); score orders within a group.
    if (bias !== 0 && (a.score ?? 0) < 500 && (b.score ?? 0) < 500) return bias
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0)
    if (bias !== 0) return bias
    if (a.label.length !== b.label.length) return a.label.length - b.label.length
    return a.label.localeCompare(b.label)
  })
  return scored.slice(0, MAX_RESULTS)
}
