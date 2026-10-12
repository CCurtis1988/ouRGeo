import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { checkedOutputViewClass, requestPreview } from './data-preflight'
import type { PreflightRequest } from './data-preflight-types'

it('emits a readable read-only R request without executing parameter strings', () => {
  const request: PreflightRequest = {
    operationType: 'sf-buffer', outputEnv: '.GlobalEnv',
    inputs: [{ name: 'points', envName: '.GlobalEnv', rows: [0, 2], selectionVersion: 7, excludedRows: [2], exclusionReason: 'A "quoted" reason\nwith a second line' }],
    parameters: { dist: '100', units: 'm', workingCRS: 'native', out: 'points_buffer', expr: '"; stop("parameter executed"); #', path: 'C:\\R data\\points' },
  }
  const code = requestPreview(request)
  expect(code).toContain('dq_validate(\n  list(')
  expect(code).toContain('"dist" = "100"')
  expect(code).not.toContain('fromJSON')
  const output = execFileSync(process.platform === 'win32' ? 'Rscript.exe' : 'Rscript', ['-e', String.raw`
    call <- parse(text=commandArgs(trailingOnly=TRUE)[1])[[1]]
    stopifnot(as.character(call[[1]]) == 'dq_validate')
    cat(jsonlite::toJSON(eval(call[[2]]),auto_unbox=TRUE,null='null',digits=NA))
  `, code], { encoding: 'utf8', timeout: 10_000 })
  expect(JSON.parse(output)).toEqual(request)
})

it('opens sf tables and measurements with their actual class while retaining native geometry vectors in Environment', () => {
  expect(checkedOutputViewClass('sf')).toBe('sf')
  expect(checkedOutputViewClass('units')).toBe('units')
  expect(checkedOutputViewClass('sfc_POLYGON')).toBeNull()
  expect(checkedOutputViewClass('geos_geometry')).toBeNull()
})
