import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import type { REnvironmentInfo } from '@/lib/r-client'

// Shared autocomplete for picking an R dataset object from the environment list.
// Previously copy-pasted into ToolboxDialog, SelectionQueryDialog, ChartBuilderDialog,
// MapToolboxDialog and PropertiesPanel; the cosmetic differences between those copies
// are exposed here as optional `inputClassName` / `dropdownClassName` overrides.

export interface DatasetComboboxProps {
  value: string
  onChange: (v: string) => void
  environments: REnvironmentInfo[]
  filter?: 'sf' | 'geos' | 'raster' | 'any'
  placeholder?: string
  disabled?: boolean
  inputClassName?: string
  dropdownClassName?: string
}

const DEFAULT_INPUT =
  'w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]'
const DEFAULT_DROPDOWN =
  'absolute z-50 mt-1 w-full bg-[#161b22] border border-[#21262d] rounded shadow-lg max-h-48 overflow-y-auto'

export function DatasetCombobox({
  value,
  onChange,
  environments,
  filter,
  placeholder,
  disabled,
  inputClassName,
  dropdownClassName,
}: DatasetComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [highlighted, setHighlighted] = useState(0)

  const options = environments
    .filter((e) => !e.isSearchPath)
    .flatMap((e) => e.objects)
    .filter((obj) => {
      if (filter === 'sf') return obj.class === 'sf'
      if (filter === 'geos') return obj.class === 'geos_geometry'
      if (filter === 'raster')
        return obj.class === 'SpatRaster' || obj.rgeoProxy?.kind === 'raster'
      return true
    })
    .map((obj) => obj.name)
    .filter((n, i, arr) => arr.indexOf(n) === i) // dedupe

  const filtered = query
    ? options.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => { setQuery(value) }, [value])
  useEffect(() => { setHighlighted(0) }, [query])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function select(name: string) {
    onChange(name)
    setQuery(name)
    setOpen(false)
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { if (filtered[highlighted]) { select(filtered[highlighted]); e.preventDefault() } }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={(inputClassName ?? DEFAULT_INPUT) + (disabled ? ' opacity-50 cursor-not-allowed' : '')}
        value={query}
        placeholder={placeholder ?? 'Select dataset…'}
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
      />
      {open && !disabled && filtered.length > 0 && (
        <div ref={dropdownRef} className={dropdownClassName ?? DEFAULT_DROPDOWN}>
          {filtered.map((name, i) => (
            <div
              key={name}
              className={`px-2 py-1 text-xs cursor-pointer ${i === highlighted ? 'bg-[#4493f8]/20 text-white' : 'text-[#e6edf3] hover:bg-[#21262d]'}`}
              onMouseDown={() => select(name)}
              onMouseEnter={() => setHighlighted(i)}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
