// Dump the whole model-facing skill surface with a stable hash (spec §4.2).
//
//   node scripts/skill-training/export-surface.mjs [--out file.json]
//   node scripts/skill-training/export-surface.mjs --verify candidate.json
//
// --verify is the write-back check: after an accepted candidate is written into
// the TypeScript source, every key it changed must read back from the source
// with exactly the candidate's value. The surface comes from the source tree
// through the existing vitest seam, so no app build is involved.

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE, ROOT } from './lib/app.mjs'

const args = process.argv.slice(2)
const opt = name => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined

/** Key order must not move the hash. */
export const canonical = surface => JSON.stringify(Object.fromEntries(Object.entries(surface).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
export const surfaceHash = surface => crypto.createHash('sha256').update(canonical(surface)).digest('hex').slice(0, 16)

const raw = path.join(CACHE, `surface-export-${process.pid}.json`)
execFileSync('npx', ['vitest', 'run', 'src/lib/eval/surface.test.ts'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, SKILL_SURFACE_OUT: raw } })
const surface = JSON.parse(fs.readFileSync(raw, 'utf8'))
fs.rmSync(raw)

const hash = surfaceHash(surface)
const out = opt('out') ?? path.join(CACHE, `surface-${hash}.json`)
fs.writeFileSync(out, canonical(surface))
console.log(`${Object.keys(surface).length} keys, hash ${hash} → ${path.relative(ROOT, out)}`)

const verify = opt('verify')
if (verify) {
  const candidate = JSON.parse(fs.readFileSync(verify, 'utf8'))
  const differs = Object.keys(candidate).filter(key => !key.startsWith('scalar:') && surface[key] !== candidate[key])
  if (differs.length) { console.error(`Write-back incomplete, ${differs.length} key(s) differ:\n  ${differs.slice(0, 20).join('\n  ')}`); process.exit(1) }
  console.log(`write-back verified: ${Object.keys(candidate).length} candidate keys match the source`)
}
