import { describe, it, expect } from 'vitest'
import { tabTooltip } from './tab-tooltip'
import type { TabState } from '@/store/editor'

function tab(over: Partial<TabState>): TabState {
  return {
    id: 't', filePath: null, fileName: 'Untitled-1', content: '', savedContent: '',
    isDirty: false, type: 'code', ...over,
  }
}

describe('what a tab says when you hover it', () => {
  it('names the file and the directory it came from', () => {
    // Two tabs reading "census_tracts_2020…" are the same tab to look at; the
    // path is what tells them apart.
    expect(tabTooltip(tab({
      fileName: 'analysis.R', filePath: '/home/ada/surveys/2024/analysis.R',
    }))).toBe('analysis.R\n/home/ada/surveys/2024/analysis.R')
  })

  it('says a document is not on disk yet, rather than leaving the line blank', () => {
    expect(tabTooltip(tab({ fileName: 'report.Rmd' })))
      .toBe('report.Rmd\nNot saved to disk')
  })

  it('spells out the unsaved marker the ellipsis eats', () => {
    // `*` lives inside the truncated span, so a long name hides the one thing
    // saying the file has unsaved changes.
    expect(tabTooltip(tab({
      fileName: 'a-rather-long-document-name.Rmd', filePath: '/tmp/a.Rmd', isDirty: true,
    }))).toBe('a-rather-long-document-name.Rmd\n/tmp/a.Rmd\nUnsaved changes')
  })

  it('gives an object tab the R expression that reaches it', () => {
    // `myenv$roads` is not `roads`, and the label cannot say so.
    expect(tabTooltip(tab({
      fileName: 'roads [sf]', type: 'data-viewer', objectName: 'roads',
      objectClass: 'sf', accessPath: 'myenv$roads', envName: '.GlobalEnv',
    }))).toBe('roads [sf]\nData viewer · myenv$roads')
  })

  it('names the environment only when it is not the one bare names resolve in', () => {
    expect(tabTooltip(tab({
      fileName: 'pts [sf]', type: 'data-viewer', objectName: 'pts',
      accessPath: 'pts', envName: 'scratch',
    }))).toBe('pts [sf]\nData viewer · pts in scratch')
  })

  it('distinguishes the function editor from the data viewer', () => {
    expect(tabTooltip(tab({
      fileName: 'buffer_all()', type: 'function-editor', objectName: 'buffer_all',
      accessPath: 'buffer_all', envName: '.GlobalEnv', isDirty: true,
    }))).toBe('buffer_all()\nFunction editor · buffer_all\nUnsaved changes')
  })
})
