// Statistics for paired arm comparisons (spec §6.2).
//
// Tasks are the clusters: runs of one task are correlated, so every interval
// resamples TASKS (Miller, "Adding Error Bars to Evals", 2024), and arms are
// compared per task, which removes task difficulty from the variance.

/** Seeded PRNG so a report re-run gives the same interval. */
function rng(seed = 1) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const quantile = (sorted, q) => { const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo) }

/** records: [{ task, pass }] → Map task → success rate over its runs. */
export function perTask(records, value = r => (r.pass ? 1 : 0)) {
  const by = new Map()
  for (const r of records) { if (!by.has(r.task)) by.set(r.task, []); by.get(r.task).push(value(r)) }
  return new Map([...by].map(([task, xs]) => [task, mean(xs)]))
}

/** pass^k (τ-bench): P(all k runs succeed), unbiased from n runs with c successes. */
export function passHatK(records, k) {
  const by = new Map()
  for (const r of records) { const e = by.get(r.task) ?? { n: 0, c: 0 }; e.n++; e.c += r.pass ? 1 : 0; by.set(r.task, e) }
  const choose = (n, m) => { if (m > n) return 0; let x = 1; for (let i = 0; i < m; i++) x *= (n - i) / (i + 1); return x }
  const vals = [...by.values()].filter(e => e.n >= k).map(e => choose(e.c, k) / choose(e.n, k))
  return vals.length ? mean(vals) : null
}

/** Paired difference candidate − baseline over tasks present in both. */
export function pairedDiff(baseline, candidate, { resamples = 10000, seed = 1 } = {}) {
  const tasks = [...baseline.keys()].filter(t => candidate.has(t))
  const d = tasks.map(t => candidate.get(t) - baseline.get(t))
  const rand = rng(seed), boots = []
  for (let b = 0; b < resamples; b++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rand() * d.length)]; boots.push(s / (d.length || 1)) }
  boots.sort((a, b) => a - b)
  const up = d.filter(x => x > 0).length, down = d.filter(x => x < 0).length
  return { tasks: tasks.length, baseline: mean(tasks.map(t => baseline.get(t))), candidate: mean(tasks.map(t => candidate.get(t))), diff: mean(d), ci95: [quantile(boots, 0.025), quantile(boots, 0.975)], improved: up, worsened: down, signP: signTest(up, down) }
}

/** Exact two-sided sign test on tasks that changed. */
export function signTest(up, down) {
  const n = up + down
  if (!n) return 1
  const k = Math.min(up, down)
  let p = 0, c = 1
  for (let i = 0; i <= n; i++) { if (i <= k) p += c; c = c * (n - i) / (i + 1) }
  return Math.min(1, 2 * p / 2 ** n)
}

/** Holm–Bonferroni: adjusted p-values in input order. */
export function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0])
  const out = new Array(ps.length)
  let running = 0
  order.forEach(([p, i], rank) => { running = Math.max(running, Math.min(1, p * (ps.length - rank))); out[i] = running })
  return out
}

/** Ratio of geometric means (candidate / baseline) with a task bootstrap CI. */
export function ratioOfGeoMeans(baseline, candidate, { resamples = 10000, seed = 2 } = {}) {
  const tasks = [...baseline.keys()].filter(t => candidate.has(t) && baseline.get(t) > 0 && candidate.get(t) > 0)
  const logs = tasks.map(t => Math.log(candidate.get(t)) - Math.log(baseline.get(t)))
  const rand = rng(seed), boots = []
  for (let b = 0; b < resamples; b++) { let s = 0; for (let i = 0; i < logs.length; i++) s += logs[Math.floor(rand() * logs.length)]; boots.push(Math.exp(s / (logs.length || 1))) }
  boots.sort((a, b) => a - b)
  return { tasks: tasks.length, ratio: Math.exp(mean(logs)), ci95: [quantile(boots, 0.025), quantile(boots, 0.975)] }
}
