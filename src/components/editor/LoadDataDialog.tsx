import React, { useState, useRef, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Plus, Loader2, Lock, Eye, EyeOff, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import {
  type DataFormat, type ColumnType, type LoadColumnDef, type NewColumnDef,
  FORMAT_LABELS, COLUMN_TYPES, detectFormat, mapRTypeToColumn, buildLoadCode,
  isTabularFormat, isExcelFormat, isSpatialFormat, isRasterFormat,
} from '@/lib/load-data-code'


const R_FUNCTIONS = [
  'abs','ceiling','floor','round','sqrt','log','log10','exp',
  'sum','prod','cumsum','cumprod','diff','mean','median','var','sd',
  'max','min','range','which.max','which.min',
  'is.na','is.nan','is.null','is.numeric','is.character','is.integer',
  'as.numeric','as.character','as.integer','as.logical','as.Date',
  'paste','paste0','nchar','substr','toupper','tolower','trimws','gsub','sub','grepl',
  'ifelse','pmax','pmin','rank','rev','sort','order','unique','duplicated','table',
  'nrow','ncol','length','seq','seq_along','rep'
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function FormulaInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [activeIdx, setActiveIdx] = useState(0)

  const getFragment = (text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos)
    const match = before.match(/[a-zA-Z_.][a-zA-Z0-9_.]*$/)
    return match ? match[0] : ''
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    onChange(text)
    const fragment = getFragment(text, e.target.selectionStart ?? text.length)
    if (fragment.length >= 1) {
      const lower = fragment.toLowerCase()
      const filtered = suggestions.filter(s => s.toLowerCase().startsWith(lower)).slice(0, 8)
      setItems(filtered)
      setOpen(filtered.length > 0)
      setActiveIdx(0)
    } else {
      setOpen(false)
    }
  }

  const insertSuggestion = (suggestion: string) => {
    const input = inputRef.current
    if (!input) return
    const cursorPos = input.selectionStart ?? value.length
    const fragment = getFragment(value, cursorPos)
    const start = cursorPos - fragment.length
    const newValue = value.slice(0, start) + suggestion + value.slice(cursorPos)
    onChange(newValue)
    setOpen(false)
    requestAnimationFrame(() => {
      input.focus()
      const newPos = start + suggestion.length
      input.setSelectionRange(newPos, newPos)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, items.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertSuggestion(items[activeIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    }
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.closest('[data-formula-root]')?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative flex-1 min-w-0" data-formula-root="">
      <input
        ref={inputRef}
        className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'formula (optional)'}
        autoComplete="off"
        spellCheck={false}
      />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-0.5 bg-geo-panel border border-geo-border rounded shadow-xl overflow-hidden">
          {items.map((item, i) => (
            <div
              key={item}
              className={`px-2 py-1 text-xs cursor-pointer font-mono ${i === activeIdx ? 'bg-geo-accent/20 text-geo-accent' : 'text-foreground hover:bg-geo-bg'}`}
              onMouseDown={e => { e.preventDefault(); insertSuggestion(item) }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

interface LoadDataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialFilePath?: string | null
}

export function LoadDataDialog({ open, onOpenChange, initialFilePath }: LoadDataDialogProps): React.ReactElement {
  const addConsoleEntry = useSessionStore(s => s.addConsoleEntry)
  const addInputHistory = useSessionStore(s => s.addInputHistory)

  // File
  const [filePath, setFilePath] = useState<string | null>(null)
  const [format, setFormat] = useState<DataFormat>('csv')

  // Common
  const [varName, setVarName] = useState('')

  // Tabular settings
  const [delimiterPreset, setDelimiterPreset] = useState<string>(',')
  const [customDelimiter, setCustomDelimiter] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [skipRows, setSkipRows] = useState(0)
  const [encoding, setEncoding] = useState('UTF-8')
  const [naStrings, setNaStrings] = useState('NA')

  // Excel/ODS
  const [sheet, setSheet] = useState('')
  const [availableSheets, setAvailableSheets] = useState<string[]>([])

  // Spatial
  const [crsOverride, setCrsOverride] = useState('')
  const [layerName, setLayerName] = useState('')

  // Column state
  const [columns, setColumns] = useState<LoadColumnDef[]>([])
  const [newColumns, setNewColumns] = useState<NewColumnDef[]>([])
  const [previewed, setPreviewed] = useState(false)

  // UI state
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveDelimiter = delimiterPreset === 'custom' ? customDelimiter : delimiterPreset

  // When opened with an initial file path (e.g. from the workspace tree), populate
  // file state the same way handleBrowse does after a manual file pick.
  useEffect(() => {
    if (!open || !initialFilePath) return
    setFilePath(initialFilePath)
    setFormat(detectFormat(initialFilePath))
    const base = initialFilePath.split(/[\\/]/).pop() ?? ''
    const stem = base
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_.]/g, '_')
      .replace(/^[^a-zA-Z.]/, '_$&')
    setVarName(stem)
    setColumns([])
    setNewColumns([])
    setPreviewed(false)
    setError(null)
    setSheet('')
    setAvailableSheets([])
  }, [open, initialFilePath])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setFilePath(null)
      setFormat('csv')
      setVarName('')
      setDelimiterPreset(',')
      setCustomDelimiter('')
      setHasHeader(true)
      setSkipRows(0)
      setEncoding('UTF-8')
      setNaStrings('NA')
      setSheet('')
      setAvailableSheets([])
      setCrsOverride('')
      setLayerName('')
      setColumns([])
      setNewColumns([])
      setPreviewed(false)
      setError(null)
      setLoading(false)
      setPreviewing(false)
    }
    onOpenChange(next)
  }

  const handleBrowse = async () => {
    if (!window.electronAPI) return
    const path = await window.electronAPI.dialog.openDataFile()
    if (!path) return
    setFilePath(path)
    const detected = detectFormat(path)
    setFormat(detected)
    // Reset preview when file changes
    setColumns([])
    setNewColumns([])
    setPreviewed(false)
    setError(null)
    setSheet('')
    setAvailableSheets([])
    // Auto-suggest variable name from file base name
    const base = path.split(/[\\/]/).pop() ?? ''
    const stem = base.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_.]/g, '_').replace(/^[^a-zA-Z.]/, '_$&')
    if (!varName) setVarName(stem)
  }

  const handlePreview = async () => {
    if (!filePath) return
    setPreviewing(true)
    setError(null)
    try {
      const res = await rClient.previewData({
        file_path: filePath,
        format,
        sheet: sheet || undefined,
        skip: skipRows,
        header: hasHeader,
        sep: effectiveDelimiter,
      })
      if (!res.success) {
        setError(res.error || 'Preview failed')
        return
      }
      const data = res.result!
      setColumns(data.columns.map(c => ({
        name: c.name,
        type: mapRTypeToColumn(c.type),
        originalType: mapRTypeToColumn(c.type),
        formula: '',
        include: true,
        isGeometry: c.type === 'sf',
      })))
      if (data.sheet_names?.length > 0) {
        setAvailableSheets(data.sheet_names)
        if (!sheet) setSheet(data.sheet_names[0])
      }
      setPreviewed(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const handleLoad = async () => {
    if (!filePath) { setError('Please select a file'); return }
    if (!varName.trim()) { setError('Variable name is required'); return }
    if (previewed && newColumns.some(c => !c.name.trim())) {
      setError('All added columns must have a name')
      return
    }

    const code = buildLoadCode(varName.trim(), filePath, format, {
      delimiter: effectiveDelimiter,
      hasHeader,
      skipRows,
      encoding,
      naStrings,
      sheet,
      crsOverride,
      layerName,
    }, columns, newColumns)

    setLoading(true)
    setError(null)
    try {
      addConsoleEntry('input', code)
      addInputHistory(code)

      const res = await rClient.execute(code)
      if (!res.success && res.error) {
        setError(res.error)
        return
      }

      // Rasters have no tabular viewer — the console echo + Environment panel
      // carry them; everything else opens in the data viewer.
      if (!isRasterFormat(format)) {
        const isSpatial = isSpatialFormat(format) || columns.some(c => c.isGeometry)
        useEditorStore.getState().addObjectTab(
          varName.trim(),
          '.GlobalEnv',
          isSpatial ? 'sf' : 'data.frame',
          varName.trim(),
          'data-viewer'
        )
      }

      handleOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const allColNames = columns.map(c => c.name)
  const suggestions = [...allColNames, ...R_FUNCTIONS]

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[660px] max-h-[88vh] flex flex-col bg-geo-panel border border-geo-border rounded-lg shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">Load Data</Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-4">

            {/* File selection */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-geo-muted">File</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground font-mono truncate min-w-0">
                  {filePath ? filePath.split(/[\\/]/).pop() : <span className="text-geo-muted">No file selected</span>}
                </div>
                <button
                  className="flex items-center gap-1 text-xs text-geo-accent hover:text-geo-accent/80 px-2 py-1 border border-geo-border rounded bg-geo-bg whitespace-nowrap"
                  onClick={handleBrowse}
                >
                  <FolderOpen className="w-3 h-3" /> Browse...
                </button>
                {filePath && (
                  <span className="text-xs px-2 py-0.5 rounded bg-geo-accent/15 text-geo-accent font-mono flex-shrink-0">
                    {FORMAT_LABELS[format]}
                  </span>
                )}
              </div>
              {filePath && (
                <p className="text-xs text-geo-muted font-mono truncate">{filePath}</p>
              )}
            </div>

            {/* Variable name */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-geo-muted">Variable name</label>
              <input
                className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono w-48"
                value={varName}
                onChange={e => setVarName(e.target.value)}
                placeholder="e.g. my_data"
              />
            </div>

            {/* Format override */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-geo-muted">Format</label>
              <select
                className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent w-40"
                value={format}
                onChange={e => {
                  setFormat(e.target.value as DataFormat)
                  setColumns([])
                  setNewColumns([])
                  setPreviewed(false)
                }}
              >
                {(Object.keys(FORMAT_LABELS) as DataFormat[]).map(f => (
                  <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
                ))}
              </select>
            </div>

            {/* Tabular settings (csv / tsv / txt) */}
            {isTabularFormat(format) && (
              <div className="flex flex-col gap-3 p-3 bg-geo-bg border border-geo-border rounded">
                <span className="text-xs text-geo-muted font-semibold">Tabular settings</span>

                {/* Delimiter (csv and txt only) */}
                {format !== 'tsv' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-geo-muted">Delimiter</label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {[
                        { label: 'Comma', value: ',' },
                        { label: 'Tab', value: '\t' },
                        { label: 'Semicolon', value: ';' },
                        { label: 'Pipe', value: '|' },
                        { label: 'Space', value: ' ' },
                        { label: 'Custom', value: 'custom' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          className={`text-xs px-2 py-0.5 rounded border ${delimiterPreset === opt.value ? 'border-geo-accent text-geo-accent bg-geo-accent/10' : 'border-geo-border text-geo-muted hover:text-foreground'}`}
                          onClick={() => setDelimiterPreset(opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                      {delimiterPreset === 'custom' && (
                        <input
                          className="w-16 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                          value={customDelimiter}
                          onChange={e => setCustomDelimiter(e.target.value)}
                          placeholder="e.g. |"
                          maxLength={4}
                        />
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-6 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} className="accent-geo-accent" />
                    <span className="text-xs text-foreground">Header row</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">Skip rows</span>
                    <input
                      type="number"
                      min={0}
                      className="w-16 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={skipRows}
                      onChange={e => setSkipRows(Math.max(0, parseInt(e.target.value) || 0))}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">Encoding</span>
                    <select
                      className="bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent"
                      value={encoding}
                      onChange={e => setEncoding(e.target.value)}
                    >
                      <option value="UTF-8">UTF-8</option>
                      <option value="latin1">Latin-1</option>
                      <option value="UTF-16">UTF-16</option>
                      <option value="windows-1252">Windows-1252</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">NA strings</span>
                    <input
                      className="w-32 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={naStrings}
                      onChange={e => setNaStrings(e.target.value)}
                      placeholder="NA, N/A, ..."
                      title="Comma-separated list of strings to treat as NA"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Excel / ODS settings */}
            {isExcelFormat(format) && (
              <div className="flex flex-col gap-3 p-3 bg-geo-bg border border-geo-border rounded">
                <span className="text-xs text-geo-muted font-semibold">Spreadsheet settings</span>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">Sheet</span>
                    {availableSheets.length > 0 ? (
                      <select
                        className="bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent"
                        value={sheet}
                        onChange={e => setSheet(e.target.value)}
                      >
                        {availableSheets.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input
                        className="w-32 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                        value={sheet}
                        onChange={e => setSheet(e.target.value)}
                        placeholder="Sheet1 or 1"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">Skip rows</span>
                    <input
                      type="number"
                      min={0}
                      className="w-16 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={skipRows}
                      onChange={e => setSkipRows(Math.max(0, parseInt(e.target.value) || 0))}
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} className="accent-geo-accent" />
                    <span className="text-xs text-foreground">Header row</span>
                  </label>
                </div>
              </div>
            )}

            {/* Spatial settings */}
            {isSpatialFormat(format) && (
              <div className="flex flex-col gap-3 p-3 bg-geo-bg border border-geo-border rounded">
                <span className="text-xs text-geo-muted font-semibold">Spatial settings</span>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">CRS override</span>
                    <input
                      className="w-24 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={crsOverride}
                      onChange={e => setCrsOverride(e.target.value)}
                      placeholder="e.g. 4326"
                      title="EPSG code to reproject to (blank = use file's CRS)"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">Layer</span>
                    <input
                      className="w-32 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={layerName}
                      onChange={e => setLayerName(e.target.value)}
                      placeholder="layer name"
                      title="Layer name (for multi-layer formats like GeoPackage)"
                    />
                  </div>
                </div>
                <p className="text-xs text-geo-muted">Leave CRS override blank to use the file's native CRS.</p>
              </div>
            )}

            {/* Raster settings */}
            {isRasterFormat(format) && (
              <div className="flex flex-col gap-3 p-3 bg-geo-bg border border-geo-border rounded">
                <span className="text-xs text-geo-muted font-semibold">Raster settings</span>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">Reproject to</span>
                    <input
                      className="w-24 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={crsOverride}
                      onChange={e => setCrsOverride(e.target.value)}
                      placeholder="e.g. 4326"
                      title="EPSG code to warp to on import (blank = keep the file's CRS)"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted">Subdataset</span>
                    <input
                      className="w-32 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={layerName}
                      onChange={e => setLayerName(e.target.value)}
                      placeholder="variable name"
                      title="Subdataset/variable to read (for NetCDF/HDF containers)"
                    />
                  </div>
                </div>
                <p className="text-xs text-geo-muted">
                  Loaded with terra::rast() — lazy, GDAL-backed. Add it to the map from the Spatial Editor.
                </p>
              </div>
            )}

            {/* Preview button (column preview is tabular/vector only) */}
            {!isRasterFormat(format) && (
              <button
                className="flex items-center gap-1.5 self-start text-xs text-geo-accent hover:text-geo-accent/80 px-3 py-1.5 border border-geo-accent/40 rounded disabled:opacity-40"
                onClick={handlePreview}
                disabled={!filePath || previewing}
              >
                {previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {previewed ? 'Refresh Columns' : 'Preview Columns'}
              </button>
            )}

            {/* Column configuration (after preview) */}
            {previewed && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-geo-muted">Detected columns</span>

                {columns.map((col, i) => (
                  <div key={col.name + i} className={`flex items-center gap-2 p-2 rounded border ${col.include ? 'bg-geo-bg border-geo-border' : 'bg-geo-bg/50 border-geo-border/40 opacity-60'}`}>
                    {/* Include toggle */}
                    <button
                      className={`flex-shrink-0 ${col.include ? 'text-geo-accent' : 'text-geo-muted'}`}
                      onClick={() => setColumns(cs => cs.map((c, j) => j === i ? { ...c, include: !c.include } : c))}
                      title={col.include ? 'Exclude column' : 'Include column'}
                    >
                      {col.include ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    </button>

                    {/* Lock icon + name */}
                    <div className="flex items-center gap-1 w-32 flex-shrink-0">
                      <Lock className="w-2.5 h-2.5 text-geo-muted flex-shrink-0" />
                      <span className="text-xs text-foreground font-mono truncate" title={col.name}>{col.name}</span>
                    </div>

                    {/* Type dropdown (disabled for geometry) */}
                    {col.isGeometry ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-geo-accent/15 text-geo-accent font-mono flex-shrink-0">geometry</span>
                    ) : (
                      <select
                        className="bg-geo-panel border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent flex-shrink-0"
                        value={col.type}
                        onChange={e => setColumns(cs => cs.map((c, j) => j === i ? { ...c, type: e.target.value as ColumnType } : c))}
                        disabled={!col.include}
                      >
                        {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}

                    {/* Formula */}
                    {!col.isGeometry && col.include && (
                      <FormulaInput
                        value={col.formula}
                        onChange={v => setColumns(cs => cs.map((c, j) => j === i ? { ...c, formula: v } : c))}
                        suggestions={suggestions}
                        placeholder={`e.g. log(${col.name})`}
                      />
                    )}
                  </div>
                ))}

                {/* Divider for new columns */}
                {newColumns.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex-1 border-t border-geo-border" />
                    <span className="text-xs text-geo-muted">Added columns</span>
                    <div className="flex-1 border-t border-geo-border" />
                  </div>
                )}

                {newColumns.map(col => (
                  <div key={col.id} className="flex items-center gap-2 p-2 bg-geo-bg border border-geo-border rounded">
                    <input
                      className="w-28 flex-shrink-0 bg-geo-panel border border-geo-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                      value={col.name}
                      onChange={e => setNewColumns(cs => cs.map(c => c.id === col.id ? { ...c, name: e.target.value } : c))}
                      placeholder="column name"
                    />
                    <select
                      className="bg-geo-panel border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent flex-shrink-0"
                      value={col.type}
                      onChange={e => setNewColumns(cs => cs.map(c => c.id === col.id ? { ...c, type: e.target.value as ColumnType } : c))}
                    >
                      {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <FormulaInput
                      value={col.formula}
                      onChange={v => setNewColumns(cs => cs.map(c => c.id === col.id ? { ...c, formula: v } : c))}
                      suggestions={suggestions}
                      placeholder="e.g. col1 + col2"
                    />
                    <button
                      className="text-geo-muted hover:text-geo-error flex-shrink-0"
                      onClick={() => setNewColumns(cs => cs.filter(c => c.id !== col.id))}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                <button
                  className="text-xs text-geo-accent hover:text-geo-accent/80 flex items-center gap-1 self-start"
                  onClick={() => setNewColumns(cs => [...cs, { id: crypto.randomUUID(), name: '', type: 'character', formula: '' }])}
                >
                  <Plus className="w-3 h-3" /> Add Column
                </button>
              </div>
            )}

            {error && <p className="text-xs text-geo-error">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border flex-shrink-0">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button
              size="sm"
              onClick={handleLoad}
              disabled={loading || !filePath || !varName.trim()}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Load
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
