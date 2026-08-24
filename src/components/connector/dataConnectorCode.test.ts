import { describe, it, expect } from 'vitest'
import type { DataSource, DynamicResult } from './types'
import {
  isLoadableExtension,
  formatBytes,
  toRVarName,
  fileVarName,
  readerForFile,
  extractKaggleFiles,
  buildKaggleCode,
  sourceIsSpatial,
  buildDynamicCode,
  buildManualCode,
} from './dataConnectorCode'

const makeSource = (over: Partial<DataSource>): DataSource => ({
  id: '', label: '', category: 'Geospatial', description: '', rPackage: '', datasets: [], ...over,
})

describe('formatBytes', () => {
  it('returns empty string for falsy size', () => {
    expect(formatBytes(0)).toBe('')
  })
  it('formats bytes, KB, and MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('isLoadableExtension', () => {
  it('accepts known data extensions, case-insensitively', () => {
    expect(isLoadableExtension('data.csv')).toBe(true)
    expect(isLoadableExtension('DATA.CSV')).toBe(true)
    expect(isLoadableExtension('x.parquet')).toBe(true)
  })
  it('rejects unknown or missing extensions', () => {
    expect(isLoadableExtension('archive.zip')).toBe(false)
    expect(isLoadableExtension('noext')).toBe(false)
  })
})

describe('toRVarName', () => {
  it('strips the extension and sanitises to a valid identifier', () => {
    expect(toRVarName('my data.csv')).toBe('my_data')
    expect(toRVarName('Sepal.Length')).toBe('Sepal')
  })
  it('prefixes names that start with a digit', () => {
    expect(toRVarName('2020-report.xlsx')).toBe('data_2020_report')
  })
  it('falls back to "data" when nothing usable remains', () => {
    expect(toRVarName('')).toBe('data')
    expect(toRVarName('!!!.txt')).toBe('data')
  })
})

describe('fileVarName', () => {
  it('applies the prefix when given', () => {
    expect(fileVarName('data.csv', 'kaggle')).toBe('kaggle_data')
  })
  it('uses the bare stem with no prefix', () => {
    expect(fileVarName('data.csv', '')).toBe('data')
  })
})

describe('readerForFile', () => {
  it('selects the right R reader per extension', () => {
    expect(readerForFile('x.csv', 'v')).toBe('v <- read.csv(file.path(tmp_dir, "x.csv"))')
    expect(readerForFile('x.tsv', 'v')).toBe('v <- read.delim(file.path(tmp_dir, "x.tsv"))')
    expect(readerForFile('x.json', 'v')).toContain('jsonlite::fromJSON')
    expect(readerForFile('x.parquet', 'v')).toContain('arrow::read_parquet')
    expect(readerForFile('x.xlsx', 'v')).toContain('readxl::read_excel')
    expect(readerForFile('x.feather', 'v')).toContain('arrow::read_feather')
  })
  it('emits a comment for unsupported formats', () => {
    expect(readerForFile('x.bin', 'v')).toBe('# v: cannot auto-load "x.bin" (unsupported format)')
  })
})

describe('extractKaggleFiles', () => {
  it('normalises a top-level array', () => {
    expect(extractKaggleFiles([{ name: 'a.csv', totalBytes: 10 }])).toEqual([{ name: 'a.csv', totalBytes: 10 }])
  })
  it('reads alternate key and size fields', () => {
    expect(extractKaggleFiles({ datasetFiles: [{ fileName: 'b.csv', fileSize: 5 }] }))
      .toEqual([{ name: 'b.csv', totalBytes: 5 }])
    expect(extractKaggleFiles({ files: [{ name: 'c', size: 3 }] }))
      .toEqual([{ name: 'c', totalBytes: 3 }])
  })
  it('drops entries without a name and unknown shapes', () => {
    expect(extractKaggleFiles([{ totalBytes: 1 }])).toEqual([])
    expect(extractKaggleFiles({ nope: [] })).toEqual([])
  })
})

describe('sourceIsSpatial', () => {
  it('is true for spatial R packages only', () => {
    expect(sourceIsSpatial(makeSource({ rPackage: 'sf' }))).toBe(true)
    expect(sourceIsSpatial(makeSource({ rPackage: 'tigris' }))).toBe(true)
    expect(sourceIsSpatial(makeSource({ rPackage: 'dplyr' }))).toBe(false)
  })
})

describe('buildKaggleCode', () => {
  it('guards against an empty selection', () => {
    expect(buildKaggleCode('owner/ds', new Set(), '', {})).toBe('# Select at least one file to load')
  })
  it('builds a download + reader script for selected files', () => {
    const code = buildKaggleCode('owner/cool-ds', new Set(['a.csv']), 'kg', {})
    expect(code.startsWith('library(httr2)')).toBe(true)
    expect(code).toContain('https://www.kaggle.com/api/v1/datasets/download/owner/cool-ds')
    expect(code).toContain('kaggle_cool_ds')
    expect(code).toContain('kg_a <- read.csv(file.path(tmp_dir, "a.csv"))')
  })
})

describe('buildDynamicCode', () => {
  const result: DynamicResult = { id: 'GDP', label: '', description: '', url: 'https://ex.com/data.csv' }
  it('generates Socrata code', () => {
    const code = buildDynamicCode(makeSource({ dynamicType: 'socrata' }), result, {}, 'v', {})
    expect(code).toContain('library(RSocrata)')
    expect(code).toContain('read.socrata')
  })
  it('generates FRED code with the series id', () => {
    const code = buildDynamicCode(makeSource({ dynamicType: 'fred' }), result, {}, 'v', { fred: 'KEY' })
    expect(code).toContain('library(fredr)')
    expect(code).toContain('fredr_set_key("KEY")')
    expect(code).toContain('series_id = "GDP"')
  })
  it('returns empty string for an unknown dynamic type', () => {
    expect(buildDynamicCode(makeSource({}), result, {}, 'v', {})).toBe('')
  })
})

describe('buildManualCode', () => {
  it('prompts for a URL when missing', () => {
    expect(buildManualCode('', '', [], 'csv', 0, 'v')).toBe('# Enter a URL to generate code')
  })
  it('builds a request pipeline with a header and query params', () => {
    const code = buildManualCode(
      'https://api.example.com/x',
      'X-Token: abc',
      [{ id: '1', key: 'state', value: 'CA' }],
      'csv',
      100,
      'v',
    )
    expect(code).toContain('request("https://api.example.com/x")')
    expect(code).toContain('req_headers("X-Token" = "abc")')
    expect(code).toContain('req_url_query(state = "CA", limit = 100)')
    expect(code).toContain('read.csv(text = x)')
  })
  it('defaults a bare auth token to a Bearer header', () => {
    expect(buildManualCode('https://x', 'tok', [], 'json', 0, 'v'))
      .toContain('req_headers("Authorization" = "Bearer tok")')
  })
})
