// Freeze the current build for the harness: .cache/skill-training/apps/<hash>/
// holds a COPY of out/ and symlinks to everything else at the repo root, and
// `current` points at it. Rebuilding the repo then never changes an instance
// mid-launch, and every ledger row names the exact build it measured.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, CACHE } from './lib/app.mjs'

const hash = crypto.createHash('sha256')
const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else hash.update(e.name).update(fs.readFileSync(p)) } }
walk(path.join(ROOT, 'out'))
const id = hash.digest('hex').slice(0, 12)
const dest = path.join(CACHE, 'apps', id)
if (!fs.existsSync(dest)) {
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(path.join(ROOT, 'out'), path.join(dest, 'out'), { recursive: true })
  for (const entry of fs.readdirSync(ROOT)) if (!['out', '.cache', '.git'].includes(entry)) fs.symlinkSync(path.join(ROOT, entry), path.join(dest, entry))
}
const current = path.join(CACHE, 'apps', 'current')
if (!process.argv.includes('--keep-current')) { fs.rmSync(current, { force: true }); fs.symlinkSync(id, current) }
console.log(`build ${id} → ${path.relative(ROOT, dest)}`)
