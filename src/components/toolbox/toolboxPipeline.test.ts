import { describe, it, expect } from 'vitest'
import type { ColumnInfo } from '@/lib/r-client'
import {
  toPipeStep,
  buildPipelineCode,
  predictColumns,
  getOpRhs,
  type PipelineState,
  type PipelineStep,
} from './toolboxPipeline'

describe('toPipeStep', () => {
  it('strips the assignment and the leading dataset argument', () => {
    expect(toPipeStep('result <- dplyr::filter(iris, Sepal.Length > 5)', 'iris'))
      .toBe('dplyr::filter(Sepal.Length > 5)')
  })
  it('collapses a sole dataset argument to ()', () => {
    expect(toPipeStep('x <- dplyr::distinct(iris)', 'iris')).toBe('dplyr::distinct()')
  })
  it('escapes regex metacharacters in the dataset name', () => {
    expect(toPipeStep('y <- f(my.data, a)', 'my.data')).toBe('f(a)')
  })
  it('strips a selection-sliced dataset name (<ds>_sel)', () => {
    expect(toPipeStep('out <- sf::st_buffer(pts_sel, dist = 10)', 'pts_sel'))
      .toBe('sf::st_buffer(dist = 10)')
  })
})

describe('buildPipelineCode', () => {
  it('assembles a |> chain from steps plus the current step', () => {
    const pipeline: PipelineState = {
      steps: [{ toolLabel: 'Filter', pipeStep: 'dplyr::filter(a > 1)', outputName: 'out' }],
      initialDs: 'iris',
      baseColumns: [],
      finalOutputName: 'out',
    }
    expect(buildPipelineCode(pipeline, 'dplyr::select(a)', 'out')).toBe(
      'out <- iris |>\n  dplyr::filter(a > 1) |>\n  dplyr::select(a)',
    )
  })
  it('starts the chain from a selection-sliced initialDs', () => {
    const pipeline: PipelineState = {
      steps: [],
      initialDs: 'pts_sel',
      baseColumns: [],
      finalOutputName: 'out',
    }
    expect(buildPipelineCode(pipeline, 'sf::st_buffer(dist = 10)', 'out')).toBe(
      'out <- pts_sel |>\n  sf::st_buffer(dist = 10)',
    )
  })
})

describe('predictColumns', () => {
  const step = (pipeStep: string): PipelineStep => ({ toolLabel: '', pipeStep, outputName: '' })
  const base: ColumnInfo[] = [
    { name: 'a', type: 'numeric' },
    { name: 'b', type: 'character' },
    { name: 'c', type: 'numeric' },
  ]

  it('appends columns introduced by mutate', () => {
    const cols = predictColumns([step('dplyr::mutate(z = a + 1)')], base)
    expect(cols.map(c => c.name)).toEqual(['a', 'b', 'c', 'z'])
    expect(cols.find(c => c.name === 'z')?.type).toBe('unknown')
  })
  it('narrows columns to a select list', () => {
    const cols = predictColumns([step('dplyr::select(a, b)')], base)
    expect(cols.map(c => c.name)).toEqual(['a', 'b'])
  })
  it('renames columns while preserving their type', () => {
    const cols = predictColumns([step('dplyr::rename(alpha = a)')], base)
    expect(cols.map(c => c.name)).toEqual(['alpha', 'b', 'c'])
    expect(cols.find(c => c.name === 'alpha')?.type).toBe('numeric')
  })
  it('leaves columns unchanged for filter/arrange', () => {
    expect(predictColumns([step('dplyr::filter(a > 1)')], base)).toEqual(base)
  })
})

describe('getOpRhs', () => {
  it('maps operators to their right-hand-side kind', () => {
    expect(getOpRhs('==')).toBe('value-or-column')
    expect(getOpRhs('%in%')).toBe('set')
    expect(getOpRhs('is.na')).toBe('none')
    expect(getOpRhs('grepl')).toBe('value')
  })
  it('defaults unknown operators to value-or-column', () => {
    expect(getOpRhs('??')).toBe('value-or-column')
  })
})
