// smart-box is shared. Maintainer's rule (spec §11, 2026-11-05): this project
// has priority, but local-model batches run at most 2 hours, then the box is
// left alone for 1 hour, repeating until the study is done.
//
// State lives in a file so the rule holds across processes and restarts: a
// crashed batch that is relaunched does not get a fresh 2 hours.

import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './app.mjs'

const FILE = path.join(CACHE, 'duty-cycle.json')
export const ON_MS = 2 * 60 * 60 * 1000
export const OFF_MS = 60 * 60 * 1000

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { windowStart: null } }
}
function save(state) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)) }

/** Where we are in the cycle right now. */
export function dutyStatus(now = Date.now()) {
  const { windowStart } = read()
  if (!windowStart || now >= windowStart + ON_MS + OFF_MS) return { phase: 'idle', msLeft: ON_MS }
  if (now < windowStart + ON_MS) return { phase: 'on', msLeft: windowStart + ON_MS - now }
  return { phase: 'off', msLeft: windowStart + ON_MS + OFF_MS - now }
}

/**
 * Wait until local inference is allowed, opening a new 2-hour window if none
 * is running. Returns the ms remaining in the window; callers must not START a
 * request that cannot finish inside it (pass the request's worst case).
 */
export async function acquireLocal(worstCaseMs = 10 * 60 * 1000, log = console.log) {
  for (;;) {
    const status = dutyStatus()
    if (status.phase === 'idle') { save({ windowStart: Date.now() }); log('smart-box window opened (2 h)'); continue }
    if (status.phase === 'on' && status.msLeft >= worstCaseMs) return status.msLeft
    const wait = status.phase === 'on' ? status.msLeft + OFF_MS : status.msLeft
    log(`smart-box: leaving it free for ${Math.round(wait / 60000)} min`)
    await new Promise(resolve => setTimeout(resolve, Math.min(wait, 5 * 60 * 1000)))
  }
}

/** Is a model outside this study loaded? Then wait rather than evict it. */
export async function foreignWorkload(studyModels) {
  const loaded = []
  try {
    const running = await (await fetch('http://10.0.0.10:8080/running', { signal: AbortSignal.timeout(10000) })).json()
    for (const r of running.running ?? []) loaded.push(r.model ?? r.name)
  } catch { /* unreachable is reported by the request itself */ }
  try {
    const ps = await (await fetch('http://10.0.0.10:11434/api/ps', { signal: AbortSignal.timeout(10000) })).json()
    for (const m of ps.models ?? []) loaded.push(m.name)
  } catch { /* same */ }
  return loaded.filter(name => name && !studyModels.some(m => name === m || name.endsWith(`/${m}`) || m.endsWith(`/${name}`)))
}
