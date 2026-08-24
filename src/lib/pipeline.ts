import type { ColumnInfo } from './r-client'

// ── Pipeline types & utilities ────────────────────────────────────────────────

export interface PipelineStep {
  toolLabel: string
  pipeStep: string    // e.g. "dplyr::filter(Sepal.Length > 5)"
  outputName: string  // for display in banner only
}

export interface PipelineState {
  steps: PipelineStep[]
  initialDs: string         // dataset that starts the chain (always a real R variable)
  baseColumns: ColumnInfo[] // columns of initialDs, fetched once from R when pipeline starts
  finalOutputName: string   // output var name locked from the first step
}

/** Strip assignment prefix and first (dataset) argument, leaving just the pipe operation. */
export function toPipeStep(fullCode: string, datasetName: string): string {
  let step = fullCode.replace(/^\S+ <- /, '')
  const esc = datasetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  step = step.replace(new RegExp(`\\(${esc},\\s*`), '(')
             .replace(new RegExp(`\\(${esc}\\)`), '()')
  return step.trim()
}

/** Assemble the full |> pipeline code string. */
export function buildPipelineCode(
  pipeline: PipelineState,
  currentPipeStep: string,
  finalOutput: string
): string {
  const allSteps = [...pipeline.steps.map(s => s.pipeStep), currentPipeStep]
  return `${finalOutput} <- ${pipeline.initialDs} |>\n` +
    allSteps.map(s => `  ${s}`).join(' |>\n')
}

/** Build a pipeline code string without an assignment (for selection queries). */
export function buildSelectionPipelineCode(
  pipeline: PipelineState,
  currentPipeStep: string
): string {
  const allSteps = [...pipeline.steps.map(s => s.pipeStep), currentPipeStep]
  return `${pipeline.initialDs} |>\n` +
    allSteps.map(s => `  ${s}`).join(' |>\n')
}

/** Predict which columns exist after applying pipeline steps — purely client-side, no R execution. */
export function predictColumns(steps: PipelineStep[], base: ColumnInfo[]): ColumnInfo[] {
  let cols = [...base]
  for (const step of steps) {
    const ps = step.pipeStep
    if (/^dplyr::(?:mutate|transmute)\(/.test(ps)) {
      const inner = ps.slice(ps.indexOf('(') + 1, ps.lastIndexOf(')'))
      for (const m of inner.matchAll(/\b([A-Za-z_.][A-Za-z0-9_.]*)\s*=/g)) {
        const col = m[1]
        if (!cols.some(c => c.name === col)) cols = [...cols, { name: col, type: 'unknown' }]
        else cols = cols.map(c => c.name === col ? { ...c, type: 'unknown' } : c)
      }
    } else if (/^dplyr::select\(/.test(ps)) {
      const inner = ps.slice(ps.indexOf('(') + 1, ps.lastIndexOf(')'))
      const sel = inner.split(',').map(s => s.trim()).filter(s => /^[A-Za-z_.][A-Za-z0-9_.]*$/.test(s))
      if (sel.length > 0) cols = sel.map(n => cols.find(c => c.name === n) ?? { name: n, type: 'unknown' })
    } else if (/^dplyr::rename\(/.test(ps)) {
      const inner = ps.slice(ps.indexOf('(') + 1, ps.lastIndexOf(')'))
      for (const m of inner.matchAll(/([A-Za-z_.][A-Za-z0-9_.]*)\s*=\s*([A-Za-z_.][A-Za-z0-9_.]*)/g)) {
        const [, newName, oldName] = m
        cols = cols.map(c => c.name === oldName ? { name: newName, type: c.type } : c)
      }
    }
    // filter, arrange, group_by, etc.: columns unchanged
  }
  return cols
}
