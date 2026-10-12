import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const rscript = process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'
let hasR = false
try { execFileSync(rscript, ['--version'], { stdio: 'ignore' }); hasR = true } catch { /* optional on CI */ }

describe.skipIf(!hasR)('loading installed R package copies', () => {
  it('selects exact paths, switches versions, and reports the real state after failures', () => {
    const output = execFileSync(rscript, ['--vanilla', 'tests/fixtures/packages/acceptance.R'], { encoding: 'utf8', timeout: 30_000 })
    expect(output).toContain('Package copy loading acceptance passed')
  }, 35_000)
})
