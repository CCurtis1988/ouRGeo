import React, { useState, useRef, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import { Button } from '../ui/button'

type AddColumnMode = 'dataframe' | 'matrix' | 'vector'
type ColumnDataType = 'character' | 'numeric' | 'integer'
type ConvertTarget = 'matrix' | 'data.frame' | 'data.table' | 'tibble'
type SpatialLib = 'sf' | 'geos'

import { SF_GEOM_TYPES, sfGeomTypeLabel } from './dataViewerShared'
import type { SfGeomType } from './dataViewerShared'
import { useSpatialSettingsStore } from '@/store/spatialSettings'

type SfAgr = 'NA' | 'constant' | 'aggregate' | 'identity'

interface AddColumnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: AddColumnMode
  dfClass?: string
  accessPath: string
  onConfirm: (code: string, newObjectClass?: string, opts?: { formula?: string; newColumn?: string; newColumnType?: string }) => Promise<void>
  columns?: string[]
}

const NA_TYPE: Record<ColumnDataType, string> = {
  character: 'NA_character_',
  numeric: 'NA_real_',
  integer: 'NA_integer_'
}

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

function quoteColName(name: string): string {
  if (/^[a-zA-Z.][a-zA-Z0-9._]*$/.test(name)) return name
  return '`' + name + '`'
}

