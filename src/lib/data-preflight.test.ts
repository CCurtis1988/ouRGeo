import { execFileSync } from 'node:child_process'
import { it, expect } from 'vitest'

it('runs independent R fixtures through the shared validation and controlled execution gates', () => {
  const output = execFileSync('Rscript', ['tests/fixtures/preflight/acceptance.R'], { encoding: 'utf8', timeout: 120_000 })
  expect(output).toContain('Authority, revision, cancellation and export path requirements acceptance passed')
  expect(output).toContain('Installed DuckDB materialisation identity acceptance passed')
  expect(output).toContain('Curves, dimensions, engine restoration and recording acceptance passed')
}, 120_000)
