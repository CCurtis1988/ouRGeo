// Task loading shared by run.mjs and the optimiser. `test` reads the sealed
// store, and only when the caller says so (spec §5.4: the test is read once).
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, CACHE } from './app.mjs'

export function loadTasks(split, { sealed = false } = {}) {
  if (split === 'test' && !sealed) throw new Error('The sealed test is read only by the final evaluation (--sealed).')
  const dir = split === 'test' ? path.join(CACHE, 'sealed') : path.join(ROOT, 'tests/fixtures/agent-skills', split)
  if (!fs.existsSync(dir)) return []
  if (split === 'test') fs.appendFileSync(path.join(CACHE, 'sealed-access.log'), `${new Date().toISOString()} read by pid ${process.pid}: ${process.argv.slice(1).join(' ')}\n`)
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().flatMap(f => {
    const value = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    return Array.isArray(value) ? value : [value]
  })
}
