import React, { useState, useCallback } from 'react'
import { Crosshair, Plus, Trash2, X } from 'lucide-react'
import { SearchableSelect } from '../ui/SearchableSelect'
import {
  fieldKind, defaultOp, OP_LABELS,
  type Field, type Filter, type FilterOp, type FieldKind, type Query,
} from '@/lib/api-connectors/query-model'
import { layerCenter } from '@/lib/layer-center'
import { useSpatialStore } from '@/store/spatial'
import { cn } from '@/lib/utils'

// Coordinate-pair fields, by conventional naming (Macrostrat lat/lng, generic
// latitude/longitude) — when a resource has both, the builder offers one-click
// fills from the Spatial Editor.
const LAT_FIELD = /^(lat|latitude)$/i
const LNG_FIELD = /^(lng|lon|long|longitude)$/i

interface Props {
  fields: Field[]
  query: Query
  onChange: (query: Query) => void
  /** Operators offered for a field kind (already gated by the provider/caps). */
  opsFor: (kind: FieldKind) => FilterOp[]
  /** Lazily fetch distinct values for a field; omit if the provider can't. */
  fetchDistinct?: (field: string) => Promise<string[]>
  /** Show the global full-text box (providers that support it). */
  fullText?: boolean
  /** Optional inline notice (e.g. reduced operator set). */
  note?: string
}

interface DistinctState { loading: boolean; values: string[]; error: boolean }

function pickOp(kind: FieldKind, opsFor: (k: FieldKind) => FilterOp[]): FilterOp {
  const ops = opsFor(kind)
  const d = defaultOp(kind)
  return ops.includes(d) ? d : (ops[0] ?? d)
}