function FormulaInput({
  value,
  onChange,
  suggestions,
  onEnter,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  onEnter: () => void
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
      const filtered = suggestions.filter((s) => s.toLowerCase().startsWith(lower)).slice(0, 8)
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
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, items.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertSuggestion(items[activeIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        return
      }
    }
    if (e.key === 'Enter' && !open) {
      e.preventDefault()
      onEnter()
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
    <div className="relative" data-formula-root="">
      <input
        ref={inputRef}
        className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'e.g. A + B  or  sqrt(x)'}
        autoComplete="off"
        spellCheck={false}
      />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-0.5 bg-geo-panel border border-geo-border rounded shadow-xl overflow-hidden">
          {items.map((item, i) => (
            <div
              key={item}
              className={`px-2 py-1 text-xs cursor-pointer font-mono ${
                i === activeIdx ? 'bg-geo-accent/20 text-geo-accent' : 'text-foreground hover:bg-geo-bg'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertSuggestion(item)
              }}
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

export function AddColumnDialog({
  open,
  onOpenChange,
  mode,
  dfClass,
  accessPath,
  onConfirm,
  columns
}: AddColumnDialogProps): React.ReactElement {
  const [colName, setColName] = useState('')
  const [colType, setColType] = useState<ColumnDataType>('character')
  const [convertTarget, setConvertTarget] = useState<ConvertTarget>('data.frame')
  const [formula, setFormula] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Spatial state
  const [spatialLib, setSpatialLib] = useState<SpatialLib | null>(null)
  const [geomType, setGeomType] = useState<SfGeomType>('POINT')
  const [convertToSf, setConvertToSf] = useState(false)
  // Seeded from Settings → Spatial Editor → "Default CRS for new geometry"
  const [crs, setCrs] = useState(() => useSpatialSettingsStore.getState().defaultCrs)
  const [geomColAlias, setGeomColAlias] = useState('')
  const [precision, setPrecision] = useState('')
  const [showAgr, setShowAgr] = useState(false)
  const [agr, setAgr] = useState<SfAgr>('NA')

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setColName('')
      setColType('character')
      setConvertTarget('data.frame')
      setFormula('')
      setError(null)
      setSpatialLib(null)
      setGeomType('POINT')
      setConvertToSf(false)
      setCrs(useSpatialSettingsStore.getState().defaultCrs)
      setGeomColAlias('')
      setPrecision('')
      setShowAgr(false)
      setAgr('NA')
    }
    onOpenChange(next)
  }

  const handleConfirm = async () => {
    setError(null)

    let code: string
    let newObjectClass: string | undefined

    if (mode === 'dataframe') {
      if (!colName.trim()) {
        setError('Column name is required')
        return
      }
      const quotedName = quoteColName(colName.trim())
      const trimmedFormula = formula.trim()

      if (spatialLib) {
        const emptyGeom = `"${geomType} EMPTY"`
        const lines: string[] = []

        if (spatialLib === 'sf') {
          if (trimmedFormula) {
            lines.push(`${accessPath}$${quotedName} <- with(${accessPath}, ${trimmedFormula})`)
          } else {
            lines.push(`${accessPath}$${quotedName} <- sf::st_as_sfc(rep(${emptyGeom}, nrow(${accessPath})), crs = ${crs})`)
          }
          if (convertToSf) {
            const sfColName = geomColAlias.trim() || colName.trim()
            lines.push(`${accessPath} <- sf::st_sf(${accessPath}, sf_column_name = "${sfColName}")`)
            const trimmedPrecision = precision.trim()
            if (trimmedPrecision && trimmedPrecision !== '0') {
              lines.push(`${accessPath} <- sf::st_set_precision(${accessPath}, ${trimmedPrecision})`)
            }
            if (agr !== 'NA') {
              lines.push(`sf::st_agr(${accessPath}) <- "${agr}"`)
            }
          }
        } else {
          // geos
          if (trimmedFormula) {
            lines.push(`${accessPath}$${quotedName} <- with(${accessPath}, ${trimmedFormula})`)
          } else {
            lines.push(`${accessPath}$${quotedName} <- geos::as_geos_geometry(rep(${emptyGeom}, nrow(${accessPath})))`)
          }
        }

        code = lines.join('\n')
      } else if (dfClass === 'data.table') {
        code = trimmedFormula
          ? `${accessPath}[, ${quotedName} := ${trimmedFormula}]`
          : `${accessPath}[, ${quotedName} := rep(${NA_TYPE[colType]}, nrow(${accessPath}))]`
      } else {
        code = trimmedFormula
          ? `${accessPath}$${quotedName} <- with(${accessPath}, ${trimmedFormula})`
          : `${accessPath}$${quotedName} <- rep(${NA_TYPE[colType]}, nrow(${accessPath}))`
      }
    } else if (mode === 'matrix') {
      const typeFn = colType === 'character' ? 'character' : colType === 'integer' ? 'integer' : 'numeric'
      code = `${accessPath} <- cbind(${accessPath}, ${typeFn}(nrow(${accessPath})))`
    } else {
      // vector conversion
      if (convertTarget === 'matrix') {
        code = `${accessPath} <- as.matrix(${accessPath})`
        newObjectClass = 'matrix'
      } else if (convertTarget === 'data.frame') {
        code = `${accessPath} <- data.frame(value = ${accessPath})`
        newObjectClass = 'data.frame'
      } else if (convertTarget === 'data.table') {
        code = `${accessPath} <- data.table::data.table(value = ${accessPath})`
        newObjectClass = 'data.table'
      } else {
        code = `${accessPath} <- tibble::tibble(value = ${accessPath})`
        newObjectClass = 'tbl_df'
      }
    }

    // Predicted display type of the new column, so the grid can append it
    // optimistically (matches R's class()[1]: sfc_<GEOM>, geos_geometry, else
    // the chosen scalar type).
    const newColumnType =
      mode !== 'dataframe' ? undefined
        : spatialLib === 'sf' ? `sfc_${geomType}`
        : spatialLib === 'geos' ? 'geos_geometry'
        : colType

    setLoading(true)
    try {
      const trimmedFormula = formula.trim()
      const trimmedName = colName.trim()
      await onConfirm(code, newObjectClass, {
        formula: trimmedFormula || undefined,
        newColumn: trimmedName || undefined,
        newColumnType,
      })
      handleOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const isDataTable = dfClass === 'data.table'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-h-[85vh] overflow-y-auto bg-geo-panel border border-geo-border rounded-lg shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              {mode === 'vector' ? 'Convert Vector' : 'Add Column'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-4 flex flex-col gap-4">
            {mode === 'dataframe' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">Column name</label>
                  <input
                    autoFocus
                    className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
                    value={colName}
                    onChange={(e) => setColName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
                    placeholder="e.g. new_column"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">Column type</label>
                  <div className="flex items-center gap-3 flex-wrap">
                    {(['character', 'numeric', 'integer'] as ColumnDataType[]).map((t) => (
                      <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="colType"
                          value={t}
                          checked={colType === t && spatialLib === null}
                          onChange={() => { setColType(t); setSpatialLib(null) }}
                          className="accent-geo-accent"
                        />
                        <span className="text-xs text-foreground">{t}</span>
                      </label>
                    ))}
                    <span className="text-geo-border text-xs select-none">·</span>
                    {(['sf', 'geos'] as SpatialLib[]).map((lib) => (
                      <label key={lib} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="colType"
                          value={lib}
                          checked={spatialLib === lib}
                          onChange={() => setSpatialLib(lib)}
                          className="accent-geo-accent"
                        />
                        <span className="text-xs text-foreground">{lib}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {spatialLib && (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-geo-muted">Geometry type</label>
                      <select
                        className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
                        value={geomType}
                        onChange={(e) => setGeomType(e.target.value as SfGeomType)}
                      >
                        {SF_GEOM_TYPES.map((gt) => (
                          <option key={gt} value={gt}>
                            {sfGeomTypeLabel(gt)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {spatialLib === 'sf' && (
                      <div className="flex flex-col gap-2">
                        <label
                          className={`flex items-center gap-2 cursor-pointer ${isDataTable ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={isDataTable ? 'st_sf() does not work with data.table' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={convertToSf}
                            disabled={isDataTable}
                            onChange={(e) => setConvertToSf(e.target.checked)}
                            className="accent-geo-accent"
                          />
                          <span className="text-xs text-foreground">Convert to sf object</span>
                          {isDataTable && (
                            <span className="text-xs text-geo-muted">(unavailable for data.table)</span>
                          )}
                        </label>

                        {convertToSf && (
                          <div className="pl-4 flex flex-col gap-3 border-l border-geo-border">
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-geo-muted">CRS (EPSG code or proj string)</label>
                              <input
                                className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                                value={crs}
                                onChange={(e) => setCrs(e.target.value)}
                                placeholder="4326"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-geo-muted">Geometry column name (optional)</label>
                              <input
                                className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                                value={geomColAlias}
                                onChange={(e) => setGeomColAlias(e.target.value)}
                                placeholder={colName || 'geom'}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-geo-muted">Precision (0 = default, leave blank to omit)</label>
                              <input
                                type="number"
                                className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                                value={precision}
                                onChange={(e) => setPrecision(e.target.value)}
                                placeholder=""
                                min={0}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-geo-muted hover:text-foreground"
                                onClick={() => setShowAgr((v) => !v)}
                              >
                                {showAgr ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                AGR settings
                              </button>
                              {showAgr && (
                                <div className="pl-3 flex flex-col gap-2 mt-1">
                                  <p className="text-xs text-geo-muted">
                                    Attribute-geometry relationship applied to all non-geometry columns
                                  </p>
                                  <select
                                    className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
                                    value={agr}
                                    onChange={(e) => setAgr(e.target.value as SfAgr)}
                                  >
                                    {(['NA', 'constant', 'aggregate', 'identity'] as SfAgr[]).map((a) => (
                                      <option key={a} value={a}>{a}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {spatialLib === 'geos' && (
                      <p className="text-xs text-geo-muted">
                        geos geometry columns live in a plain data.frame — no object conversion needed.
                      </p>
                    )}
                  </>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">
                    Formula <span className="text-geo-muted/60">(optional — leave blank for NA/empty fill)</span>
                  </label>
                  <FormulaInput
                    value={formula}
                    onChange={setFormula}
                    suggestions={[...(columns ?? []), ...R_FUNCTIONS]}
                    onEnter={handleConfirm}
                    placeholder={
                      spatialLib
                        ? 'e.g. sf::st_point(c(lon, lat))  or  sf::st_as_sfc(wkt_col)'
                        : 'e.g. A + B  or  sqrt(x)'
                    }
                  />
                </div>
              </>
            )}

            {mode === 'matrix' && (
              <>
                <p className="text-xs text-geo-muted">
                  A new column of NAs will be appended. If the matrix type doesn't match, R will coerce automatically.
                </p>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">Column type</label>
                  <div className="flex gap-3">
                    {(['character', 'numeric', 'integer'] as ColumnDataType[]).map((t) => (
                      <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="colType"
                          value={t}
                          checked={colType === t}
                          onChange={() => setColType(t)}
                          className="accent-geo-accent"
                        />
                        <span className="text-xs text-foreground">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {mode === 'vector' && (
              <>
                <p className="text-xs text-geo-muted">
                  Vectors don't have columns. To add columns, convert this vector to another structure first.
                </p>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted">Convert to</label>
                  <div className="flex flex-col gap-2">
                    {(['matrix', 'data.frame', 'data.table', 'tibble'] as ConvertTarget[]).map((t) => (
                      <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="convertTarget"
                          value={t}
                          checked={convertTarget === t}
                          onChange={() => setConvertTarget(t)}
                          className="accent-geo-accent"
                        />
                        <span className="text-xs text-foreground">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && <p className="text-xs text-geo-error">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={loading}
              className="bg-geo-accent hover:bg-geo-accent/80 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Running...
                </>
              ) : mode === 'vector' ? 'Convert' : 'Add Column'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
