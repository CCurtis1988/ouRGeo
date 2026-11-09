// The pure parts of the optimiser (spec §7.3), apart from optimize.mjs so they
// can be tested without running a study.

/** Per-(task × model) mean pass rate. */
export function score(rows) {
  const by = {}
  for (const r of rows) (by[`${r.task}|${r.model}`] ??= []).push(r.pass ? 1 : 0)
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]))
}
export const total = s => Object.values(s).reduce((a, b) => a + b, 0)

/**
 * Candidates best on at least one column, with how many they lead. Ties all
 * count, and a column nobody passes is led by nobody. Averaging would drop a
 * candidate that alone solves one task for one model; this keeps it.
 */
export function paretoFront(pool) {
  const columns = [...new Set(pool.flatMap(c => Object.keys(c.val)))]
  const leads = new Map(pool.map(c => [c.id, 0]))
  for (const column of columns) {
    const best = Math.max(...pool.map(c => c.val[column] ?? 0))
    if (best > 0) for (const c of pool) if ((c.val[column] ?? 0) === best) leads.set(c.id, leads.get(c.id) + 1)
  }
  return pool.filter(c => leads.get(c.id) > 0).map(c => ({ candidate: c, leads: leads.get(c.id) }))
}

/** Draw a parent from the front, weighted by columns led. */
export function pickParent(pool, random = Math.random) {
  const front = paretoFront(pool)
  if (!front.length) return pool[0]
  let r = random() * front.reduce((sum, f) => sum + f.leads, 0)
  for (const f of front) { r -= f.leads; if (r < 0) return f.candidate }
  return front.at(-1).candidate
}

/** Highest total on val; on a tie the shorter text, so bloat never wins a draw. */
export function bestCandidate(pool) {
  return pool.reduce((a, c) => total(c.val) > total(a.val) || (total(c.val) === total(a.val) && JSON.stringify(c.overlay).length < JSON.stringify(a.overlay).length) ? c : a)
}

/**
 * Spec §7.4 lint, before any model time. Budgets, copied train prompts, fixture
 * object names, and action ids dressed as R calls. `groups` are the action id
 * prefixes: `read.csv(` is ordinary R and must not be flagged.
 */
export function violations(overlay, { surface, trainText, fixtureIdents, groups }) {
  const out = []
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const dotted = new RegExp(`\\b(?:${groups.map(escape).join('|')})\\.[a-z][A-Za-z]+\\s*\\(`)
  for (const [key, value] of Object.entries(overlay)) {
    if (typeof value !== 'string') continue
    const base = surface[key.replace(/^scalar:/, '')] ?? ''
    const limit = key === 'contract' || key === 'scalar:contract' ? base.length * 1.25 : key.startsWith('topic:') ? Math.max(base.length * 1.3, base.length + 600) : Math.max(base.length * 1.5, base.length + 240)
    if (value.length > limit) out.push(`${key} is ${value.length} chars (budget ${Math.round(limit)})`)
    const words = value.toLowerCase().split(/\s+/)
    for (let i = 0; i + 5 <= words.length; i++) {
      const gram = words.slice(i, i + 5).join(' ')
      if (trainText.some(t => t.includes(gram)) && !base.toLowerCase().includes(gram)) { out.push(`${key} copies a train prompt: "${gram}"`); break }
    }
    for (const ident of fixtureIdents) {
      const name = new RegExp(`\\b${escape(ident)}\\b`)
      if (name.test(value) && !name.test(base)) out.push(`${key} names fixture object "${ident}"`)
    }
    if (dotted.test(value) && !dotted.test(base)) out.push(`${key} shows an action id in dotted R form`)
  }
  return out
}
