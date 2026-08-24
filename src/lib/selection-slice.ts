// ── Selected-rows codegen ────────────────────────────────────────────────────
// Emits the dplyr::slice prelude the Toolbox prepends when a dataset has an
// active selection, so tools operate on only the selected rows.

/**
 * Convert 0-based row indices to a 1-based R index expression, compressing
 * consecutive runs: [0,1,2,5,9,10] → "c(1:3, 6, 10:11)". A single run or
 * value drops the c() wrapper ("1:3", "4").
 */
export function compressIndicesR(indices0: number[]): string {
  if (indices0.length === 0) return 'integer(0)'
  const sorted = Array.from(new Set(indices0)).sort((a, b) => a - b)
  const terms: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  const flush = () => {
    terms.push(prev > start ? `${start + 1}:${prev + 1}` : `${start + 1}`)
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i]; continue }
    flush()
    start = prev = sorted[i]
  }
  flush()
  return terms.length === 1 ? terms[0] : `c(${terms.join(', ')})`
}

/** The echoed prelude line: `<selName> <- dplyr::slice(<source>, <indices>)`. */
export function sliceSelectionLine(source: string, selName: string, indices0: number[]): string {
  return `${selName} <- dplyr::slice(${source}, ${compressIndicesR(indices0)})`
}
