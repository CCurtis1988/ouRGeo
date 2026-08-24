import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent } from 'react'
import { X, Play, ChevronRight, Search, Plus } from 'lucide-react'
import { SELECTION_CATEGORIES, ALL_SELECTION_TOOLS } from '../toolbox/selection-tools'
import type { ToolDef, FieldDef, Values, FilterCondition } from '../toolbox/tools'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { useSelectionStore } from '@/store/selection'
import { rClient } from '@/lib/r-client'
import type { REnvironmentInfo, ColumnInfo } from '@/lib/r-client'
import { toPipeStep, buildSelectionPipelineCode } from '@/lib/pipeline'
import type { PipelineStep, PipelineState } from '@/lib/pipeline'
import { predictColumns } from '@/lib/pipeline'
import { DatasetCombobox } from '@/components/ui/DatasetCombobox'

// ── ColumnCombobox ─────────────────────────────────────────────────────────────

function ColumnCombobox({
  value, onChange, datasetName, environments, multi, overrideColumns,
}: {
  value: string
  onChange: (v: string) => void
  datasetName: string
  environments: REnvironmentInfo[]
  multi?: boolean
  overrideColumns?: ColumnInfo[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [highlighted, setHighlighted] = useState(0)
  const cacheRef = useRef<Record<string, ColumnInfo[]>>({})

  useEffect(() => {
    if (overrideColumns) { setColumns(overrideColumns); return }
    if (!datasetName) { setColumns([]); return }
    if (cacheRef.current[datasetName]) { setColumns(cacheRef.current[datasetName]); return }
    const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === datasetName))
    if (!env) return
    rClient.getObjectDataFrame(datasetName, env.name, datasetName, 0, 0).then(res => {
      if (res.success && res.columns) {
        cacheRef.current[datasetName] = res.columns
        setColumns(res.columns)
      }
    }).catch(() => {})
  }, [datasetName, environments, overrideColumns])

  const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : []
  const filtered = query ? columns.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) : columns

  useEffect(() => { setHighlighted(0) }, [query])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggleCol(name: string) {
    if (!multi) { onChange(name); setOpen(false); setQuery(''); return }
    const next = selected.includes(name) ? selected.filter(c => c !== name) : [...selected, name]
    onChange(next.join(', '))
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { if (filtered[highlighted]) { toggleCol(filtered[highlighted].name); e.preventDefault() } }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  const cls = 'w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]'
  const displayValue = multi && selected.length > 0 ? selected.join(', ') : ''

  return (
    <div className="space-y-1">
      {multi && selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(col => (
            <span key={col} className="inline-flex items-center gap-0.5 bg-[#4493f8]/15 text-[#4493f8] text-[10px] px-1.5 py-0.5 rounded">
              {col}
              <button onClick={() => toggleCol(col)} className="hover:text-white">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          className={cls}
          value={open ? query : (multi ? '' : (value || ''))}
          placeholder={multi ? 'Add columns…' : (datasetName ? '— column —' : '— select dataset first —')}
          disabled={!datasetName}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
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
                className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer ${i === highlighted ? 'bg-[#4493f8]/20 text-white' : 'text-[#e6edf3] hover:bg-[#21262d]'}`}
                onMouseDown={() => toggleCol(col.name)}
                onMouseEnter={() => setHighlighted(i)}
              >
                {multi && (
                  <span className={`w-3 h-3 border rounded-sm flex-shrink-0 ${selected.includes(col.name) ? 'bg-[#4493f8] border-[#4493f8]' : 'border-[#8b949e]'}`} />
                )}
                <span>{col.name}</span>
                <span className="text-[10px] text-[#8b949e] ml-auto">{col.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Hidden value for non-multi to show current selection */}
      {!multi && value && !open && (
        <div className="text-[10px] text-[#8b949e] pl-1 truncate">{displayValue}</div>
      )}
    </div>
  )
}

// ── FilterConditionsBuilder (minimal for selection) ────────────────────────────

const FILTER_OPERATORS = [
  { value: '==',        label: '== equal to' },
  { value: '!=',        label: '!= not equal to' },
  { value: '>',         label: '> greater than' },
  { value: '>=',        label: '>= greater or equal' },
  { value: '<',         label: '< less than' },
  { value: '<=',        label: '<= less or equal' },
  { value: '%in%',      label: '%in% in set' },
  { value: 'is.na',     label: 'is.na' },
  { value: '!is.na',    label: '!is.na' },
  { value: 'grepl',     label: 'grepl (regex)' },
  { value: 'grepl_i',   label: 'grepl (ignore case)' },
  { value: 'startsWith', label: 'startsWith' },
  { value: 'endsWith',  label: 'endsWith' },
] as const

function needsRhs(op: string): boolean {
  return op !== 'is.na' && op !== '!is.na'
}

function isSetOp(op: string): boolean {
  return op === '%in%'
}

const DEFAULT_COND: FilterCondition = { col: '', op: '==', rhsType: 'value', rhsCol: '', rhsVal: '', joinOp: 'AND' }

function FilterConditionsBuilder({
  value, onChange, datasetName, environments, overrideColumns,
}: {
  value: string
  onChange: (v: string) => void
  datasetName: string
  environments: REnvironmentInfo[]
  overrideColumns?: ColumnInfo[]
}) {
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

  function push(next: FilterCondition[]) { onChange(JSON.stringify(next)) }
  function add() { push([...conditions, { ...DEFAULT_COND }]) }
  function remove(i: number) { push(conditions.filter((_, j) => j !== i)) }
  function update(i: number, patch: Partial<FilterCondition>) {
    push(conditions.map((c, j) => j === i ? { ...c, ...patch } : c))
  }

  const inp = 'bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#4493f8]'

  return (
    <div className="space-y-1.5">
      {conditions.length === 0 && (
        <p className="text-[10px] text-[#8b949e] italic">No conditions — add one below.</p>
      )}
      {conditions.map((cond, i) => (
        <div key={i}>
          {i > 0 && (
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-[#21262d]" />
              <button
                className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors ${cond.joinOp === 'AND' ? 'border-[#4493f8] text-[#4493f8]' : 'border-[#f85149] text-[#f85149]'}`}
                onClick={() => update(i, { joinOp: cond.joinOp === 'AND' ? 'OR' : 'AND' })}
              >
                {cond.joinOp}
              </button>
              <div className="h-px flex-1 bg-[#21262d]" />
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <select
              className={`${inp} flex-[2] min-w-0`}
              value={cond.col}
              disabled={!datasetName}
              onChange={e => update(i, { col: e.target.value })}
            >
              <option value="">{datasetName ? '— column —' : '— select dataset first —'}</option>
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select
              className={`${inp} w-40 flex-shrink-0`}
              value={cond.op}
              onChange={e => update(i, { op: e.target.value })}
            >
              {FILTER_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsRhs(cond.op) ? (
              <input
                className={`${inp} flex-[2] min-w-0`}
                value={cond.rhsVal}
                placeholder={isSetOp(cond.op) ? 'a, b, c' : 'value'}
                onChange={e => update(i, { rhsVal: e.target.value })}
              />
            ) : (
              <div className="flex-[2] min-w-0" />
            )}
            <button
              className="flex-shrink-0 text-[#8b949e] hover:text-[#f85149] transition-colors p-0.5"
              onClick={() => remove(i)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        className="flex items-center gap-1 mt-1 text-[11px] text-[#4493f8] hover:text-white transition-colors disabled:opacity-40"
        disabled={!datasetName}
        onClick={add}
      >
        <Plus className="w-3 h-3" /> Add Condition
      </button>
    </div>
  )
}

// ── Tool form ──────────────────────────────────────────────────────────────────

interface SelectionToolFormProps {
  tool: ToolDef
  environments: REnvironmentInfo[]
  lockedDs: string
  pipeline?: PipelineState
  pipelineColumns?: ColumnInfo[]
  onPipe: (step: PipelineStep) => void
  onRunSelection: (code: string) => Promise<void>
  running: boolean
  runError: string | null
  runSuccess: boolean
}

function SelectionToolForm({
  tool, environments, lockedDs, pipeline, pipelineColumns,
  onPipe, onRunSelection, running, runError, runSuccess,
}: SelectionToolFormProps) {
  function initValues(): Values {
    const v: Values = {}
    for (const f of tool.fields) {
      if (f.type === 'text' && f.default) v[f.id] = f.default
      else if (f.type === 'number' && f.default) v[f.id] = f.default
      else if (f.type === 'select') v[f.id] = f.options[0]?.value ?? ''
      else if (f.type === 'checkbox') v[f.id] = f.default ? 'true' : 'false'
      else v[f.id] = ''
    }
    // Always lock the primary dataset field to the context dataset
    const dsField = tool.fields.find(f => f.type === 'dataset' && f.id === 'ds')
    if (dsField) v[dsField.id] = pipeline?.initialDs ?? lockedDs
    return v
  }

  const [values, setValues] = useState<Values>(initValues)

  useEffect(() => {
    setValues(initValues())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id])

  function set(id: string, val: string) {
    setValues(prev => ({ ...prev, [id]: val }))
  }

  // The dataset the user is querying (always locked to lockedDs when in pipeline)
  const queryDs = pipeline?.initialDs ?? lockedDs

  // Raw code (expression, no assignment)
  const rawCode = (() => {
    try { return tool.buildCode({ ...values, ds: queryDs }) } catch { return '' }
  })()

  // Full preview: if pipeline, show the full chained expression
  const previewCode = (() => {
    if (!pipeline || !rawCode) return rawCode
    try {
      const pipeStep = toPipeStep(rawCode, queryDs)
      return buildSelectionPipelineCode(pipeline, pipeStep)
    } catch { return rawCode }
  })()

  async function handleRun() {
    await onRunSelection(previewCode || rawCode)
  }

  function handlePipe() {
    if (!rawCode || !queryDs) return
    const pipeStep = toPipeStep(rawCode, queryDs)
    onPipe({ toolLabel: tool.label, pipeStep, outputName: '' })
  }

  function renderField(f: FieldDef) {
    const val = values[f.id] ?? ''

    // Primary dataset field is always locked
    if (f.type === 'dataset' && f.id === 'ds') {
      return (
        <div key={f.id} className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-[#8b949e] opacity-60 font-mono">
          {queryDs || '(no dataset)'}
        </div>
      )
    }

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
          datasetName={queryDs}
          environments={environments}
          multi={f.multi}
          overrideColumns={pipelineColumns}
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

    if (f.type === 'filter-conditions') {
      return (
        <FilterConditionsBuilder
          key={f.id}
          value={val}
          onChange={v => set(f.id, v)}
          datasetName={queryDs}
          environments={environments}
          overrideColumns={pipelineColumns}
        />
      )
    }

    return null
  }

  return (
    <div className="space-y-4">
      {/* Tool header */}
      <div>
        <h3 className="text-sm font-semibold text-white">{tool.label}</h3>
        <p className="text-[11px] text-[#8b949e] mt-0.5">{tool.description}</p>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        {tool.fields.map(f => (
          <div key={f.id} className="space-y-1">
            <label className="text-[11px] text-[#8b949e]">{f.label}</label>
            {renderField(f)}
          </div>
        ))}
      </div>

      {/* Code preview */}
      {previewCode && (
        <div className="rounded bg-[#0f1117] border border-[#21262d] p-2 overflow-x-auto">
          <pre className="text-[10px] text-[#e6edf3] font-mono whitespace-pre-wrap leading-relaxed">
            {previewCode}
          </pre>
        </div>
      )}

      {/* Status */}
      {runError && (
        <p className="text-xs text-[#f85149] bg-[#f85149]/10 rounded px-2 py-1.5 font-mono break-all">
          {runError}
        </p>
      )}
      {runSuccess && (
        <p className="text-xs text-[#3fb950]">Selection applied.</p>
      )}

      {/* Footer buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-[#21262d] text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
          disabled={!rawCode || !queryDs}
          onClick={handlePipe}
          title="Add this step to the pipeline without running"
        >
          Pipe →
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-[#4493f8] text-white hover:bg-[#4493f8]/80 transition-colors disabled:opacity-40"
          disabled={!previewCode || running || !queryDs}
          onClick={handleRun}
        >
          <Play className="w-3 h-3" />
          {running ? 'Running…' : 'Run Selection'}
        </button>
      </div>
    </div>
  )
}

// ── Main Dialog ────────────────────────────────────────────────────────────────

interface SelectionQueryDialogProps {
  open: boolean
  onClose: () => void
  accessPath: string
  envName: string
  cls: string
}

export function SelectionQueryDialog({
  open, onClose, accessPath, envName, cls,
}: SelectionQueryDialogProps) {
  const isSf = cls.includes('sf') || cls.toLowerCase().includes('sf')

  // Filter tool categories based on dataset type
  const visibleCategories = SELECTION_CATEGORIES.filter(cat => {
    if (cat.id === 'spatial') return isSf
    return true
  })
  const allVisibleTools = visibleCategories.flatMap(c => c.tools.map(t => ({ ...t, categoryLabel: c.label, categoryId: c.id })))

  const [selectedToolId, setSelectedToolId] = useState<string>(
    () => visibleCategories[0]?.tools[0]?.id ?? ALL_SELECTION_TOOLS[0].id
  )
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(visibleCategories.map(c => c.id))
  )
  const [environments, setEnvironments] = useState<REnvironmentInfo[]>([])
  const storeEnvs = useEnvironmentStore(s => s.environments)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHighlighted, setSearchHighlighted] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchDropdownRef = useRef<HTMLDivElement>(null)

  // Pipeline state
  const [pipeline, setPipeline] = useState<PipelineState | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runSuccess, setRunSuccess] = useState(false)

  const addConsoleEntry = useSessionStore(s => s.addConsoleEntry)
  const setSelection = useSelectionStore(s => s.setSelection)

  const pipelineColumns = useMemo(
    () => pipeline ? predictColumns(pipeline.steps, pipeline.baseColumns) : [],
    [pipeline]
  )

  const fetchEnvironments = useCallback(async () => {
    try {
      const res = await rClient.listEnvironments()
      if (res.success) {
        useEnvironmentStore.getState().setEnvironments(res.environments)
        setEnvironments(res.environments)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (open) {
      setEnvironments(storeEnvs)
      fetchEnvironments()
      setSearchQuery('')
      setSearchOpen(false)
      setPipeline(null)
      setRunError(null)
      setRunSuccess(false)
      // Default to first tool of first visible category
      const firstTool = visibleCategories[0]?.tools[0]
      if (firstTool) setSelectedToolId(firstTool.id)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        searchRef.current && !searchRef.current.contains(e.target as Node) &&
        searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)
      ) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const searchResults = searchQuery.trim()
    ? allVisibleTools.filter(t => t.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : []

  useEffect(() => { setSearchHighlighted(0) }, [searchQuery])

  function selectTool(toolId: string) {
    setSelectedToolId(toolId)
    setRunError(null)
    setRunSuccess(false)
  }

  function selectSearchResult(toolId: string) {
    selectTool(toolId)
    setSearchQuery('')
    setSearchOpen(false)
    const tool = allVisibleTools.find(t => t.id === toolId)
    if (tool) {
      setExpandedCategories(prev => {
        const next = new Set(prev)
        next.add(tool.categoryId)
        return next
      })
    }
  }

  function handleSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!searchOpen || searchResults.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchHighlighted(h => Math.min(h + 1, searchResults.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (searchResults[searchHighlighted]) { selectSearchResult(searchResults[searchHighlighted].id); e.preventDefault() }
    } else if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery('') }
  }

  async function handlePipe(step: PipelineStep) {
    const newSteps = [...(pipeline?.steps ?? []), step]
    const initialDs = pipeline?.initialDs ?? accessPath

    let baseColumns = pipeline?.baseColumns ?? []
    if (!pipeline) {
      const env = environments.find(e => !e.isSearchPath && e.objects.some(o => o.name === initialDs))
      if (env) {
        try {
          const res = await rClient.getObjectDataFrame(initialDs, env.name, initialDs, 0, 0)
          if (res.success && res.columns) baseColumns = res.columns
        } catch {}
      }
    }

    setPipeline({ steps: newSteps, initialDs, baseColumns, finalOutputName: '.ourgeo_sel' })
    setRunError(null)
    setRunSuccess(false)
  }

  async function handleRunSelection(code: string) {
    if (!code) return
    setRunning(true)
    setRunError(null)
    setRunSuccess(false)
    try {
      addConsoleEntry('input', code)
      const result = await rClient.selectionQuery({
        code,
        sourceName: accessPath,
        sourceEnv: envName,
      })
      if (result.success) {
        setSelection(accessPath, envName, result.rowIndices)
        setRunSuccess(true)
        setPipeline(null)
        setTimeout(() => onClose(), 800)
      } else {
        setRunError(result.error ?? 'Unknown error')
      }
    } catch (e) {
      setRunError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const selectedTool = allVisibleTools.find(t => t.id === selectedToolId)
    ?? visibleCategories[0]?.tools[0]

  function toggleCategory(id: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!open || !selectedTool) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-[#161b22] border border-[#21262d] rounded-lg shadow-2xl flex flex-col"
        style={{ width: 780, height: '85vh', maxHeight: 680 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d] flex-shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-white">Select by Query</h1>
            <p className="text-[11px] text-[#8b949e] mt-0.5 font-mono">{accessPath}</p>
          </div>
          <button className="text-[#8b949e] hover:text-white transition-colors" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-44 flex-shrink-0 border-r border-[#21262d] flex flex-col">
            {/* Search */}
            <div className="relative px-2 pt-2 pb-1 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#8b949e] pointer-events-none" />
                <input
                  ref={searchRef}
                  className="w-full bg-[#0f1117] border border-[#21262d] rounded pl-6 pr-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true) }}
                  onFocus={() => { if (searchQuery) setSearchOpen(true) }}
                  onKeyDown={handleSearchKey}
                />
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div
                  ref={searchDropdownRef}
                  className="absolute z-50 left-2 right-2 mt-1 bg-[#161b22] border border-[#21262d] rounded shadow-lg max-h-64 overflow-y-auto"
                >
                  {searchResults.map((tool, i) => (
                    <div
                      key={tool.id}
                      className={`px-2 py-1.5 cursor-pointer ${i === searchHighlighted ? 'bg-[#4493f8]/20 text-white' : 'text-[#e6edf3] hover:bg-[#21262d]'}`}
                      onMouseDown={() => selectSearchResult(tool.id)}
                      onMouseEnter={() => setSearchHighlighted(i)}
                    >
                      <div className="text-xs">{tool.label}</div>
                      <div className="text-[10px] text-[#8b949e]">{tool.categoryLabel}</div>
                    </div>
                  ))}
                </div>
              )}
              {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
                <div
                  ref={searchDropdownRef}
                  className="absolute z-50 left-2 right-2 mt-1 bg-[#161b22] border border-[#21262d] rounded shadow-lg px-2 py-2 text-xs text-[#8b949e]"
                >
                  No tools found
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {visibleCategories.map(cat => (
                <div key={cat.id}>
                  <button
                    className="w-full flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#8b949e] hover:text-white transition-colors"
                    onClick={() => toggleCategory(cat.id)}
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${expandedCategories.has(cat.id) ? 'rotate-90' : ''}`} />
                    {cat.label}
                  </button>
                  {expandedCategories.has(cat.id) && (
                    <div>
                      {cat.tools.map(tool => (
                        <button
                          key={tool.id}
                          className={`w-full text-left pl-7 pr-3 py-1 text-xs transition-colors ${
                            selectedToolId === tool.id
                              ? 'bg-[#4493f8]/15 text-white'
                              : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]/50'
                          }`}
                          onClick={() => selectTool(tool.id)}
                        >
                          {tool.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {/* Pipeline banner */}
            {pipeline && (
              <div className="px-4 pt-3 pb-2 border-b border-[#21262d] flex items-center gap-2 flex-shrink-0">
                <div className="flex-1 flex items-center gap-1 text-[10px] overflow-hidden flex-wrap">
                  <span className="text-[#4493f8] font-medium font-mono">{pipeline.initialDs}</span>
                  {pipeline.steps.map((s, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="text-[#8b949e]">|&gt;</span>
                      <span className="text-[#e6edf3] truncate max-w-[100px]" title={s.pipeStep}>{s.toolLabel}</span>
                    </span>
                  ))}
                  <span className="text-[#8b949e]">|&gt;</span>
                  <span className="text-[#4493f8] font-medium">{selectedTool.label}</span>
                </div>
                <button
                  className="flex-shrink-0 text-[#8b949e] hover:text-[#f85149] transition-colors"
                  title="Clear pipeline"
                  onClick={() => setPipeline(null)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4">
              <SelectionToolForm
                key={selectedToolId}
                tool={selectedTool}
                environments={environments}
                lockedDs={accessPath}
                pipeline={pipeline ?? undefined}
                pipelineColumns={pipelineColumns.length > 0 ? pipelineColumns : undefined}
                onPipe={handlePipe}
                onRunSelection={handleRunSelection}
                running={running}
                runError={runError}
                runSuccess={runSuccess}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
