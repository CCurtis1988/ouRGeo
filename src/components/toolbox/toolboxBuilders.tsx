import { DataChecksPanel } from './DataChecksPanel'
import { CHECKED_TOOLS, toolPreflightRequest, requestPreview, inspectRequest, executeChecked, checkedOutputViewClass } from '@/lib/data-preflight'
import type { PreflightReport } from '@/lib/data-preflight-types'
// ── Toolbox: tool form & condition builders ──────────────────────────────────
import { useState, useRef, useEffect, useMemo, useCallback, type KeyboardEvent } from 'react'
import { X, Copy, Play, Plus, ArrowRight } from 'lucide-react'
import { rClient } from '@/lib/r-client'
import type { REnvironmentInfo, ColumnInfo } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useSpatialStore } from '@/store/spatial'
import { useSelectionStore } from '@/store/selection'
import { sliceSelectionLine } from '@/lib/selection-slice'
import { DatasetCombobox } from '@/components/ui/DatasetCombobox'
import type { ToolDef, FieldDef, Values, DatasetMeta, FilterCondition, ArrangeColumn } from './tools'
import {
  toPipeStep, buildPipelineCode, getOpRhs, DEFAULT_CONDITION, DEFAULT_ARRANGE_COLUMN,
  type PipelineStep, type PipelineState,
} from './toolboxPipeline'

interface ColumnComboboxProps {
  value: string
  onChange: (v: string) => void
  datasetName: string
  environments: REnvironmentInfo[]
  multi?: boolean
  placeholder?: string
  overrideColumns?: ColumnInfo[]
}

// ── Band picker for raster tools ─────────────────────────────────────────────
// Values hold the 1-based band index (comma-joined for multi). Options are
// fetched from /raster/info for the tool's selected raster dataset.

interface BandComboboxProps {
  value: string
  onChange: (v: string) => void
  datasetName: string
  environments: REnvironmentInfo[]
  multi?: boolean
}

