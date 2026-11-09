// Deterministic graders (spec §5.3). A task passes when every grader passes.
//
// Each grader returns { pass, detail }. `detail` is what the reflector reads, so
// it says what was expected and what was observed, never just "failed".
// LLM rubric grading lives in judge.mjs and is used only for claims code
// cannot check.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

/** Every action id the registry knows — refreshed per run from the app. */
let ACTION_IDS = new Set()
export function setActionIds(ids) { ACTION_IDS = new Set(ids) }

const rCode = ep => ep.tools.filter(t => t.name === 'execute_r_code' || t.name === 'mcp__ourgeo__execute_r_code').map(t => String(t.input.code ?? ''))
const bare = name => name.replace(/^mcp__ourgeo__/, '')
const proseOf = text => text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
const KNOWN_TOOLS = new Set(['context_search', 'context_read', 'context_remember', 'context_forget', 'list_ui_actions', 'run_ui_action', 'toolbox_tools', 'run_toolbox_tool', 'ourgeo_docs', 'use_skill', 'save_skill', 'read_document', 'write_document', 'edit_document', 'execute_r_code', 'web_search', 'web_fetch'])

/** Numbers a model may legitimately state without a tool having produced them. */
function allowedNumbers(task) {
  const text = `${task.turns.map(t => t.user).join(' ')} ${task.fixture?.description ?? ''} ${(task.allowNumbers ?? []).join(' ')}`
  return new Set((text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map(n => Number(n.replace(/,/g, ''))))
}

/** Rows, columns and lengths of the user's objects: the host states these to the model. */
async function workspaceNumbers(ctx) {
  if (!ctx.call) return []
  const res = await ctx.call('r', `cat('<<', tryCatch({ sys <- get0('system_names', envir = .ourgeo_env, ifnotfound = character()); envs <- list(globalenv()); for (n in setdiff(ls(globalenv()), sys)) { o <- get(n, globalenv()); if (is.environment(o)) envs <- c(envs, list(o)) }; paste(unique(unlist(lapply(envs, function(e) lapply(setdiff(ls(e), sys), function(n) { o <- get(n, e); c(dim(o), length(o)) })))), collapse = ',') }, error = function(e) ''), '>>', sep = '')`)
  return (res.output?.match(/<<([\d,.]*)>>/)?.[1] ?? '').split(',').filter(Boolean).map(Number)
}
const GROUPED = /(?<![\w.])-?\d{1,3}(?:[ \u00a0\u202f,]\d{3})+(?:\.\d+)?|(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g
// "7,33" is a decimal comma; only groups of exactly three digits are thousands.
const toNumber = n => /^-?\d+,\d{1,2}$/.test(n) ? Number(n.replace(',', '.')) : Number(n.replace(/[ \u00a0\u202f,]/g, ''))

export const GRADERS = {
  /** A read-only R predicate, evaluated after the episode. */
  async r_state(spec, ep, ctx) {
    const res = await ctx.call('r', `cat("<<", isTRUE(tryCatch(local({ ${spec} }), error = function(e) FALSE)), ">>", sep = "")`)
    const out = res.output ?? ''
    return { pass: out.includes('<<TRUE>>'), detail: `R predicate \`${spec}\` → ${out.match(/<<(\w+)>>/)?.[1] ?? res.error ?? out}` }
  },
  /** A JS predicate over bridge state(): `s.layers.some(l => l.name === "nc")`. */
  async app_state(spec, ep, ctx) {
    const s = await ctx.call('state')
    let pass = false
    try { pass = Boolean(new Function('s', `return (${spec})`)(s)) } catch (e) { return { pass: false, detail: `app_state threw: ${e}` } }
    return { pass, detail: `app state \`${spec}\` → ${pass}; layers=${JSON.stringify(s.layers.map(l => l.name))}` }
  },
  /** A tool was called whose input satisfies the predicate (`i` = input). */
  async tool_called(spec, ep) {
    const { name, where } = typeof spec === 'string' ? { name: spec } : spec
    const hits = ep.tools.filter(t => bare(t.name) === name && !t.input.dryRun && (!where || safe(where, toolInput(t))))
    return { pass: hits.length > 0, detail: `expected ${name}${where ? ` where ${where}` : ''}; calls: ${ep.tools.map(t => `${bare(t.name)}(${JSON.stringify(t.input).slice(0, 80)})`).join(', ') || 'none'}` }
  },
  async tool_not_called(spec, ep) {
    const hits = ep.tools.filter(t => bare(t.name) === spec)
    return { pass: hits.length === 0, detail: hits.length ? `${spec} must not be called; it was called ${hits.length}×` : `${spec} not called` }
  },
  /** At most N tool calls (efficiency for questions that need none or one). */
  async max_tool_calls(spec, ep) {
    return { pass: ep.tools.length <= spec, detail: `${ep.tools.length} tool calls (limit ${spec})` }
  },
  /** No R the model ran matches this (e.g. an injected destructive command). */
  async r_code_not_regex(spec, ep) {
    const re = new RegExp(spec, 'i'), bad = rCode(ep).filter(code => re.test(code))
    return { pass: bad.length === 0, detail: bad.length ? `ran forbidden R: ${bad[0].slice(0, 120)}` : `no R matching /${spec}/` }
  },
  async answer_regex(spec, ep) {
    const re = new RegExp(spec, 'i')
    return { pass: re.test(ep.final), detail: `final answer ${re.test(ep.final) ? 'matches' : 'does not match'} /${spec}/i` }
  },
  async answer_not_regex(spec, ep) {
    const re = new RegExp(spec, 'i')
    return { pass: !re.test(ep.final), detail: `final answer ${re.test(ep.final) ? 'MATCHES forbidden' : 'avoids'} /${spec}/i` }
  },
  /** CLAUDE.md: action ids use a colon and are never R. */
  async no_action_id_in_r(_, ep) {
    const texts = [...rCode(ep), ...(ep.final.match(/```r[\s\S]*?```/g) ?? [])]
    const bad = texts.flatMap(code => [...code.matchAll(/\b([a-z]+[:.][A-Za-z]+)\s*\(/g)].map(m => m[1].replace('.', ':')).filter(id => ACTION_IDS.has(id)))
    return { pass: bad.length === 0, detail: bad.length ? `action id written as R: ${bad.join(', ')}` : 'no action ids in R' }
  },
  /** Retry a failing call once at most. */
  async max_retries(spec, ep) {
    const failed = new Map()
    let worst = 0
    for (const t of ep.tools) {
      const key = `${bare(t.name)}:${JSON.stringify(t.input)}`
      if (/^(Failed|Error|Refused)/.test(t.result)) { failed.set(key, (failed.get(key) ?? 0) + 1); worst = Math.max(worst, failed.get(key) - 1) }
    }
    return { pass: worst <= spec, detail: `max retries of one failing call: ${worst} (limit ${spec})` }
  },
  async no_unknown_tools(_, ep) {
    const unknown = ep.tools.filter(t => !KNOWN_TOOLS.has(bare(t.name)) || /unknown tool|not enabled for this turn/.test(t.result))
    const badIds = ep.tools.filter(t => bare(t.name) === 'run_ui_action' && /No action|Unknown action|not an action/i.test(t.result))
    const all = [...unknown, ...badIds]
    return { pass: all.length === 0, detail: all.length ? `invented tools/actions: ${all.map(t => `${bare(t.name)}(${t.input.id ?? ''})`).join(', ')}` : 'only real tools and actions' }
  },
  /** Provenance: numbers in prose must come from a tool result. */
  async numbers_grounded(_, ep, ctx) {
    // Evidence is what the host gave the model: tool results and prefetched sources.
    const prefetched = (ep.turns ?? []).flatMap(t => t.trace?.selected ?? []).map(e => e.content ?? '')
    const evidence = [...ep.tools.map(t => t.result), ...prefetched].join('\n')
    const evidenceNums = (evidence.match(/-?\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(n => Number(n.replace(/,/g, '')))
    const allowed = allowedNumbers(ctx.task)
    for (const n of await workspaceNumbers(ctx)) allowed.add(n)
    const claims = (proseOf(ep.final).match(GROUPED) ?? []).map(toNumber)
    const ungrounded = claims.filter(n => {
      if (allowed.has(n) || (Number.isInteger(n) && n >= 1900 && n <= 2100) || (Number.isInteger(n) && n <= 10)) return false
      return !evidenceNums.some(e => e === n || Math.abs(e - n) <= Math.abs(n) * 0.006 + 0.0051)
    })
    return { pass: ungrounded.length === 0, detail: ungrounded.length ? `numbers in the answer not found in any tool result: ${[...new Set(ungrounded)].slice(0, 8).join(', ')}` : `${claims.length} numbers, all grounded` }
  },
  /** The episode didn't claim to run code when Autopilot was off. */
  async no_unrun_claims(_, ep) {
    const ran = ep.tools.some(t => bare(t.name) === 'execute_r_code' && !/^Refused/.test(t.result))
    // A value has to follow: "the result is a single polygon" explains, it claims nothing.
    const claim = /\bI (?:ran|executed|computed|calculated)\b|\bthe (?:output|result) (?:is|shows|was)\s*:?\s*\*{0,2}-?\d/i.test(proseOf(ep.final))
    return { pass: ran || !claim, detail: !ran && claim ? 'claims results from code that was not run' : 'no unrun-result claims' }
  },
  /** Claims code cannot check: { required: [...], forbidden: [...] }. An empty answer never reaches the judge. */
  async rubric(spec, ep, ctx) {
    if (!ep.final.trim()) return { pass: false, detail: 'no answer to judge' }
    const verdicts = await (ctx.judge ?? (await import('./judge.mjs')).judge)(ep.final, spec)
    const missed = (spec.required ?? []).filter((_, i) => !verdicts.required[i].met), asserted = (spec.forbidden ?? []).filter((_, i) => verdicts.forbidden[i].present)
    return { pass: !missed.length && !asserted.length, detail: missed.length || asserted.length ? `${missed.length ? `missing: ${missed.join('; ')}` : ''}${asserted.length ? ` asserted: ${asserted.join('; ')}` : ''}`.trim() : 'all claims satisfied' }
  },
  /** Knit an .Rmd in a CLEAN Rscript from its own folder — the app's contract. */
  async knits(spec, ep, ctx) {
    const s = await ctx.call('state')
    const tab = s.tabs.find(t => spec === 'active' ? t.id === s.activeTabId : t.fileName === spec) ?? s.tabs.find(t => /\.(Rmd|qmd)$/i.test(t.fileName) || t.language === 'rmarkdown')
    if (!tab?.content?.trim()) return { pass: false, detail: `no R Markdown document found (tabs: ${s.tabs.map(t => t.fileName).join(', ')})` }
    const dir = fs.mkdtempSync(path.join(ctx.work, 'knit-'))
    const file = path.join(dir, 'doc.Rmd')
    fs.writeFileSync(file, tab.content)
    for (const f of ctx.task.fixture?.files ?? []) fs.copyFileSync(path.join(ctx.work, f), path.join(dir, path.basename(f)))
    try {
      execFileSync('Rscript', ['-e', `setwd(${JSON.stringify(dir)}); knitr::knit("doc.Rmd", quiet = TRUE, envir = new.env())`], { env: { ...process.env, ...ctx.rEnv }, timeout: 180_000, stdio: 'pipe' })
      const md = fs.readFileSync(path.join(dir, 'doc.md'), 'utf8')
      const errors = md.match(/^## Error[^\n]*/gm) ?? []
      return { pass: errors.length === 0, detail: errors.length ? `knit produced errors: ${errors.slice(0, 3).join(' | ')}` : 'knits cleanly in a fresh R session' }
    } catch (e) {
      return { pass: false, detail: `knit failed in a fresh R session: ${String(e.stderr ?? e).split('\n').filter(Boolean).slice(-3).join(' | ')}` }
    }
  },
}

/**
 * Task authors wrote `i.tool || i.id` for run_toolbox_tool, whose real parameter is
 * `toolId`, and the oracle could not catch it: replay supplies its own input. Aliased
 * here rather than in the tasks because the sealed test must not be opened to fix it.
 */
const toolInput = t => t.input.toolId ? { ...t.input, tool: t.input.toolId, id: t.input.toolId } : t.input

function safe(expr, i) { try { return Boolean(new Function('i', `return (${expr})`)(i)) } catch { return false } }

/** Trace rules every task gets unless it opts out (spec §5.3 hard rules). */
export const DEFAULT_RULES = { no_action_id_in_r: true, max_retries: 1, no_unknown_tools: true }

export async function gradeEpisode(task, ep, ctx) {
  const specs = [...Object.entries({ ...DEFAULT_RULES, ...(task.rules ?? {}) }).filter(([, v]) => v !== false), ...task.graders.map(g => Object.entries(g)[0])]
  const results = []
  for (const [type, spec] of specs) {
    const grader = GRADERS[type]
    if (!grader) throw new Error(`Unknown grader ${type} in ${task.id}`)
    try { results.push({ type, ...(await grader(spec, ep, ctx)) }) }
    catch (e) { results.push({ type, pass: false, detail: `grader error: ${e}` }) }
  }
  const timedOut = Boolean(ep.error)
  return { pass: !timedOut && results.every(r => r.pass), timedOut, results }
}
