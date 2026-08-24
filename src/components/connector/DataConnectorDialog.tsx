import React, { useState, useRef, useCallback, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ChevronRight, ChevronDown, Search, Loader2, Plus, Trash2, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { SOURCES, CATEGORIES } from './sources'
import { WebApisTab } from './WebApisTab'
import type { DataSource, StaticDataSet, DynamicResult, KaggleFile } from './types'
import { useApiKeysStore } from '@/store/apiKeys'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { rClient } from '@/lib/r-client'
import { cn } from '@/lib/utils'
import {
  KAGGLE_CATEGORIES, isLoadableExtension, formatBytes, toRVarName, fileVarName,
  buildKaggleFallbackCode, buildKaggleCode, sourceIsSpatial, buildDynamicCode, buildManualCode,
  type QueryParam,
} from './dataConnectorCode'

// ── Main component ─────────────────────────────────────────────────────────
interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DataConnectorDialog({ open, onOpenChange }: Props): React.ReactElement {
  const keys = useApiKeysStore((s) => s.keys)
  const initKeys = useApiKeysStore((s) => s.init)
  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)

  // ── Mode ─────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'browse' | 'webapis' | 'manual'>('browse')

  // ── Browse state ─────────────────────────────────────────────────────────
  const [sourceSearch, setSourceSearch] = useState('')
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [datasetSearch, setDatasetSearch] = useState('')
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null)
  const [selectedDynamic, setSelectedDynamic] = useState<DynamicResult | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})
  const [varName, setVarName] = useState('mydata')

  // ── Dynamic catalogue state ───────────────────────────────────────────────
  const [dynamicResults, setDynamicResults] = useState<DynamicResult[]>([])
  const [dynamicLoading, setDynamicLoading] = useState(false)
  const [dynamicError, setDynamicError] = useState<string | null>(null)
  const dynamicDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Kaggle-specific state ─────────────────────────────────────────────────
  const [kaggleCategory, setKaggleCategory] = useState('all')
  const [kaggleFiles, setKaggleFiles] = useState<KaggleFile[]>([])
  const [kaggleFilesLoading, setKaggleFilesLoading] = useState(false)
  const [kaggleFilesError, setKaggleFilesError] = useState<string | null>(null)
  const [kaggleFallback, setKaggleFallback] = useState(false)
  const [kaggleZipPath, setKaggleZipPath] = useState<string | null>(null)
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set())
  const [varPrefix, setVarPrefix] = useState('')

  // ── Manual mode state ─────────────────────────────────────────────────────
  const [manualUrl, setManualUrl] = useState('')
  const [manualAuthHeader, setManualAuthHeader] = useState('')
  const [manualQueryParams, setManualQueryParams] = useState<QueryParam[]>([{ id: '1', key: '', value: '' }])
  const [manualFormat, setManualFormat] = useState<'json' | 'csv' | 'geojson' | 'geotiff'>('json')
  const [manualLimit, setManualLimit] = useState(0)
  const [manualVarName, setManualVarName] = useState('mydata')

  // ── Load state ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      initKeys()
      setError(null)
    }
  }, [open, initKeys])

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeSource = selectedSourceId ? SOURCES.find(s => s.id === selectedSourceId) ?? null : null
  const activeDataset: StaticDataSet | null =
    selectedDatasetId && activeSource
      ? activeSource.datasets.find(d => d.id === selectedDatasetId) ?? null
      : null
  const isKaggle = activeSource?.dynamicType === 'kaggle'

  const activeCode = activeDataset
    ? activeDataset.buildCode(params, varName, keys)
    : selectedDynamic && activeSource
    ? (isKaggle
      ? buildKaggleCode(selectedDynamic.id, checkedFiles, varPrefix, keys, kaggleZipPath)
      : buildDynamicCode(activeSource, selectedDynamic, params, varName, keys))
    : mode === 'manual'
    ? buildManualCode(manualUrl, manualAuthHeader, manualQueryParams, manualFormat, manualLimit, manualVarName)
    : ''

  const filteredSources = SOURCES.filter(s => {
    if (!sourceSearch) return true
    const q = sourceSearch.toLowerCase()
    return s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
  })

  const canLoad = mode === 'manual'
    ? !!manualUrl && !!manualVarName
    : isKaggle
    ? !!selectedDynamic && checkedFiles.size > 0
    : !!(activeDataset || selectedDynamic) && !!varName

  // ── Kaggle file fetch — uses R backend to download ZIP + read central dir ─
  const fetchKaggleFiles = useCallback(async (ref: string) => {
    setKaggleFilesLoading(true)
    setKaggleFiles([])
    setKaggleFilesError(null)
    setKaggleFallback(false)
    setKaggleZipPath(null)
    setCheckedFiles(new Set())
    try {
      const username = keys.kaggle_username ?? ''
      const apiKey = keys.kaggle ?? ''
      if (!username || !apiKey) {
        setKaggleFilesError('Kaggle username and API key required. Add them in Settings → API Keys.')
        return
      }
      const res = await rClient.kaggleFiles(ref, username, apiKey)
      if (!res.success || !res.files) {
        setKaggleFilesError(res.error ?? 'Could not retrieve file list.')
        return
      }
      const files: KaggleFile[] = res.files
      if (files.length === 0) {
        setKaggleFilesError('No files found in this dataset archive.')
        return
      }
      setKaggleFiles(files)
      setKaggleZipPath(res.zipPath ?? null)
      setCheckedFiles(new Set(files.filter(f => isLoadableExtension(f.name)).map(f => f.name)))
    } catch (e) {
      setKaggleFilesError(`Failed to fetch files: ${String(e)}`)
    } finally {
      setKaggleFilesLoading(false)
    }
  }, [keys.kaggle_username, keys.kaggle])

  // ── Dynamic catalogue fetch ───────────────────────────────────────────────
  const fetchDynamic = useCallback(async (source: DataSource, query: string, kaggleCatId?: string) => {
    setDynamicLoading(true)
    setDynamicError(null)
    setDynamicResults([])
    try {
      if (source.dynamicType === 'kaggle') {
        const username = keys.kaggle_username ?? ''
        const apiKey = keys.kaggle ?? ''
        if (!username || !apiKey) {
          setDynamicError('Kaggle username and API key required. Add them in Settings → API Keys.')
          return
        }
        const catId = kaggleCatId ?? kaggleCategory
        const cat = KAGGLE_CATEGORIES.find(c => c.id === catId)
        const parts = [cat?.searchTerm, query].filter(Boolean)
        const q = encodeURIComponent(parts.join(' ') || 'data')
        const auth = btoa(`${username}:${apiKey}`)
        const res = await fetch(
          `https://www.kaggle.com/api/v1/datasets/list?search=${q}&page_size=20&sort_by=votes`,
          { headers: { Authorization: `Basic ${auth}` } }
        )
        if (!res.ok) {
          setDynamicError(`Kaggle API error: ${res.status} ${res.statusText}`)
          return
        }
        const data = await res.json() as { ref?: string; title?: string; subtitle?: string; totalBytes?: number }[]
        const arr = Array.isArray(data) ? data : []
        setDynamicResults(arr.map(d => ({
          id: d.ref ?? '',
          label: d.title ?? d.ref ?? '',
          description: [d.subtitle, formatBytes(d.totalBytes ?? 0)].filter(Boolean).join(' · '),
        })))
      } else if (source.dynamicType === 'socrata') {
        const q = encodeURIComponent(query || 'a')
        const res = await fetch(
          `https://${source.dynamicDomain}/api/catalog.json?q=${q}&limit=20&only=dataset`
        )
        const data = await res.json() as { results?: { resource: { id: string; name: string; description: string } }[] }
        setDynamicResults(
          (data.results ?? []).map(r => ({
            id: r.resource.id,
            label: r.resource.name,
            description: r.resource.description ?? '',
            url: `https://${source.dynamicDomain}/resource/${r.resource.id}.json`,
          }))
        )
      } else if (source.dynamicType === 'ckan') {
        const q = encodeURIComponent(query || 'environment')
        const res = await fetch(
          `https://open.canada.ca/data/en/api/3/action/package_search?q=${q}&rows=20`
        )
        const data = await res.json() as {
          result?: {
            results?: {
              id: string; title: string; notes?: string
              resources?: { url: string; format: string }[]
            }[]
          }
        }
        setDynamicResults(
          (data.result?.results ?? []).map(pkg => {
            const r = (pkg.resources ?? []).find(r => r.format?.toLowerCase() === 'csv' || r.format?.toLowerCase() === 'json')
            return { id: pkg.id, label: pkg.title, description: (pkg.notes ?? '').slice(0, 120), url: r?.url ?? '' }
          })
        )
      } else if (source.dynamicType === 'fred') {
        const apiKey = keys.fred ?? ''
        if (!apiKey) {
          setDynamicError('A FRED API key is required. Add it in Settings → API Keys.')
          return
        }
        const q = encodeURIComponent(query || 'GDP')
        const res = await fetch(
          `https://api.stlouisfed.org/fred/series/search?search_text=${q}&api_key=${apiKey}&file_type=json&limit=20`
        )
        const data = await res.json() as {
          seriess?: { id: string; title: string; observation_start: string; observation_end: string }[]
          error_message?: string
        }
        if (data.error_message) {
          setDynamicError(data.error_message)
        } else {
          setDynamicResults(
            (data.seriess ?? []).map(s => ({
              id: s.id,
              label: `${s.id} — ${s.title}`,
              description: `${s.observation_start} to ${s.observation_end}`,
            }))
          )
        }
      }
    } catch {
      setDynamicError('Failed to fetch catalogue. Check your internet connection.')
    } finally {
      setDynamicLoading(false)
    }
  }, [keys.kaggle_username, keys.kaggle, keys.fred, kaggleCategory])

  // ── Source toggle ─────────────────────────────────────────────────────────
  const handleToggleSource = useCallback((source: DataSource) => {
    const isExpanding = expandedSourceId !== source.id
    setExpandedSourceId(isExpanding ? source.id : null)
    setDatasetSearch('')
    setDynamicResults([])
    setDynamicError(null)
    setSelectedDynamic(null)
    setKaggleFiles([])
    setKaggleFilesError(null)
    setKaggleFallback(false)
    setKaggleZipPath(null)
    setCheckedFiles(new Set())
    setKaggleFilesLoading(false)

    if (isExpanding && source.dynamicCatalogue) {
      if (dynamicDebounce.current) clearTimeout(dynamicDebounce.current)
      dynamicDebounce.current = setTimeout(() => fetchDynamic(source, '', kaggleCategory), 0)
    }
  }, [expandedSourceId, fetchDynamic, kaggleCategory])

  // ── Kaggle category chip click ────────────────────────────────────────────
  const handleKaggleCategoryChange = useCallback((source: DataSource, catId: string) => {
    setKaggleCategory(catId)
    setDatasetSearch('')
    setSelectedDynamic(null)
    setKaggleFiles([])
    setCheckedFiles(new Set())
    if (dynamicDebounce.current) clearTimeout(dynamicDebounce.current)
    fetchDynamic(source, '', catId)
  }, [fetchDynamic])

  // ── Static dataset select ─────────────────────────────────────────────────
  const handleSelectDataset = useCallback((source: DataSource, dataset: StaticDataSet) => {
    setSelectedSourceId(source.id)
    setSelectedDatasetId(dataset.id)
    setSelectedDynamic(null)
    setError(null)
    const defaults: Record<string, string> = {}
    for (const p of dataset.params) defaults[p.id] = p.default ?? ''
    setParams(defaults)
    setVarName(toRVarName(dataset.label ?? dataset.id))
  }, [])

  // ── Dynamic result select ─────────────────────────────────────────────────
  const handleSelectDynamic = useCallback((source: DataSource, result: DynamicResult) => {
    setSelectedSourceId(source.id)
    setSelectedDatasetId(null)
    setSelectedDynamic(result)
    setParams({})
    setVarName(toRVarName(result.label || result.id))
    setVarPrefix('')
    setError(null)
    if (source.dynamicType === 'kaggle') {
      fetchKaggleFiles(result.id)
    }
  }, [fetchKaggleFiles])

  // ── Dataset search ────────────────────────────────────────────────────────
  const handleDatasetSearch = useCallback((source: DataSource, q: string) => {
    setDatasetSearch(q)
    if (dynamicDebounce.current) clearTimeout(dynamicDebounce.current)
    dynamicDebounce.current = setTimeout(
      () => fetchDynamic(source, q, source.dynamicType === 'kaggle' ? kaggleCategory : undefined),
      400
    )
  }, [fetchDynamic, kaggleCategory])

  // ── Load ──────────────────────────────────────────────────────────────────
  const handleLoad = useCallback(async () => {
    const code = activeCode
    if (!code) return

    setLoading(true)
    setError(null)
    try {
      addConsoleEntry('input', code)
      const res = await rClient.execute(code)
      if (!res.success) {
        setError(res.error ?? 'Execution failed')
        return
      }

      if (isKaggle && selectedDynamic) {
        // Open one object tab per loaded file
        for (const fname of checkedFiles) {
          const vName = fileVarName(fname, varPrefix)
          useEditorStore.getState().addObjectTab(vName, '.GlobalEnv', 'data.frame', vName, 'data-viewer')
        }
      } else if (mode === 'manual') {
        if (manualFormat !== 'geotiff') {
          // Rasters have no tabular viewer; SpatRasters land in the
          // Environment panel and the Spatial Editor's Add-layer list.
          const isSpatial = manualFormat === 'geojson'
          useEditorStore.getState().addObjectTab(manualVarName, '.GlobalEnv', isSpatial ? 'sf' : 'data.frame', manualVarName, 'data-viewer')
        }
      } else {
        const isSpatial = activeSource ? sourceIsSpatial(activeSource) : false
        useEditorStore.getState().addObjectTab(varName, '.GlobalEnv', isSpatial ? 'sf' : 'data.frame', varName, 'data-viewer')
      }
      onOpenChange(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [activeCode, isKaggle, selectedDynamic, checkedFiles, varPrefix, mode, manualVarName, manualFormat, activeSource, varName, addConsoleEntry, onOpenChange])

  // ── Kaggle fallback load ──────────────────────────────────────────────────
  const handleKaggleFallbackLoad = useCallback(async () => {
    if (!selectedDynamic) return
    const code = buildKaggleFallbackCode(selectedDynamic.id, keys)
    setLoading(true)
    setError(null)
    try {
      addConsoleEntry('input', code)
      const res = await rClient.execute(code)
      if (!res.success) { setError(res.error ?? 'Execution failed'); return }
      onOpenChange(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedDynamic, keys, addConsoleEntry, onOpenChange])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const segBtn = (active: boolean) =>
    `px-3 py-1 text-xs rounded transition-colors ${
      active ? 'bg-geo-accent text-white' : 'text-geo-muted hover:text-foreground hover:bg-white/5'
    }`

  const toggleFile = (name: string) => {
    setCheckedFiles(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[780px] max-h-[85vh] bg-geo-panel border border-geo-border rounded-lg shadow-xl flex flex-col focus:outline-none">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">Data Connector</Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground"><X className="w-4 h-4" /></button>
            </Dialog.Close>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-geo-border flex-shrink-0 bg-geo-bg">
            <div className="flex gap-1 bg-geo-panel rounded p-0.5">
              <button className={segBtn(mode === 'browse')} onClick={() => setMode('browse')}>Browse Sources</button>
              <button className={segBtn(mode === 'webapis')} onClick={() => setMode('webapis')}>Web APIs</button>
              <button className={segBtn(mode === 'manual')} onClick={() => setMode('manual')}>Manual</button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0">

            {/* ── Browse mode ──────────────────────────────────────────── */}
            {mode === 'browse' && (
              <>
                {/* Left: source list */}
                <div className="w-[260px] flex-shrink-0 flex flex-col border-r border-geo-border min-h-0">
                  <div className="px-2 py-2 border-b border-geo-border flex-shrink-0">
                    <div className="flex items-center gap-1.5 bg-geo-bg border border-geo-border rounded px-2 py-1">
                      <Search className="w-3 h-3 text-geo-muted flex-shrink-0" />
                      <input
                        className="flex-1 bg-transparent text-xs text-foreground placeholder:text-geo-muted focus:outline-none"
                        placeholder="Search sources..."
                        value={sourceSearch}
                        onChange={e => setSourceSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {CATEGORIES.map(category => {
                      const categorySources = filteredSources.filter(s => s.category === category)
                      if (categorySources.length === 0) return null
                      return (
                        <div key={category}>
                          <div className="px-3 pt-3 pb-1">
                            <span className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider">{category}</span>
                          </div>
                          {categorySources.map(source => {
                            const isExpanded = expandedSourceId === source.id
                            return (
                              <div key={source.id}>
                                <button
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
                                  onClick={() => handleToggleSource(source)}
                                >
                                  {isExpanded
                                    ? <ChevronDown className="w-3 h-3 text-geo-muted flex-shrink-0" />
                                    : <ChevronRight className="w-3 h-3 text-geo-muted flex-shrink-0" />
                                  }
                                  <span className="flex-1 text-xs text-foreground">{source.label}</span>
                                  {source.dynamicCatalogue && (
                                    <span className="text-[9px] text-geo-accent border border-geo-accent/40 rounded px-1 py-0.5 flex-shrink-0">LIVE</span>
                                  )}
                                </button>

                                {/* Expanded: static datasets */}
                                {isExpanded && !source.dynamicCatalogue && (
                                  <div className="pb-1">
                                    {source.datasets.map(dataset => {
                                      const isSelected = selectedDatasetId === dataset.id && selectedSourceId === source.id
                                      return (
                                        <button
                                          key={dataset.id}
                                          className={cn(
                                            'w-full text-left px-6 py-1.5 text-xs transition-colors',
                                            isSelected ? 'text-geo-accent bg-geo-accent/10' : 'text-geo-muted hover:text-foreground hover:bg-white/5'
                                          )}
                                          onClick={() => handleSelectDataset(source, dataset)}
                                        >
                                          {dataset.label}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}

                                {/* Expanded: dynamic catalogue */}
                                {isExpanded && source.dynamicCatalogue && (
                                  <div className="pb-1">
                                    {/* Kaggle category chips */}
                                    {source.dynamicType === 'kaggle' && (
                                      <div className="px-3 pt-1.5 pb-1 overflow-x-auto">
                                        <div className="flex gap-1 min-w-max">
                                          {KAGGLE_CATEGORIES.map(cat => (
                                            <button
                                              key={cat.id}
                                              onClick={() => handleKaggleCategoryChange(source, cat.id)}
                                              className={cn(
                                                'px-2 py-0.5 text-[10px] rounded-full whitespace-nowrap transition-colors',
                                                kaggleCategory === cat.id
                                                  ? 'bg-geo-accent text-white'
                                                  : 'bg-geo-bg border border-geo-border text-geo-muted hover:text-foreground'
                                              )}
                                            >
                                              {cat.label}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Dataset search */}
                                    <div className="px-3 py-1.5">
                                      <div className="flex items-center gap-1.5 bg-geo-bg border border-geo-border rounded px-2 py-1">
                                        <Search className="w-3 h-3 text-geo-muted flex-shrink-0" />
                                        <input
                                          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-geo-muted focus:outline-none"
                                          placeholder="Search datasets..."
                                          value={datasetSearch}
                                          onChange={e => handleDatasetSearch(source, e.target.value)}
                                        />
                                      </div>
                                    </div>

                                    {dynamicLoading && (
                                      <div className="flex items-center gap-2 px-5 py-2">
                                        <Loader2 className="w-3 h-3 animate-spin text-geo-muted" />
                                        <span className="text-xs text-geo-muted">Fetching...</span>
                                      </div>
                                    )}
                                    {dynamicError && (
                                      <div className="px-4 py-1.5">
                                        <span className="text-xs text-geo-error">{dynamicError}</span>
                                      </div>
                                    )}
                                    {!dynamicLoading && !dynamicError && dynamicResults.map(result => {
                                      const isSelected = selectedDynamic?.id === result.id && selectedSourceId === source.id
                                      return (
                                        <button
                                          key={result.id}
                                          className={cn('w-full text-left px-5 py-1.5 transition-colors', isSelected ? 'bg-geo-accent/10' : 'hover:bg-white/5')}
                                          onClick={() => handleSelectDynamic(source, result)}
                                        >
                                          <div className={cn('text-xs font-medium truncate', isSelected ? 'text-geo-accent' : 'text-foreground')}>
                                            {result.label}
                                          </div>
                                          {result.description && (
                                            <div className="text-[10px] text-geo-muted truncate mt-0.5">{result.description}</div>
                                          )}
                                        </button>
                                      )
                                    })}
                                    {!dynamicLoading && !dynamicError && dynamicResults.length === 0 && (
                                      <div className="px-5 py-2">
                                        <span className="text-xs text-geo-muted">No results</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Right: config panel */}
                <div className="flex flex-col flex-1 min-w-0 min-h-0">
                  {!activeDataset && !selectedDynamic ? (
                    <div className="flex flex-1 items-center justify-center text-center p-8">
                      <div>
                        <p className="text-xs text-geo-muted">Select a source and dataset to configure it.</p>
                        <p className="text-xs text-geo-muted mt-1">API keys can be set in Settings → API Keys.</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-3">
                        {/* Title */}
                        <div>
                          <h3 className="text-xs font-semibold text-foreground">
                            {activeDataset ? activeDataset.label : selectedDynamic?.label ?? ''}
                          </h3>
                          <p className="text-[11px] text-geo-muted mt-0.5">
                            {activeDataset ? activeDataset.description : selectedDynamic?.description ?? ''}
                          </p>
                        </div>
                        <div className="h-px bg-geo-border" />

                        {/* Static params */}
                        {activeDataset && activeDataset.params.map(param => (
                          <div key={param.id} className="flex flex-col gap-1">
                            <label className="text-xs text-geo-muted">
                              {param.label}
                              {param.required && <span className="text-geo-error ml-0.5">*</span>}
                            </label>
                            {param.type === 'select' ? (
                              <select
                                value={params[param.id] ?? param.default ?? ''}
                                onChange={e => setParams(prev => ({ ...prev, [param.id]: e.target.value }))}
                                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                              >
                                {(param.options ?? []).map(opt => <option key={opt} value={opt}>{opt || '(all)'}</option>)}
                              </select>
                            ) : param.type === 'number' ? (
                              <input type="number"
                                value={params[param.id] ?? param.default ?? ''}
                                onChange={e => setParams(prev => ({ ...prev, [param.id]: e.target.value }))}
                                placeholder={param.placeholder}
                                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                              />
                            ) : param.type === 'textarea' ? (
                              <textarea
                                value={params[param.id] ?? param.default ?? ''}
                                onChange={e => setParams(prev => ({ ...prev, [param.id]: e.target.value }))}
                                placeholder={param.placeholder}
                                rows={3}
                                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent resize-none"
                              />
                            ) : (
                              <input type="text"
                                value={params[param.id] ?? param.default ?? ''}
                                onChange={e => setParams(prev => ({ ...prev, [param.id]: e.target.value }))}
                                placeholder={param.placeholder}
                                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                              />
                            )}
                          </div>
                        ))}

                        {/* FRED extra params */}
                        {selectedDynamic && activeSource?.dynamicType === 'fred' && (
                          <>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-geo-muted">Start Date (YYYY-MM-DD, optional)</label>
                              <input type="text" value={params.startDate ?? ''} onChange={e => setParams(prev => ({ ...prev, startDate: e.target.value }))} placeholder="2000-01-01" className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-geo-muted">End Date (YYYY-MM-DD, optional)</label>
                              <input type="text" value={params.endDate ?? ''} onChange={e => setParams(prev => ({ ...prev, endDate: e.target.value }))} placeholder="2024-12-31" className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                            </div>
                          </>
                        )}

                        {/* Kaggle file checkboxes */}
                        {isKaggle && selectedDynamic && (
                          <div className="flex flex-col gap-2">
                            <span className="text-xs text-geo-muted">Files to load</span>
                            {kaggleFilesLoading ? (
                              <div className="flex flex-col gap-1 py-1">
                                <div className="flex items-center gap-2">
                                  <Loader2 className="w-3 h-3 animate-spin text-geo-muted" />
                                  <span className="text-xs text-geo-muted">Downloading dataset to inspect files…</span>
                                </div>
                                <span className="text-[10px] text-geo-muted pl-5">This may take a moment for large datasets.</span>
                              </div>
                            ) : kaggleFilesError ? (
                              <div className="flex flex-col gap-2">
                                <div className="flex items-start gap-2 p-2 bg-geo-error/10 border border-geo-error/30 rounded">
                                  <AlertCircle className="w-3.5 h-3.5 text-geo-error flex-shrink-0 mt-0.5" />
                                  <span className="text-[11px] text-geo-error">{kaggleFilesError}</span>
                                </div>
                                {kaggleFallback && (
                                  <button
                                    onClick={handleKaggleFallbackLoad}
                                    disabled={loading}
                                    className="text-xs text-geo-accent hover:text-geo-accent/80 text-left disabled:opacity-50"
                                  >
                                    Download &amp; list files — downloads the full archive and prints its contents to the console
                                  </button>
                                )}
                              </div>
                            ) : kaggleFiles.length === 0 ? (
                              <span className="text-xs text-geo-muted">No files found</span>
                            ) : (
                              <div className="flex flex-col gap-1 bg-geo-bg border border-geo-border rounded p-2 max-h-40 overflow-y-auto">
                                {kaggleFiles.map(file => {
                                  const loadable = isLoadableExtension(file.name)
                                  const checked = checkedFiles.has(file.name)
                                  return (
                                    <label
                                      key={file.name}
                                      className={cn('flex items-center gap-2 cursor-pointer', !loadable && 'opacity-40 cursor-default')}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={!loadable}
                                        onChange={() => loadable && toggleFile(file.name)}
                                        className="accent-geo-accent"
                                      />
                                      <span className="text-xs text-foreground flex-1 truncate">{file.name}</span>
                                      <span className="text-[10px] text-geo-muted flex-shrink-0">{formatBytes(file.totalBytes)}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-geo-muted">Variable prefix (optional — e.g. "titanic" → titanic_train, titanic_test)</label>
                              <input
                                type="text"
                                value={varPrefix}
                                onChange={e => setVarPrefix(e.target.value)}
                                placeholder="Leave blank to use file stems directly"
                                className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                              />
                            </div>
                          </div>
                        )}

                        {/* Variable name (non-Kaggle) */}
                        {!isKaggle && (
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-geo-muted">Variable name</label>
                            <input
                              type="text"
                              value={varName}
                              onChange={e => setVarName(e.target.value)}
                              className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                            />
                          </div>
                        )}

                        {/* API key warning */}
                        {activeSource?.requiresKey && !keys[activeSource.requiresKey] && (
                          <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
                            <AlertCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
                            <span className="text-[11px] text-yellow-400">
                              {activeSource.dynamicType === 'kaggle'
                                ? 'Kaggle username and API key required. Add them in Settings → API Keys.'
                                : 'This source requires an API key. Add it in Settings → API Keys.'}
                            </span>
                          </div>
                        )}

                        {/* R code preview */}
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-geo-muted">Generated R code</span>
                          <pre className="bg-geo-bg border border-geo-border rounded p-2 text-[11px] text-foreground font-mono whitespace-pre-wrap overflow-x-auto">
                            {activeCode || '# Configure parameters above'}
                          </pre>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border flex-shrink-0">
                        {error && <span className="text-xs text-geo-error flex-1">{error}</span>}
                        <Dialog.Close asChild>
                          <Button variant="ghost" size="sm">Cancel</Button>
                        </Dialog.Close>
                        <Button size="sm" onClick={handleLoad} disabled={loading || !canLoad}>
                          {loading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Loading…</> : 'Load'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* ── Web APIs mode ────────────────────────────────────────── */}
            {mode === 'webapis' && <WebApisTab onClose={() => onOpenChange(false)} />}

            {/* ── Manual mode ──────────────────────────────────────────── */}
            {mode === 'manual' && (
              <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">API URL <span className="text-geo-error">*</span></label>
                  <input type="text" value={manualUrl} onChange={e => setManualUrl(e.target.value)} placeholder="https://api.example.com/data" className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">Auth header (e.g. Authorization: Bearer TOKEN)</label>
                  <input type="text" value={manualAuthHeader} onChange={e => setManualAuthHeader(e.target.value)} placeholder="Authorization: Bearer your-token" className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-geo-muted">Query parameters</label>
                    <button className="text-xs text-geo-accent hover:text-geo-accent/80 flex items-center gap-0.5" onClick={() => setManualQueryParams(prev => [...prev, { id: String(Date.now()), key: '', value: '' }])}>
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  {manualQueryParams.map((qp, idx) => (
                    <div key={qp.id} className="flex gap-1 items-center">
                      <input type="text" value={qp.key} onChange={e => setManualQueryParams(prev => prev.map((p, i) => i === idx ? { ...p, key: e.target.value } : p))} placeholder="key" className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                      <span className="text-geo-muted text-xs">=</span>
                      <input type="text" value={qp.value} onChange={e => setManualQueryParams(prev => prev.map((p, i) => i === idx ? { ...p, value: e.target.value } : p))} placeholder="value" className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                      <button className="text-geo-muted hover:text-geo-error" onClick={() => setManualQueryParams(prev => prev.filter((_, i) => i !== idx))}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-4">
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-xs text-geo-muted">Response format</label>
                    <div className="flex gap-1 bg-geo-bg rounded p-0.5">
                      {(['json', 'csv', 'geojson', 'geotiff'] as const).map(f => (
                        <button key={f} className={segBtn(manualFormat === f)} onClick={() => setManualFormat(f)}>
                          {f === 'geotiff' ? 'GeoTIFF / COG' : f.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    {manualFormat === 'geotiff' && (
                      <p className="text-[11px] text-geo-muted">
                        Read lazily via GDAL /vsicurl/ — ideal for Cloud-Optimized GeoTIFFs. Auth header and query parameters are not used.
                      </p>
                    )}
                  </div>
                  {manualFormat !== 'geotiff' && (
                    <div className="flex flex-col gap-1 w-28">
                      <label className="text-xs text-geo-muted">Record limit (0 = none)</label>
                      <input type="number" value={manualLimit} min={0} onChange={e => setManualLimit(Number(e.target.value))} className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">Variable name</label>
                  <input type="text" value={manualVarName} onChange={e => setManualVarName(e.target.value)} className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-xs text-geo-muted">Generated R code</span>
                  <pre className="bg-geo-bg border border-geo-border rounded p-2 text-[11px] text-foreground font-mono whitespace-pre-wrap overflow-x-auto min-h-[80px]">{activeCode}</pre>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  {error && <span className="text-xs text-geo-error flex-1">{error}</span>}
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm">Cancel</Button>
                  </Dialog.Close>
                  <Button size="sm" onClick={handleLoad} disabled={loading || !canLoad}>
                    {loading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Loading…</> : 'Load'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
