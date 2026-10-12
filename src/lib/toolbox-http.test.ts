import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('keeps CORS responses bodyless and executes every shipped toolbox builder through the real R server', () => {
  const output = execFileSync(process.execPath, ['scripts/check-toolbox.mjs'], { encoding: 'utf8', timeout: 240_000 })
  expect(output).toContain('Bodyless gzip-negotiated CORS responses passed')
  expect(output).toMatch(/TOTAL \d+ FAIL 0/)
}, 240_000)