export function QueryBuilder({ fields, query, onChange, opsFor, fetchDistinct, fullText = true, note }: Props): React.ReactElement {
  const [distinct, setDistinct] = useState<Record<string, DistinctState>>({})

  // Lat/lng quick fill from the Spatial Editor (map view or a layer's center).
  const latField = fields.find((f) => LAT_FIELD.test(f.id) && fieldKind(f.type) === 'numeric')
  const lngField = fields.find((f) => LNG_FIELD.test(f.id) && fieldKind(f.type) === 'numeric')
  const viewBbox = useSpatialStore((s) => s.viewBbox)
  const spatialLayers = useSpatialStore((s) => s.layers)

  /** Upsert the lat + lng filters (op '=') with a 4326 coordinate. */
  const setPoint = (lat: number, lng: number) => {
    if (!latField || !lngField) return
    const next = [...query.filters]
    for (const [field, v] of [[latField, lat], [lngField, lng]] as const) {
      const kind = fieldKind(field.type)
      const value = String(Number(v.toFixed(5)))
      const i = next.findIndex((f) => f.field === field.id)
      if (i >= 0) next[i] = { ...next[i], kind, op: 'eq', value, value2: '', values: [] }
      else next.push({ id: crypto.randomUUID(), field: field.id, kind, op: 'eq', value, values: [] })
    }
    onChange({ ...query, filters: next })
  }

  const loadDistinct = useCallback((field: string) => {
    if (!fetchDistinct) return
    setDistinct((prev) => (prev[field] ? prev : { ...prev, [field]: { loading: true, values: [], error: false } }))
    fetchDistinct(field)
      .then((values) => setDistinct((prev) => ({ ...prev, [field]: { loading: false, values, error: false } })))
      .catch(() => setDistinct((prev) => ({ ...prev, [field]: { loading: false, values: [], error: true } })))
  }, [fetchDistinct])

  const setFilters = (filters: Filter[]) => onChange({ ...query, filters })
  const patchFilter = (id: string, patch: Partial<Filter>) =>
    setFilters(query.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const addFilter = () => {
    const first = fields[0]
    if (!first) return
    const kind = fieldKind(first.type)
    setFilters([...query.filters, { id: crypto.randomUUID(), field: first.id, kind, op: pickOp(kind, opsFor), value: '', values: [] }])
  }

  const fieldOptions = fields.map((f) => ({ value: f.id, label: f.label ?? f.id, hint: f.type }))

  return (
    <div className="flex flex-col gap-2">
      {fullText && (
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-geo-muted w-20 flex-shrink-0">Search all</label>
          <input
            type="text"
            value={query.q}
            onChange={(e) => onChange({ ...query, q: e.target.value })}
            placeholder="Full-text across every column (optional)"
            className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
          />
        </div>
      )}

      {latField && lngField && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-geo-muted w-20 flex-shrink-0">Point (lat/lng)</span>
          <button
            type="button"
            disabled={!viewBbox}
            title={viewBbox ? 'Fill lat/lng with the center of the current map view' : 'Open the Spatial Editor to use the map view'}
            onClick={() => viewBbox && setPoint((viewBbox[1] + viewBbox[3]) / 2, (viewBbox[0] + viewBbox[2]) / 2)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-geo-border text-geo-muted hover:text-foreground hover:border-geo-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Crosshair className="w-3 h-3" /> Map view center
          </button>
          {spatialLayers.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const layer = spatialLayers.find((l) => l.id === e.target.value)
                const c = layer ? layerCenter(layer) : null
                if (c) setPoint(c[1], c[0])
              }}
              className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-geo-muted hover:text-foreground focus:outline-none focus:border-geo-accent"
            >
              <option value="" disabled>Center of a layer…</option>
              {spatialLayers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <span className="text-[10px] text-geo-muted">fills the filters below — values stay editable</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {query.filters.length > 0 && <span className="text-[11px] text-geo-muted">Filters (all must match)</span>}
        {query.filters.map((f) => (
          <FilterRow
            key={f.id}
            filter={f}
            fields={fields}
            fieldOptions={fieldOptions}
            opsFor={opsFor}
            hasDistinct={!!fetchDistinct}
            distinct={distinct[f.field]}
            onLoadDistinct={() => loadDistinct(f.field)}
            onChange={(patch) => patchFilter(f.id, patch)}
            onRemove={() => setFilters(query.filters.filter((x) => x.id !== f.id))}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addFilter}
          disabled={fields.length === 0}
          className="flex items-center gap-1 text-xs text-geo-accent hover:text-geo-accent/80 disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Add filter
        </button>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-geo-muted">Row limit</label>
          <input
            type="number"
            min={1}
            value={query.limit}
            onChange={(e) => onChange({ ...query, limit: Math.max(1, Number(e.target.value) || 1) })}
            className="w-24 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
          />
        </div>
      </div>

      {note && <p className="text-[10px] text-geo-muted">{note}</p>}
    </div>
  )
}

// ── One filter row ──────────────────────────────────────────────────────────
interface RowProps {
  filter: Filter
  fields: Field[]
  fieldOptions: { value: string; label: string; hint?: string }[]
  opsFor: (kind: FieldKind) => FilterOp[]
  hasDistinct: boolean
  distinct?: DistinctState
  onLoadDistinct: () => void
  onChange: (patch: Partial<Filter>) => void
  onRemove: () => void
}

function FilterRow({ filter, fields, fieldOptions, opsFor, hasDistinct, distinct, onLoadDistinct, onChange, onRemove }: RowProps): React.ReactElement {
  const ops = opsFor(filter.kind)
  const usesDistinct = hasDistinct && filter.kind === 'text' && (filter.op === 'is' || filter.op === 'isAnyOf')

  React.useEffect(() => {
    if (usesDistinct && !distinct) onLoadDistinct()
  }, [usesDistinct, distinct, onLoadDistinct])

  const changeField = (fieldId: string) => {
    const field = fields.find((f) => f.id === fieldId)
    if (!field) return
    const kind = fieldKind(field.type)
    onChange({ field: fieldId, kind, op: ops.includes(filter.op) && fieldKind(field.type) === filter.kind ? filter.op : defaultOpFor(kind, opsFor), value: '', value2: '', values: [] })
  }

  const distinctOptions = (distinct?.values ?? []).map((v) => ({ value: v, label: v }))

  return (
    <div className="flex items-start gap-1.5">
      <div className="w-40 flex-shrink-0">
        <SearchableSelect value={filter.field} options={fieldOptions} onChange={changeField} placeholder="Column" />
      </div>

      <select
        value={filter.op}
        onChange={(e) => onChange({ op: e.target.value as FilterOp, value: '', value2: '', values: [] })}
        className="w-24 flex-shrink-0 bg-geo-bg border border-geo-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
      >
        {ops.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
      </select>

      <div className="flex-1 min-w-0">
        <ValueEditor filter={filter} usesDistinct={usesDistinct} distinct={distinct} distinctOptions={distinctOptions} onChange={onChange} />
      </div>

      <button type="button" onClick={onRemove} className="text-geo-muted hover:text-geo-error mt-1 flex-shrink-0" title="Remove filter">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function defaultOpFor(kind: FieldKind, opsFor: (k: FieldKind) => FilterOp[]): FilterOp {
  const ops = opsFor(kind)
  const d = defaultOp(kind)
  return ops.includes(d) ? d : (ops[0] ?? d)
}

// ── Value editor (varies by operator + field kind) ──────────────────────────
interface ValueProps {
  filter: Filter
  usesDistinct: boolean
  distinct?: DistinctState
  distinctOptions: { value: string; label: string }[]
  onChange: (patch: Partial<Filter>) => void
}

function ValueEditor({ filter, usesDistinct, distinct, distinctOptions, onChange }: ValueProps): React.ReactElement {
  const inputCls = 'w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent'

  if (filter.op === 'isAnyOf') {
    const values = filter.values ?? []
    const remaining = distinctOptions.filter((o) => !values.includes(o.value))
    const noDistinct = !usesDistinct || distinct?.error || (distinct && distinct.values.length === 0 && !distinct.loading)
    return (
      <div className="flex flex-col gap-1">
        {values.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {values.map((v) => (
              <span key={v} className="flex items-center gap-1 bg-geo-accent/10 text-geo-accent rounded px-1.5 py-0.5 text-[11px]">
                {v}
                <button type="button" onClick={() => onChange({ values: values.filter((x) => x !== v) })}><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
        )}
        {noDistinct ? (
          <input
            type="text"
            placeholder="Type a value, press Enter"
            className={inputCls}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const v = (e.target as HTMLInputElement).value.trim()
                if (v && !values.includes(v)) onChange({ values: [...values, v] })
                ;(e.target as HTMLInputElement).value = ''
              }
            }}
          />
        ) : (
          <SearchableSelect
            value={null}
            options={remaining}
            onChange={(v) => onChange({ values: [...values, v] })}
            placeholder={distinct?.loading ? 'Loading values…' : 'Add value…'}
            loading={distinct?.loading}
          />
        )}
      </div>
    )
  }

  if (usesDistinct) {
    const hasOptions = (distinct?.values.length ?? 0) > 0
    if (!hasOptions && (distinct?.error || (distinct && !distinct.loading))) {
      return <input type="text" value={filter.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="Value" className={inputCls} />
    }
    return (
      <SearchableSelect
        value={filter.value || null}
        options={distinctOptions}
        onChange={(v) => onChange({ value: v })}
        placeholder={distinct?.loading ? 'Loading values…' : 'Select value…'}
        loading={distinct?.loading}
      />
    )
  }

  if (filter.op === 'between' || filter.op === 'dateBetween') {
    const type = filter.kind === 'timestamp' ? 'date' : 'number'
    return (
      <div className="flex items-center gap-1">
        <input type={type} value={filter.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="min" className={inputCls} />
        <span className="text-[11px] text-geo-muted flex-shrink-0">and</span>
        <input type={type} value={filter.value2 ?? ''} onChange={(e) => onChange({ value2: e.target.value })} placeholder="max" className={inputCls} />
      </div>
    )
  }

  const type = filter.kind === 'numeric' ? 'number' : filter.kind === 'timestamp' ? 'date' : 'text'
  return (
    <input
      type={type}
      value={filter.value}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={filter.op === 'contains' ? 'Contains…' : 'Value'}
      className={cn(inputCls)}
    />
  )
}
