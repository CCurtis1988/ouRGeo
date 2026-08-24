import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Check, ChevronDown, Search, RefreshCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchableOption {
  value: string
  label: string
  /** Secondary text shown muted on the right (e.g. a count or format). */
  hint?: string
}

interface Props {
  value: string | null
  options: SearchableOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  error?: string | null
  /** Shows a refresh affordance in the popup header. */
  onRefresh?: () => void
  emptyText?: string
  className?: string
}

/**
 * A button-triggered dropdown that opens a popup with a filter-as-you-type search
 * box. Generalized from the AI ModelSelectorPopup. Single-select; for multi-select
 * (e.g. "is any of"), call repeatedly and collect values into chips.
 */
export function SearchableSelect({
  value, options, onChange, placeholder = 'Select…',
  disabled, loading, error, onRefresh, emptyText = 'No matches', className,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [options, query])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Reset filter + focus when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep the highlighted item in range as the list narrows
  useEffect(() => { setHighlight((h) => Math.min(h, Math.max(filtered.length - 1, 0))) }, [filtered.length])

  const choose = (v: string) => { onChange(v); setOpen(false) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[highlight]; if (o) choose(o.value) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-1.5 bg-geo-bg border rounded px-2 py-1 text-xs text-left transition-colors',
          'focus:outline-none focus:border-geo-accent',
          open ? 'border-geo-accent' : 'border-geo-border',
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-geo-accent/60',
        )}
      >
        <span className={cn('flex-1 truncate', selected ? 'text-foreground' : 'text-geo-muted')}>
          {selected ? selected.label : placeholder}
        </span>
        {loading
          ? <Loader2 className="w-3 h-3 text-geo-muted animate-spin flex-shrink-0" />
          : <ChevronDown className="w-3 h-3 text-geo-muted flex-shrink-0" />}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-full min-w-[12rem] bg-geo-panel border border-geo-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-geo-border">
            <Search className="w-3 h-3 text-geo-muted flex-shrink-0" />
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-geo-muted focus:outline-none"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {onRefresh && (
              <button type="button" onClick={onRefresh} className="text-geo-muted hover:text-foreground" title="Refresh">
                <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {loading && filtered.length === 0 && (
              <p className="text-xs text-geo-muted px-3 py-2">Loading…</p>
            )}
            {!loading && error && (
              <p className="text-xs text-geo-error px-3 py-2">{error}</p>
            )}
            {!loading && !error && filtered.length === 0 && (
              <p className="text-xs text-geo-muted px-3 py-2">{emptyText}</p>
            )}
            {filtered.map((o, i) => (
              <button
                type="button"
                key={o.value}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(o.value)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  o.value === value ? 'text-geo-accent' : 'text-foreground',
                  i === highlight ? 'bg-geo-accent/10' : 'hover:bg-white/5',
                )}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-[10px] text-geo-muted flex-shrink-0">{o.hint}</span>}
                {o.value === value && <Check className="w-3 h-3 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
