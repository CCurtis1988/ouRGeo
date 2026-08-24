import React, { useState, useRef, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Plus, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'

export type CreateDataType = 'vector' | 'matrix' | 'data.frame' | 'tibble' | 'data.table'

import { SF_GEOM_TYPES, sfGeomTypeLabel } from './dataViewerShared'
import type { SfGeomType } from './dataViewerShared'
import { useSpatialSettingsStore } from '@/store/spatialSettings'

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

const COLUMN_TYPES = ['character', 'numeric', 'integer', 'logical', 'factor', 'Date'] as const
type ColumnType = typeof COLUMN_TYPES[number] | 'sf' | 'geos'

function quoteColName(name: string): string {
  if (/^[a-zA-Z.][a-zA-Z0-9._]*$/.test(name)) return name
  return '`' + name + '`'
}

interface ColumnDef {
  id: string
  name: string
  type: ColumnType
  formula: string
  sfGeomType: SfGeomType
  sfCrs: string
  sfSetAsGeom: boolean
}

function makeColumn(name = 'col1'): ColumnDef {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'character',
    formula: '',
    sfGeomType: 'POINT',
    // Seed from Settings → Spatial Editor → "Default CRS for new geometry"
    sfCrs: useSpatialSettingsStore.getState().defaultCrs,
    sfSetAsGeom: false,
  }
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

function ColumnRow({
  col,
  isVector,
  canRemove,
  canSetSfGeom,
  allColumnNames,
  onChange,
  onRemove,
}: {
  col: ColumnDef
  isVector: boolean
  canRemove: boolean
  canSetSfGeom: boolean
  allColumnNames: string[]
  onChange: (partial: Partial<ColumnDef>) => void
  onRemove: () => void
}) {
  const isSpatial = col.type === 'sf' || col.type === 'geos'
  const suggestions = [...allColumnNames, ...R_FUNCTIONS]

  return (
    <div className="flex flex-col gap-2 p-3 bg-geo-bg border border-geo-border rounded">
      <div className="flex items-center gap-2">
        {!isVector && (
          <input
            className="w-24 bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono flex-shrink-0"
            value={col.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="column name"
          />
        )}
        <select
          className="bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent flex-shrink-0"
          value={col.type}
          onChange={(e) => onChange({ type: e.target.value as ColumnType })}
        >
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          <option value="sf">sf</option>
          <option value="geos">geos</option>
        </select>
        <div className="flex-1 min-w-0">
          <FormulaInput
            value={col.formula}
            onChange={(v) => onChange({ formula: v })}
            suggestions={suggestions}
            onEnter={() => {}}
            placeholder={
              isVector
                ? 'e.g. seq(1, 10)'
                : col.type === 'sf'
                ? 'e.g. sf::st_as_sfc(wkt_col, crs = 4326)'
                : col.type === 'geos'
                ? 'e.g. geos::as_geos_geometry(wkt_col)'
                : 'e.g. seq_len(n) * 2'
            }
          />
        </div>
        {canRemove && (
          <button
            className="text-geo-muted hover:text-geo-error flex-shrink-0"
            onClick={onRemove}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {isSpatial && (
        <div className="flex flex-col gap-2 pl-2 border-l border-geo-border">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-geo-muted">Geometry type</label>
            <select
              className="bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
              value={col.sfGeomType}
              onChange={(e) => onChange({ sfGeomType: e.target.value as SfGeomType })}
            >
              {SF_GEOM_TYPES.map((gt) => (
                <option key={gt} value={gt}>
                  {sfGeomTypeLabel(gt)}
                </option>
              ))}
            </select>
          </div>
          {col.type === 'sf' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-geo-muted">CRS (EPSG)</label>
                <input
                  className="bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono w-24"
                  value={col.sfCrs}
                  onChange={(e) => onChange({ sfCrs: e.target.value })}
                  placeholder="4326"
                />
              </div>
              {canSetSfGeom && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={col.sfSetAsGeom}
                    onChange={(e) => onChange({ sfSetAsGeom: e.target.checked })}
                    className="accent-geo-accent"
                  />
                  <span className="text-xs text-foreground">Set as sf geometry column</span>
                </label>
              )}
            </>
          )}
        </div>
      )}

    </div>
  )
}

function buildCode(varName: string, nRows: number, columns: ColumnDef[], type: CreateDataType): string {
  const lines: string[] = []

  if (type === 'vector') {
    const col = columns[0]
    if (col.formula.trim()) {
      lines.push(`${varName} <- ${col.formula.trim()}`)
    } else if (col.type === 'Date') {
      lines.push(`${varName} <- as.Date(rep(NA, ${nRows}))`)
    } else if (col.type === 'factor') {
      lines.push(`${varName} <- factor(rep(NA, ${nRows}))`)
    } else if (col.type === 'sf' || col.type === 'geos') {
      lines.push(`${varName} <- character(${nRows})`)
    } else {
      lines.push(`${varName} <- ${col.type}(${nRows})`)
    }
    return lines.join('\n')
  }

  if (type === 'matrix') {
    lines.push(`${varName} <- matrix(NA, nrow = ${nRows}, ncol = ${columns.length})`)
    lines.push(`colnames(${varName}) <- c(${columns.map((c) => `"${c.name}"`).join(', ')})`)
    columns.forEach((col, i) => {
      if (col.formula.trim()) {
        lines.push(`${varName}[, ${i + 1}] <- ${col.formula.trim()}`)
      }
    })
    return lines.join('\n')
  }

  // data.frame, tibble, data.table
  // tibble supports sfc list-columns inline; data.frame and data.table do not,
  // so sf columns must be assigned after the constructor call.
  const buildColExpr = (col: ColumnDef): string => {
    const q = quoteColName(col.name)
    if (col.type === 'sf') {
      if (col.formula.trim()) return `${q} = ${col.formula.trim()}`
      return `${q} = sf::st_as_sfc(rep("${col.sfGeomType} EMPTY", ${nRows}), crs = ${col.sfCrs})`
    }
    if (col.type === 'geos') {
      if (col.formula.trim()) return `${q} = ${col.formula.trim()}`
      return `${q} = geos::as_geos_geometry(rep("${col.sfGeomType} EMPTY", ${nRows}))`
    }
    if (col.formula.trim()) return `${q} = ${col.formula.trim()}`
    if (col.type === 'Date') return `${q} = as.Date(rep(NA, ${nRows}))`
    if (col.type === 'factor') return `${q} = factor(rep(NA, ${nRows}))`
    return `${q} = ${col.type}(${nRows})`
  }

  if (type === 'tibble') {
    const colBlock = columns.map((c) => `  ${buildColExpr(c)}`).join(',\n')
    lines.push(`${varName} <- tibble::tibble(\n${colBlock}\n)`)
  } else {
    // data.frame / data.table: exclude sf columns from the constructor
    const sfCols = columns.filter((c) => c.type === 'sf')
    const regularCols = columns.filter((c) => c.type !== 'sf')
    const regularExprs = regularCols.map((c) => `  ${buildColExpr(c)}`)

    if (type === 'data.frame') {
      const colBlock =
        regularExprs.length > 0
          ? regularExprs.join(',\n') + ',\n  stringsAsFactors = FALSE'
          : `  row.names = seq_len(${nRows}),\n  stringsAsFactors = FALSE`
      lines.push(`${varName} <- data.frame(\n${colBlock}\n)`)
    } else {
      const colBlock =
        regularExprs.length > 0 ? regularExprs.join(',\n') : `  .rows = ${nRows}`
      lines.push(`${varName} <- data.table::data.table(\n${colBlock}\n)`)
    }

    // Assign sf columns after construction
    sfCols.forEach((col) => {
      const q = quoteColName(col.name)
      const sfc = col.formula.trim()
        ? col.formula.trim()
        : `sf::st_as_sfc(rep("${col.sfGeomType} EMPTY", ${nRows}), crs = ${col.sfCrs})`
      if (type === 'data.table') {
        lines.push(`${varName}[, ${q} := ${sfc}]`)
      } else {
        lines.push(`${varName}$${q} <- ${sfc}`)
      }
    })
  }

  // sf geometry promotion (all three types)
  const sfGeomCols = columns.filter((c) => c.type === 'sf' && c.sfSetAsGeom)
  if (sfGeomCols.length > 0) {
    if (type === 'data.table') {
      lines.push(`${varName} <- sf::st_as_sf(${varName})`)
    } else {
      lines.push(`${varName} <- sf::st_sf(${varName}, sf_column_name = "${sfGeomCols[0].name}")`)
    }
  }

  return lines.join('\n')
}

interface CreateDataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: CreateDataType
}

export function CreateDataDialog({ open, onOpenChange, type }: CreateDataDialogProps): React.ReactElement {
  const [varName, setVarName] = useState('')
  const [nRows, setNRows] = useState(1)
  const [columns, setColumns] = useState<ColumnDef[]>([makeColumn('col1')])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setVarName('')
      setNRows(1)
      setColumns([makeColumn('col1')])
      setError(null)
      setLoading(false)
    }
    onOpenChange(next)
  }

  const handleColumnChange = (id: string, partial: Partial<ColumnDef>) => {
    setColumns((cols) =>
      cols.map((c) => {
        if (c.id !== id) {
          // If setting sfSetAsGeom on another column, uncheck this one
          if (partial.sfSetAsGeom) return { ...c, sfSetAsGeom: false }
          return c
        }
        return { ...c, ...partial }
      })
    )
  }

  const handleConfirm = async () => {
    setError(null)
    if (!varName.trim()) {
      setError('Variable name is required')
      return
    }
    if (type !== 'vector' && columns.some((c) => !c.name.trim())) {
      setError('All columns must have a name')
      return
    }

    const code = buildCode(varName.trim(), nRows, columns, type)

    const sfPromoted = columns.some((c) => c.type === 'sf' && c.sfSetAsGeom)
    const classMap: Record<CreateDataType, string> = {
      vector: columns[0].type === 'sf' || columns[0].type === 'geos' ? 'character' : columns[0].type,
      matrix: 'matrix',
      'data.frame': sfPromoted ? 'sf' : 'data.frame',
      tibble: sfPromoted ? 'sf' : 'tbl_df',
      'data.table': sfPromoted ? 'sf' : 'data.table',
    }
    const objectClass = classMap[type]

    setLoading(true)
    try {
      addConsoleEntry('input', code)
      addInputHistory(code)

      const res = await rClient.execute(code)
      if (!res.success && res.error) {
        setError(res.error)
        return
      }

      useEditorStore.getState().addObjectTab(
        varName.trim(),
        '.GlobalEnv',
        objectClass,
        varName.trim(),
        'data-viewer'
      )

      handleOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[520px] max-h-[85vh] overflow-y-auto bg-geo-panel border border-geo-border rounded-lg shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Create {type}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-geo-muted">Variable name</label>
              <input
                autoFocus
                className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent font-mono"
                value={varName}
                onChange={(e) => setVarName(e.target.value)}
                placeholder="e.g. my_data"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-geo-muted">
                {type === 'vector' ? 'Length' : 'Number of rows'}
              </label>
              <input
                type="number"
                min={0}
                className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent w-24 font-mono"
                value={nRows}
                onChange={(e) => setNRows(Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>

            {type === 'matrix' && (
              <p className="text-xs text-geo-muted">
                Matrices are atomic — mixed types will be coerced to character.
              </p>
            )}

            {type === 'data.table' && columns.some((c) => c.type === 'sf') && (
              <p className="text-xs text-geo-muted">
                Note: <code className="font-mono">sf::st_sf()</code> is not compatible with data.table — sf geometry columns will be added as plain list columns.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-xs text-geo-muted">
                {type === 'vector' ? 'Vector type' : 'Columns'}
              </span>

              {columns.map((col) => (
                <ColumnRow
                  key={col.id}
                  col={col}
                  isVector={type === 'vector'}
                  canRemove={type !== 'vector' && columns.length > 1}
                  canSetSfGeom={type === 'data.frame' || type === 'tibble' || type === 'data.table'}
                  allColumnNames={columns.map((c) => c.name).filter(Boolean)}
                  onChange={(partial) => handleColumnChange(col.id, partial)}
                  onRemove={() => setColumns((cols) => cols.filter((c) => c.id !== col.id))}
                />
              ))}

              {type !== 'vector' && (
                <button
                  className="text-xs text-geo-accent hover:text-geo-accent/80 flex items-center gap-1 self-start"
                  onClick={() =>
                    setColumns((cols) => [...cols, makeColumn(`col${cols.length + 1}`)])
                  }
                >
                  <Plus className="w-3 h-3" /> Add Column
                </button>
              )}
            </div>

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
                  Creating...
                </>
              ) : (
                'Create'
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
