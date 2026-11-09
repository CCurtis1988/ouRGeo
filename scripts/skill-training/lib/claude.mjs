// One non-interactive Claude call on the maintainer's subscription (spec §11:
// billing goes through the `claude` CLI). Isolated: no tools, no project or user
// settings, no MCP servers, no saved session, run from a neutral directory so
// no CLAUDE.md or skill source is in its context.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './app.mjs'

const NEUTRAL = path.join(CACHE, 'neutral-cwd')

const LIMIT = /hit your .*limit|usage limit|rate limit/i
const RETRY_MS = 5 * 60 * 1000

function once(prompt, { model = 'opus', system, timeoutMs = 15 * 60 * 1000 } = {}) {
  fs.mkdirSync(NEUTRAL, { recursive: true })
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence']
  if (system) args.push('--system-prompt', system)
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: NEUTRAL, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDECODE: '' } })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('claude call timed out')) }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err = (err + d).slice(-2000) })
    child.on('close', code => {
      clearTimeout(timer)
      try {
        const res = JSON.parse(out)
        if (res.is_error) reject(new Error(`claude: ${res.result ?? res.subtype}`))
        else resolve({ text: res.result, usage: res.usage, costUsd: res.total_cost_usd })
      } catch { reject(new Error(`claude exited ${code}: ${err || out.slice(0, 500)}`)) }
    })
    child.stdin.end(prompt)
  })
}

/**
 * Run one call, waiting out a usage limit. A refused call costs nothing, so
 * retrying it is the cheapest way to learn the limit has lifted, and it needs no
 * parsing of the reset time. Logged every 30 min so a stall monitor can tell a
 * wait from a hang.
 */
export async function claude(prompt, options) {
  for (let refused = 0; ; refused++) {
    try { return await once(prompt, options) }
    catch (e) {
      if (!LIMIT.test(String(e.message))) throw e
      if (refused % 6 === 0) console.log(`${new Date().toISOString().slice(11, 19)} usage limit: ${e.message}; retrying every 5 min`)
      await new Promise(resolve => setTimeout(resolve, RETRY_MS))
    }
  }
}

/** Returns once the subscription accepts a call. */
export const waitForQuota = () => claude('Reply with OK.', { model: 'haiku', timeoutMs: 120_000 })

/** Pull the first JSON array out of a model reply. */
export function jsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/)
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)
  return JSON.parse(raw)
}
