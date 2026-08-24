import { describe, it, expect } from 'vitest'
import { compressIndicesR, sliceSelectionLine } from './selection-slice'

describe('compressIndicesR', () => {
  it('handles empty input', () => {
    expect(compressIndicesR([])).toBe('integer(0)')
  })

  it('converts a single 0-based index to 1-based', () => {
    expect(compressIndicesR([3])).toBe('4')
  })

  it('emits a bare range for one consecutive run', () => {
    expect(compressIndicesR([0, 1, 2])).toBe('1:3')
  })

  it('compresses mixed runs and singletons', () => {
    expect(compressIndicesR([0, 1, 2, 5, 9, 10])).toBe('c(1:3, 6, 10:11)')
  })

  it('sorts and dedupes unordered input', () => {
    expect(compressIndicesR([10, 9, 0, 2, 1, 5, 5])).toBe('c(1:3, 6, 10:11)')
  })

  it('keeps two-element runs as a range', () => {
    expect(compressIndicesR([4, 5])).toBe('5:6')
  })
})

describe('sliceSelectionLine', () => {
  it('emits the dplyr::slice prelude', () => {
    expect(sliceSelectionLine('pts', 'pts_sel', [1, 2, 3, 6, 11])).toBe(
      'pts_sel <- dplyr::slice(pts, c(2:4, 7, 12))',
    )
  })

  it('works with a collect()-wrapped source', () => {
    expect(sliceSelectionLine('(tbl %>% dplyr::collect())', 'tbl_sel', [0])).toBe(
      'tbl_sel <- dplyr::slice((tbl %>% dplyr::collect()), 1)',
    )
  })
})
