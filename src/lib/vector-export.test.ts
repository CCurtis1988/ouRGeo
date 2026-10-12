import { execFileSync } from 'node:child_process'
import { it, expect } from 'vitest'

it('writes and independently verifies vector files without changing source data or previous destinations', () => {
  let output: string
  try { output = execFileSync('Rscript', ['tests/fixtures/preflight/export.R'], { encoding: 'utf8', timeout: 120_000 }) }
  catch (error) { throw new Error(String((error as { stdout?: string }).stdout ?? '') + String(error)) }
  expect(output).toContain('Checked vector export acceptance passed')
}, 120_000)