export function BandCombobox({ value, onChange, datasetName, environments, multi }: BandComboboxProps) {
  const [bands, setBands] = useState<{ index: number; name: string }[]>([])
  const cacheRef = useRef<Map<string, { index: number; name: string }[]>>(new Map())

  useEffect(() => {
    if (!datasetName) { setBands([]); return }
    if (cacheRef.current.has(datasetName)) {
      setBands(cacheRef.current.get(datasetName)!)
      return
    }
    const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === datasetName))
    rClient.rasterInfo(datasetName, env?.name ?? '.GlobalEnv').then(res => {
      if (res.success && res.bands) {
        const b = res.bands.map(x => ({ index: x.index, name: x.name }))
        cacheRef.current.set(datasetName, b)
        setBands(b)
      }
    }).catch(() => {})
  }, [datasetName, environments])

  const selected = multi ? value.split(',').map(s => s.trim()).filter(Boolean) : []

  if (multi) {
    return (
      <div className="space-y-1">
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selected.map(idx => (
              <span key={idx} className="flex items-center gap-1 bg-[#4493f8]/20 text-[#4493f8] text-xs px-1.5 py-0.5 rounded">
                {bands.find(b => String(b.index) === idx)?.name ?? `band ${idx}`}
                <button
                  className="hover:text-white"
                  onClick={() => onChange(selected.filter(s => s !== idx).join(', '))}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <select
          className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#4493f8]"
          value=""
          disabled={!datasetName}
          onChange={e => {
            if (e.target.value && !selected.includes(e.target.value)) {
              onChange([...selected, e.target.value].join(', '))
            }
          }}
        >
          <option value="">{datasetName ? 'Add band…' : 'Pick a raster first'}</option>
          {bands.filter(b => !selected.includes(String(b.index))).map(b => (
            <option key={b.index} value={b.index}>{b.index}: {b.name}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <select
      className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#4493f8]"
      value={value}
      disabled={!datasetName}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{datasetName ? 'Select band…' : 'Pick a raster first'}</option>
      {bands.map(b => (
        <option key={b.index} value={b.index}>{b.index}: {b.name}</option>
      ))}
    </select>
  )
}

export function ColumnCombobox({ value, onChange, datasetName, environments, multi, placeholder, overrideColumns }: ColumnComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const cacheRef = useRef<Map<string, ColumnInfo[]>>(new Map())
  const [highlighted, setHighlighted] = useState(0)

  const selected = multi ? value.split(',').map(s => s.trim()).filter(Boolean) : []

  // Fetch columns when dataset changes (or use override in pipeline mode)
  useEffect(() => {
    if (overrideColumns) { setColumns(overrideColumns); return }
    if (!datasetName) { setColumns([]); return }
    if (cacheRef.current.has(datasetName)) {
      setColumns(cacheRef.current.get(datasetName)!)
      return
    }
    // Find env for this dataset
    const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === datasetName))
    if (!env) return
    rClient.getObjectDataFrame(datasetName, env.name, datasetName, 0, 0).then(res => {
      if (res.success && res.columns) {
        cacheRef.current.set(datasetName, res.columns)
        setColumns(res.columns)
      }
    }).catch(() => {})
  }, [datasetName, environments, overrideColumns])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = columns.filter(c =>
    !query || c.name.toLowerCase().includes(query.toLowerCase())
  ).filter(c => !multi || !selected.includes(c.name))

  useEffect(() => { setHighlighted(0) }, [query])

  function addCol(name: string) {
    if (multi) {
      const next = [...selected, name].join(', ')
      onChange(next)
      setQuery('')
    } else {
      onChange(name)
      setQuery(name)
    }
    setOpen(false)
  }

  function removeCol(name: string) {
    const next = selected.filter(s => s !== name).join(', ')
    onChange(next)
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { if (filtered[highlighted]) { addCol(filtered[highlighted].name); e.preventDefault() } }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  const displayValue = multi ? query : (value || query)

  return (
    <div className="relative">
      {/* Tags for multi-select */}
      {multi && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {selected.map(name => (
            <span key={name} className="flex items-center gap-1 bg-[#4493f8]/20 text-[#4493f8] text-xs px-1.5 py-0.5 rounded">
              {name}
              <button
                className="hover:text-white"
                onMouseDown={e => { e.preventDefault(); removeCol(name) }}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
        value={displayValue}
        placeholder={placeholder ?? (datasetName ? 'Select column…' : 'Select dataset first…')}
        disabled={!datasetName}
        onChange={e => {
          setQuery(e.target.value)
          if (!multi) onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
      />
      {open && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-[#161b22] border border-[#21262d] rounded shadow-lg max-h-48 overflow-y-auto"
        >
          {filtered.map((col, i) => (
            <div
              key={col.name}
              className={`px-2 py-1 text-xs cursor-pointer flex items-center justify-between ${i === highlighted ? 'bg-[#4493f8]/20 text-white' : 'text-[#e6edf3] hover:bg-[#21262d]'}`}
              onMouseDown={() => addCol(col.name)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span>{col.name}</span>
              <span className="text-[#8b949e] ml-2">{col.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Pipeline types & utilities ────────────────────────────────────────────────

interface FilterConditionsBuilderProps {
  value: string
  onChange: (v: string) => void
  datasetName: string
  environments: REnvironmentInfo[]
  overrideColumns?: ColumnInfo[]
}

export function FilterConditionsBuilder({ value, onChange, datasetName, environments, overrideColumns }: FilterConditionsBuilderProps) {
  const conditions: FilterCondition[] = useMemo(() => {
    try { return JSON.parse(value || '[]') } catch { return [] }
  }, [value])

  const [columns, setColumns] = useState<ColumnInfo[]>([])

  useEffect(() => {
    if (overrideColumns) { setColumns(overrideColumns); return }
    if (!datasetName) { setColumns([]); return }
    const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === datasetName))
    if (!env) return
    rClient.getObjectDataFrame(datasetName, env.name, datasetName, 0, 0).then(res => {
      if (res.success && res.columns) setColumns(res.columns)
    }).catch(() => {})
  }, [datasetName, environments, overrideColumns])

  function push(next: FilterCondition[]) {
    onChange(JSON.stringify(next))
  }

  function addCondition() {
    push([...conditions, { ...DEFAULT_CONDITION }])
  }

  function removeCondition(i: number) {
    push(conditions.filter((_, j) => j !== i))
  }

  function updateCondition(i: number, patch: Partial<FilterCondition>) {
    push(conditions.map((c, j) => j === i ? { ...c, ...patch } : c))
  }

  function changeOp(i: number, newOp: string) {
    const rhs = getOpRhs(newOp)
    let rhsType: FilterCondition['rhsType']
    if (rhs === 'none') rhsType = 'none'
    else if (rhs === 'set') rhsType = 'set'
    else if (rhs === 'value') rhsType = 'value'
    else rhsType = (conditions[i].rhsType === 'column' ? 'column' : 'value')
    push(conditions.map((c, j) => j === i ? { ...c, op: newOp, rhsType } : c))
  }

  const inputCls = 'bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#4493f8]'
  const colPlaceholder = datasetName ? '— column —' : '— select dataset first —'

  return (
    <div className="space-y-1.5">
      {conditions.length === 0 && (
        <p className="text-[10px] text-[#8b949e] italic py-0.5">
          No conditions yet — add one below.
        </p>
      )}

      {conditions.map((cond, i) => {
        const rhsAllowed = getOpRhs(cond.op)
        const showRhsToggle = rhsAllowed === 'value-or-column'
        const showRhs = rhsAllowed !== 'none'

        return (
          <div key={i}>
            {/* AND / OR separator between conditions */}
            {i > 0 && (
              <div className="flex items-center gap-2 py-1">
                <div className="h-px flex-1 bg-[#21262d]" />
                <button
                  className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors ${
                    cond.joinOp === 'AND'
                      ? 'border-[#4493f8] text-[#4493f8] hover:bg-[#4493f8]/10'
                      : 'border-[#f85149] text-[#f85149] hover:bg-[#f85149]/10'
                  }`}
                  title="Click to toggle AND / OR"
                  onClick={() => updateCondition(i, { joinOp: cond.joinOp === 'AND' ? 'OR' : 'AND' })}
                >
                  {cond.joinOp}
                </button>
                <div className="h-px flex-1 bg-[#21262d]" />
              </div>
            )}

            {/* Condition row */}
            <div className="flex items-center gap-1.5">
              {/* Left column */}
              <select
                className={`${inputCls} flex-[2] min-w-0`}
                value={cond.col}
                disabled={!datasetName}
                onChange={e => updateCondition(i, { col: e.target.value })}
              >
                <option value="">{colPlaceholder}</option>
                {columns.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>

              {/* Operator */}
              <select
                className={`${inputCls} w-44 flex-shrink-0`}
                value={cond.op}
                onChange={e => changeOp(i, e.target.value)}
              >
                <optgroup label="Comparison">
                  <option value="==">== equal to</option>
                  <option value="!=">!= not equal to</option>
                  <option value=">">&gt; greater than</option>
                  <option value=">=">&gt;= greater or equal</option>
                  <option value="<">&lt; less than</option>
                  <option value="<=">&lt;= less or equal</option>
                </optgroup>
                <optgroup label="Membership">
                  <option value="%in%">%in% in set</option>
                </optgroup>
                <optgroup label="NA / Special">
                  <option value="is.na">is.na</option>
                  <option value="!is.na">!is.na</option>
                  <option value="is.null">is.null</option>
                  <option value="!is.null">!is.null</option>
                  <option value="is.nan">is.nan</option>
                  <option value="is.finite">is.finite</option>
                  <option value="is.infinite">is.infinite</option>
                </optgroup>
                <optgroup label="String / Pattern">
                  <option value="grepl">grepl (regex)</option>
                  <option value="grepl_i">grepl (ignore case)</option>
                  <option value="startsWith">startsWith</option>
                  <option value="endsWith">endsWith</option>
                  <option value="nchar_gt">nchar {'>'} (length {'>'} N)</option>
                </optgroup>
              </select>

              {/* Right-hand side */}
              {showRhs ? (
                <div className="flex-[2] min-w-0 flex items-center gap-1">
                  {/* val / col toggle (only for value-or-column operators) */}
                  {showRhsToggle && (
                    <div className="flex flex-shrink-0 rounded overflow-hidden border border-[#21262d]">
                      <button
                        className={`px-1.5 py-1 text-[10px] transition-colors ${
                          cond.rhsType === 'value'
                            ? 'bg-[#4493f8] text-white'
                            : 'text-[#8b949e] hover:text-white'
                        }`}
                        title="Compare to a literal value"
                        onClick={() => updateCondition(i, { rhsType: 'value' })}
                      >val</button>
                      <button
                        className={`px-1.5 py-1 text-[10px] transition-colors ${
                          cond.rhsType === 'column'
                            ? 'bg-[#4493f8] text-white'
                            : 'text-[#8b949e] hover:text-white'
                        }`}
                        title="Compare to another column"
                        onClick={() => updateCondition(i, { rhsType: 'column' })}
                      >col</button>
                    </div>
                  )}

                  {cond.rhsType === 'column' ? (
                    <select
                      className={`${inputCls} flex-1 min-w-0`}
                      value={cond.rhsCol}
                      disabled={!datasetName}
                      onChange={e => updateCondition(i, { rhsCol: e.target.value })}
                    >
                      <option value="">{colPlaceholder}</option>
                      {columns.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={`${inputCls} flex-1 min-w-0`}
                      value={cond.rhsVal}
                      placeholder={
                        rhsAllowed === 'set' ? 'a, b, c  (comma-separated)' :
                        rhsAllowed === 'value' ? 'value' : 'value or NA / TRUE / FALSE'
                      }
                      onChange={e => updateCondition(i, { rhsVal: e.target.value })}
                    />
                  )}
                </div>
              ) : (
                /* Empty flex spacer so the remove button stays aligned */
                <div className="flex-[2] min-w-0" />
              )}

              {/* Remove button */}
              <button
                className="flex-shrink-0 text-[#8b949e] hover:text-[#f85149] transition-colors p-0.5"
                title="Remove condition"
                onClick={() => removeCondition(i)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )
      })}

      <button
        className="flex items-center gap-1 mt-1 text-[11px] text-[#4493f8] hover:text-white transition-colors disabled:opacity-40"
        disabled={!datasetName}
        onClick={addCondition}
      >
        <Plus className="w-3 h-3" />
        Add Condition
      </button>
    </div>
  )
}

// ── Arrange Columns Builder ───────────────────────────────────────────────────


interface ArrangeColumnsBuilderProps {
  value: string
  onChange: (v: string) => void
  datasetName: string
  environments: REnvironmentInfo[]
  overrideColumns?: ColumnInfo[]
}

export function ArrangeColumnsBuilder({ value, onChange, datasetName, environments, overrideColumns }: ArrangeColumnsBuilderProps) {
  const sortCols: ArrangeColumn[] = useMemo(() => {
    try { return JSON.parse(value || '[]') } catch { return [] }
  }, [value])

  const [columns, setColumns] = useState<ColumnInfo[]>([])

  useEffect(() => {
    if (overrideColumns) { setColumns(overrideColumns); return }
    if (!datasetName) { setColumns([]); return }
    const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === datasetName))
    if (!env) return
    rClient.getObjectDataFrame(datasetName, env.name, datasetName, 0, 0).then(res => {
      if (res.success && res.columns) setColumns(res.columns)
    }).catch(() => {})
  }, [datasetName, environments, overrideColumns])

  function push(next: ArrangeColumn[]) { onChange(JSON.stringify(next)) }

  function addCol()          { push([...sortCols, { ...DEFAULT_ARRANGE_COLUMN }]) }
  function removeCol(i: number) { push(sortCols.filter((_, j) => j !== i)) }
  function updateCol(i: number, patch: Partial<ArrangeColumn>) {
    push(sortCols.map((c, j) => j === i ? { ...c, ...patch } : c))
  }

  const inputCls = 'bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#4493f8]'
  const colPlaceholder = datasetName ? '— column —' : '— select dataset first —'

  return (
    <div className="space-y-1.5">
      {sortCols.length === 0 && (
        <p className="text-[10px] text-[#8b949e] italic py-0.5">
          No sort columns yet — add one below.
        </p>
      )}

      {sortCols.map((sc, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {/* Priority indicator */}
          <span className="text-[10px] text-[#8b949e] w-4 text-right flex-shrink-0 select-none">
            {i + 1}.
          </span>

          {/* Column select */}
          <select
            className={`${inputCls} flex-1 min-w-0`}
            value={sc.col}
            disabled={!datasetName}
            onChange={e => updateCol(i, { col: e.target.value })}
          >
            <option value="">{colPlaceholder}</option>
            {columns.map(c => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>

          {/* Asc / Desc toggle */}
          <div className="flex flex-shrink-0 rounded overflow-hidden border border-[#21262d]">
            <button
              className={`px-2 py-1 text-[10px] transition-colors ${
                sc.dir === 'asc' ? 'bg-[#4493f8] text-white' : 'text-[#8b949e] hover:text-white'
              }`}
              title="Sort ascending (A → Z, 1 → 9)"
              onClick={() => updateCol(i, { dir: 'asc' })}
            >↑ Asc</button>
            <button
              className={`px-2 py-1 text-[10px] transition-colors ${
                sc.dir === 'desc' ? 'bg-[#4493f8] text-white' : 'text-[#8b949e] hover:text-white'
              }`}
              title="Sort descending (Z → A, 9 → 1)"
              onClick={() => updateCol(i, { dir: 'desc' })}
            >↓ Desc</button>
          </div>

          {/* Remove button */}
          <button
            className="flex-shrink-0 text-[#8b949e] hover:text-[#f85149] transition-colors p-0.5"
            title="Remove sort column"
            onClick={() => removeCol(i)}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <button
        className="flex items-center gap-1 mt-1 text-[11px] text-[#4493f8] hover:text-white transition-colors disabled:opacity-40"
        disabled={!datasetName}
        onClick={addCol}
      >
        <Plus className="w-3 h-3" />
        Add Sort Column
      </button>
    </div>
  )
}

// ── Tool Form ─────────────────────────────────────────────────────────────────

interface ToolFormProps {
  tool: ToolDef
  environments: REnvironmentInfo[]
  pipelineDs?: string
  pipeline?: PipelineState
  pipelineColumns?: ColumnInfo[]
  onPipe?: (step: PipelineStep, dsName: string) => void
  onClearPipeline?: () => void
}

export function ToolForm({ tool, environments, pipelineDs, pipeline, pipelineColumns, onPipe, onClearPipeline }: ToolFormProps) {
  const addConsoleEntry = useSessionStore(s => s.addConsoleEntry)
  const addInputHistory = useSessionStore(s => s.addInputHistory)

  // Initialize values with defaults, pre-filling dataset/output-name from pipeline if present
  function initValues(): Values {
    const v: Values = {}
    for (const f of tool.fields) {
      if (f.type === 'text' && f.default) v[f.id] = f.default
      else if (f.type === 'number' && f.default) v[f.id] = f.default
      else if (f.type === 'select') v[f.id] = f.options[0]?.value ?? ''
      else if (f.type === 'checkbox') v[f.id] = f.default ? 'true' : 'false'
      else v[f.id] = ''
    }
    if (pipeline) {
      // Lock dataset to initialDs and output name to finalOutputName for whole pipeline
      const dsField = tool.fields.find(f => f.type === 'dataset')
      if (dsField) v[dsField.id] = pipeline.initialDs
      const outField = tool.fields.find(f => f.type === 'output-name')
      if (outField) v[outField.id] = pipeline.finalOutputName
    } else if (pipelineDs) {
      const dsField = tool.fields.find(f => f.type === 'dataset')
      if (dsField) {
        v[dsField.id] = pipelineDs
        for (const f of tool.fields) {
          if (f.type === 'output-name' && f.derive) v[f.id] = f.derive(v)
        }
      }
    }
    return v
  }

  const [validation, setValidation] = useState<PreflightReport | null>(null)
  const validationKey = useRef<string | null>(null)
  const runCheck = useRef<AbortController | null>(null)
  const cancelRunCheck = useCallback(() => runCheck.current?.abort(), [])
  const [checkedCode, setCheckedCode] = useState<string | null>(null)
  const selectionRevision = useSelectionStore(s => s.revision)
  const controlled = CHECKED_TOOLS.has(tool.id)
  const [values, setValues] = useState<Values>(initValues)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runSuccess, setRunSuccess] = useState(false)
  const [resultOpened, setResultOpened] = useState(true)
  const [useViewBbox, setUseViewBbox] = useState(false)
  // Per-dataset-field "use selected rows" opt-out; absent = true (default on)
  const [useSelectedRows, setUseSelectedRows] = useState<Record<string, boolean>>({})

  // Reset when tool changes
  useEffect(() => {
    setValues(initValues())
    setRunError(null)
    setRunSuccess(false)
    setUseViewBbox(false)
    setUseSelectedRows({})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id])

  function set(id: string, val: string) {
    setValues(prev => {
      const next = { ...prev, [id]: val }
      // Auto-derive output name only when not in pipeline mode (where it's locked)
      if (!pipeline) {
        for (const f of tool.fields) {
          if (f.type === 'output-name' && f.derive) {
            next[f.id] = f.derive(next)
          }
        }
      }
      return next
    })
    // A different dataset means a different selection — back to default-on
    if (tool.fields.some(f => f.id === id && f.type === 'dataset')) {
      setUseSelectedRows(prev => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  // Build DatasetMeta from current dataset selections so buildCode can decide
  // whether to insert collect() for tbl_dbi inputs and so handleRun can
  // pre-collect any database-backed proxy inputs.
  const { datasetMeta, spatialProxyFields } = (() => {
    const meta: DatasetMeta = {}
    const spatialFieldIds = new Set<string>()
    const allUserObjects = environments
      .filter(e => !e.isSearchPath)
      .flatMap(e => e.objects)
    for (const f of tool.fields) {
      if (f.type !== 'dataset') continue
      const varName = values[f.id]
      if (!varName) continue
      const obj = allUserObjects.find(o => o.name === varName)
      const cls = obj?.class ?? ''
      const rgeoProxy = obj?.rgeoProxy
        ? { handle: obj.rgeoProxy.handle, name: obj.rgeoProxy.name }
        : null
      // When a proxy exists, the dialog will pre-collect into <varName>_local
      // before run; tools should reference that local name. Raster proxies are
      // exempt: connect already bound a real file-backed SpatRaster to the env
      // var, so terra can use it directly — no collect round-trip needed.
      const materializedAs =
        rgeoProxy && obj?.rgeoProxy?.kind !== 'raster' ? `${varName}_local` : undefined
      meta[f.id] = { isDbTbl: cls === 'tbl_dbi', cls, rgeoProxy, materializedAs }
      const kind = obj?.rgeoProxy?.kind
      if (rgeoProxy && (kind === 'sf' || kind === 'geos')) {
        spatialFieldIds.add(f.id)
      }
    }
    return { datasetMeta: meta, spatialProxyFields: spatialFieldIds }
  })()

  const showViewToggle = spatialProxyFields.size > 0

  // Active map/data-viewer selections per dataset field (raster fields exempt —
  // selections are row-based). Keyed by field id, like DatasetMeta.
  const selections = useSelectionStore(s => s.selections)
  const datasetSelections = (() => {
    const out: Record<string, { varName: string; indices: number[]; total: number | null }> = {}
    const userEnvs = environments.filter(e => !e.isSearchPath)
    for (const f of tool.fields) {
      if (f.type !== 'dataset' || f.filter === 'raster') continue
      const varName = values[f.id]
      if (!varName) continue
      const env = userEnvs.find(e => e.objects.some(o => o.name === varName))
      if (!env) continue
      const indices = selections[`${varName}::${env.name}`]
      if (!indices || indices.length === 0) continue
      const obj = env.objects.find(o => o.name === varName)
      out[f.id] = { varName, indices, total: obj?.dim?.[0] ?? null }
    }
    return out
  })()

  // Raw code from this tool; pipe-aware code for preview and execution.
  // Dataset fields with an active selection (and the checkbox on) are sliced
  // to the selected rows in an echoed prelude line, and the tool's code is
  // built against the sliced variable instead. Substitution happens only at
  // build time — `values` itself keeps the real object name so column/band
  // lookups still hit the live object.
  const { preludes, rawCode, effectiveDsNames } = (() => {
    const preludes: string[] = []
    const effectiveDsNames: Record<string, string> = {}
    let cv: Values = values
    let cm: DatasetMeta = datasetMeta
    for (const [fieldId, sel] of Object.entries(datasetSelections)) {
      if (useSelectedRows[fieldId] === false) continue
      const m = datasetMeta[fieldId]
      // Slice after materialization: proxies are pre-collected into
      // <var>_local by handleRun; db tbls need collect() before slice.
      const source = m?.rgeoProxy && m.materializedAs
        ? m.materializedAs
        : m?.isDbTbl ? `(${sel.varName} %>% dplyr::collect())`
        : sel.varName
      const selName = `${sel.varName}_sel`
      preludes.push(sliceSelectionLine(source, selName, sel.indices))
      cv = { ...cv, [fieldId]: selName }
      cm = { ...cm, [fieldId]: { isDbTbl: false, cls: m?.cls ?? '', rgeoProxy: null } }
      effectiveDsNames[fieldId] = selName
    }
    let rawCode = ''
    try { rawCode = tool.buildCode(cv, cm) } catch { rawCode = '' }
    return { preludes, rawCode, effectiveDsNames }
  })()

  const request = toolPreflightRequest(tool, values, useSelectedRows)
  // Subscribe so a selection change invalidates this computed request.
  void selectionRevision
  const requestKey = JSON.stringify(request)
  const latestRequestKey = useRef(requestKey)
  latestRequestKey.current = requestKey
  const currentValidation = validationKey.current === requestKey ? validation : null
  const receiveReport = (report: PreflightReport | null) => {
    if (latestRequestKey.current !== requestKey) return
    validationKey.current = report ? requestKey : null
    setValidation(report)
  }
  useEffect(() => {
    cancelRunCheck(); validationKey.current = null; setValidation(null); setCheckedCode(null)
    return cancelRunCheck
  }, [requestKey, cancelRunCheck])

  const code = (() => {
    if (controlled) return checkedCode ?? currentValidation?.executionCode ?? requestPreview(request)

    if (!rawCode) return ''
    const prelude = preludes.length > 0 ? preludes.join('\n') + '\n' : ''
    if (!pipeline || !values.ds) return prelude + rawCode
    try {
      // The prelude slices the original dataset into <ds>_sel; the pipeline
      // then starts from the sliced variable.
      const effDs = effectiveDsNames.ds ?? values.ds
      const pipeStep = toPipeStep(rawCode, effDs)
      const pipelineForCode = effDs !== pipeline.initialDs
        ? { ...pipeline, initialDs: effDs }
        : pipeline
      return prelude + buildPipelineCode(pipelineForCode, pipeStep, pipeline.finalOutputName)
    } catch { return prelude + rawCode }
  })()

  async function handleRun() {
    if (!code) return
    if (controlled) {
      if (pipeline || useViewBbox) { setRunError('Run the preceding pipeline first, or use the full dataset/explicit row selection. This plan does not validate an unevaluated pipeline or a viewport approximation.'); return }
      setRunning(true); setRunError(null); setRunSuccess(false)
      const capturedKey = requestKey
      try {
        runCheck.current?.abort()
        const abort = new AbortController(); runCheck.current = abort
        const report = currentValidation ?? await inspectRequest(request, progress => {
          if (latestRequestKey.current === capturedKey) {
            validationKey.current = capturedKey; setValidation(progress)
          }
        }, abort.signal)
        if (latestRequestKey.current !== capturedKey) { setRunError('Parameters or selection changed; check again.'); return }
        validationKey.current = capturedKey; setValidation(report)
        if (!['ready', 'needs_confirmation'].includes(report.status)) { setRunError(report.status === 'cancelled' ? 'Check cancelled; no result was created.' : report.issues.map(i => i.message).join('\n') || report.error || 'Checks are incomplete.'); return }
        const result = await executeChecked(report, () => latestRequestKey.current === capturedKey)
        if (!result.success) { setRunError(result.error ?? 'Execution was blocked'); return }
        setCheckedCode(result.code ?? null); setRunSuccess(true); setValidation(null)
        const viewClass = checkedOutputViewClass(result.outputClass)
        setResultOpened(viewClass !== null)
        if (values.out && viewClass) useEditorStore.getState().addObjectTab(values.out, request.outputEnv ?? '.GlobalEnv', viewClass, values.out, 'data-viewer')
      } catch (e) { setRunError(e instanceof Error ? e.message : String(e)) }
      finally { setRunning(false) }
      return
    }
    setRunning(true); setResultOpened(true)
    setRunError(null)
    setRunSuccess(false)
    try {
      // Pre-collect any database-backed proxy inputs into <varName>_local
      // so the tool's R code sees real sf / data.frame objects rather than
      // a lazy tbl_dbi handle (which can't carry GEOMETRY through dbplyr).
      // When the user toggled "Use only current view", pass the spatial
      // editor's viewBbox so the materialised sf is pre-filtered.
      const viewBboxFilter = useViewBbox && showViewToggle
        ? useSpatialStore.getState().viewBbox ?? undefined
        : undefined
      for (const fieldId of Object.keys(datasetMeta)) {
        const m = datasetMeta[fieldId]
        if (!m?.rgeoProxy || !m.materializedAs) continue
        const bbox = spatialProxyFields.has(fieldId) ? viewBboxFilter : undefined
        const collectRes = await rClient.datasetCollect(m.rgeoProxy, {
          varName: m.materializedAs,
          bbox
        })
        if (!collectRes.success) {
          setRunError(collectRes.error ?? 'Failed to collect proxy dataset')
          setRunning(false)
          return
        }
        const scope = bbox ? 'current view' : 'full dataset'
        addConsoleEntry('output', `[Rgeo] Collected '${m.rgeoProxy.name}' (${scope}) into '${m.materializedAs}' (${collectRes.nRows ?? '?'} rows).\n`)
      }

      addConsoleEntry('input', code)
      addInputHistory(code)
      const result = await rClient.execute(code)
      if (result.success) {
        setRunSuccess(true)
        if (onClearPipeline) onClearPipeline()
        // Open result in data viewer if there's an output name. Raster outputs
        // are not tabular — the console echo + Environment panel carry them.
        const outField = tool.fields.find(f => f.type === 'output-name')
        const outputName = outField ? values[outField.id] : ''
        if (outputName && tool.output !== 'raster') {
          useEditorStore.getState().addObjectTab(outputName, '.GlobalEnv', 'data.frame', outputName, 'data-viewer')
        }
      } else {
        setRunError(result.error ?? 'Unknown error')
      }
    } catch (e) {
      setRunError(String(e))
    } finally {
      setRunning(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function renderField(f: FieldDef) {
    const val = values[f.id] ?? ''

    if (f.type === 'dataset') {
      return (
        <DatasetCombobox
          key={f.id}
          value={val}
          onChange={v => set(f.id, v)}
          filter={f.filter}
          environments={environments}
        />
      )
    }

    if (f.type === 'column') {
      return (
        <ColumnCombobox
          key={f.id}
          value={val}
          onChange={v => set(f.id, v)}
          datasetName={values[f.datasetField] ?? ''}
          environments={environments}
          multi={f.multi}
          overrideColumns={pipelineColumns}
        />
      )
    }

    if (f.type === 'band') {
      return (
        <BandCombobox
          key={f.id}
          value={val}
          onChange={v => set(f.id, v)}
          datasetName={values[f.datasetField] ?? ''}
          environments={environments}
          multi={f.multi}
        />
      )
    }

    if (f.type === 'text') {
      return (
        <input
          key={f.id}
          className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
          value={val}
          placeholder={f.placeholder ?? ''}
          onChange={e => set(f.id, e.target.value)}
        />
      )
    }

    if (f.type === 'number') {
      return (
        <input
          key={f.id}
          type="number"
          className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
          value={val}
          min={f.min}
          step={f.step}
          onChange={e => set(f.id, e.target.value)}
        />
      )
    }

    if (f.type === 'select') {
      return (
        <select
          key={f.id}
          className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#4493f8]"
          value={val}
          onChange={e => set(f.id, e.target.value)}
        >
          {f.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )
    }

    if (f.type === 'checkbox') {
      return (
        <label key={f.id} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#4493f8]"
            checked={val === 'true'}
            onChange={e => set(f.id, e.target.checked ? 'true' : 'false')}
          />
          <span className="text-xs text-[#e6edf3]">{f.label}</span>
        </label>
      )
    }

    if (f.type === 'output-name') {
      return (
        <input
          key={f.id}
          className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8] font-mono"
          value={val}
          placeholder="output_name"
          onChange={e => set(f.id, e.target.value)}
        />
      )
    }

    if (f.type === 'filter-conditions') {
      return (
        <FilterConditionsBuilder
          key={f.id}
          value={val}
          onChange={v => set(f.id, v)}
          datasetName={values[f.datasetField] ?? ''}
          environments={environments}
          overrideColumns={pipelineColumns}
        />
      )
    }

    if (f.type === 'arrange-columns') {
      return (
        <ArrangeColumnsBuilder
          key={f.id}
          value={val}
          onChange={v => set(f.id, v)}
          datasetName={values[f.datasetField] ?? ''}
          environments={environments}
          overrideColumns={pipelineColumns}
        />
      )
    }

    return null
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tool header */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-white">{tool.label}</h2>
        <p className="text-xs text-[#8b949e] mt-0.5">{tool.description}</p>
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
      {controlled && <div className="mb-3"><DataChecksPanel request={request} onReport={receiveReport} activeReport={currentValidation} onCancel={cancelRunCheck} /></div>}

        {tool.fields.map(f => {
          const selInfo = f.type === 'dataset' ? datasetSelections[f.id] : undefined
          const selectionToggle = selInfo && (
            <label
              className="mt-1 flex items-center gap-1.5 cursor-pointer text-[11px] text-[#8b949e] hover:text-[#e6edf3]"
              title="Only the rows selected on the map / in the data viewer are passed to this tool"
            >
              <input
                type="checkbox"
                className="accent-[#4493f8]"
                checked={useSelectedRows[f.id] !== false}
                onChange={e => setUseSelectedRows(prev => ({ ...prev, [f.id]: e.target.checked }))}
              />
              <span>
                Use selected rows only ({selInfo.indices.length}
                {selInfo.total !== null ? ` of ${selInfo.total}` : ' selected'})
              </span>
            </label>
          )
          // In pipeline mode, hide dataset and output-name — they're locked
          // internally (but the locked dataset's selection toggle stays visible)
          if (pipeline && (f.type === 'dataset' || f.type === 'output-name')) {
            return selectionToggle ? <div key={f.id}>{selectionToggle}</div> : null
          }
          // Conditional fields (e.g. Segments per Quadrant only when linearizing)
          if (f.visibleWhen && !f.visibleWhen(values)) return null
          if (f.type === 'checkbox') {
            return (
              <div key={f.id}>
                {renderField(f)}
              </div>
            )
          }
          return (
            <div key={f.id}>
              <label className="block text-xs text-[#8b949e] mb-1">{f.label}</label>
              {renderField(f)}
              {selectionToggle}
            </div>
          )
        })}

        {/* Code preview */}
        <div className="mt-2">
          <label className="block text-xs text-geo-muted mb-1">{controlled && !checkedCode && !currentValidation?.executionCode ? 'Data Check Code' : 'Code Preview'}</label>
          <pre className="bg-[#0f1117] border border-[#21262d] rounded p-2 text-xs text-[#e6edf3] font-mono whitespace-pre-wrap break-all min-h-[60px] max-h-[160px] overflow-y-auto">
            {code || <span className="text-[#8b949e]"># Fill in the fields above</span>}
          </pre>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-[#21262d] flex items-center justify-between gap-2">
        <div className="flex-1 text-xs flex items-center gap-3">
          {showViewToggle && (
            <label
              className="flex items-center gap-1.5 cursor-pointer text-[#8b949e] hover:text-[#e6edf3]"
              title="Pre-filter the connected spatial dataset by the current map view before running"
            >
              <input
                type="checkbox"
                className="accent-[#4493f8]"
                checked={useViewBbox}
                onChange={e => setUseViewBbox(e.target.checked)}
              />
              <span>Use only current view</span>
            </label>
          )}
          {runError && <span className="text-[#f85149]">{runError}</span>}
          {runSuccess && (
            <span className="text-[#3fb950]">
              {pipeline ? 'Pipeline done — opened in Data Viewer' : resultOpened ? 'Done — opened in Data Viewer' : 'Done — result available in Environment'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded transition-colors"
            onClick={handleCopy}
            disabled={!code}
          >
            <Copy className="w-3 h-3" />
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
          {onPipe && !controlled && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded transition-colors disabled:opacity-40"
              title="Pipe this output into the next tool"
              disabled={!rawCode || !values.ds}
              onClick={() => {
                if (!onPipe || !values.ds || !rawCode) return
                // rawCode references the sliced <ds>_sel when a selection is
                // active; strip that name, but seed the pipeline with the
                // original dataset so later steps re-derive the slice prelude.
                const pipeStep = toPipeStep(rawCode, effectiveDsNames.ds ?? values.ds)
                const outField = tool.fields.find(f => f.type === 'output-name')
                const outputName = outField ? (values[outField.id] || 'result') : 'result'
                onPipe({ toolLabel: tool.label, pipeStep, outputName }, values.ds)
              }}
            >
              <ArrowRight className="w-3 h-3" />
              Pipe →
            </button>
          )}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#4493f8] hover:bg-[#4493f8]/80 text-white rounded transition-colors disabled:opacity-50"
            onClick={handleRun}
            disabled={!code || running || (controlled && (currentValidation?.status === 'blocked' || currentValidation?.status === 'checking' || !!pipeline || useViewBbox))}
          >
            <Play className="w-3 h-3" />
            {running ? 'Running…' : controlled ? currentValidation?.status === 'needs_confirmation' ? 'Review choices and run' : 'Check and run' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Dialog ───────────────────────────────────────────────────────────────

