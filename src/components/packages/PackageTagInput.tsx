import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2, X } from 'lucide-react'

interface CranPackage {
  name: string
  title: string
}

interface PackageTagInputProps {
  value: string[]
  onChange: (pkgs: string[]) => void
  cranPackages: CranPackage[]
  isLoading: boolean
  disabled?: boolean
}

export function PackageTagInput({
  value,
  onChange,
  cranPackages,
  isLoading,
  disabled = false
}: PackageTagInputProps): React.ReactElement {
  const [inputText, setInputText] = useState('')
  const [suggestions, setSuggestions] = useState<CranPackage[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const filterSuggestions = useCallback(
    (text: string) => {
      if (!text) {
        setSuggestions([])
        setActiveIndex(-1)
        return
      }
      const lower = text.toLowerCase()
      const results = cranPackages
        .filter((p) => !value.includes(p.name))
        .filter((p) => p.name.toLowerCase().includes(lower))
        .sort((a, b) => {
          // prefix matches first
          const aPrefix = a.name.toLowerCase().startsWith(lower)
          const bPrefix = b.name.toLowerCase().startsWith(lower)
          if (aPrefix && !bPrefix) return -1
          if (!aPrefix && bPrefix) return 1
          return a.name.localeCompare(b.name)
        })
        .slice(0, 8)
      setSuggestions(results)
      setActiveIndex(-1)
    },
    [cranPackages, value]
  )

  useEffect(() => {
    filterSuggestions(inputText)
  }, [inputText, filterSuggestions])

  function addTag(name: string) {
    if (!value.includes(name)) {
      onChange([...value, name])
    }
    setInputText('')
    setSuggestions([])
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  function removeTag(name: string) {
    onChange(value.filter((v) => v !== name))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        addTag(suggestions[activeIndex].name)
      } else if (inputText.trim()) {
        addTag(inputText.trim())
      }
    } else if (e.key === 'Escape') {
      setSuggestions([])
      setActiveIndex(-1)
    } else if (e.key === 'Backspace' && !inputText && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  // Close dropdown on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([])
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      {/* Tag + input area */}
      <div
        className="min-h-[32px] w-full bg-geo-bg border border-geo-border rounded px-2 py-1 flex flex-wrap gap-1 items-center cursor-text focus-within:border-geo-accent"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((pkg) => (
          <span
            key={pkg}
            className="inline-flex items-center gap-0.5 bg-geo-accent/20 text-geo-accent border border-geo-accent/30 rounded px-1.5 py-0.5 text-[11px] leading-none"
          >
            {pkg}
            {!disabled && (
              <button
                type="button"
                className="ml-0.5 hover:text-white"
                onClick={(e) => { e.stopPropagation(); removeTag(pkg) }}
                tabIndex={-1}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        ))}

        <div className="flex items-center gap-1 flex-1 min-w-[80px]">
          {isLoading && <Loader2 className="w-3 h-3 text-geo-muted animate-spin shrink-0" />}
          <input
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || isLoading}
            placeholder={value.length === 0 ? (isLoading ? 'Loading CRAN list…' : 'Type a package name…') : ''}
            className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-geo-muted outline-none"
          />
        </div>
      </div>

      {/* Dropdown */}
      {suggestions.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-geo-panel border border-geo-border rounded shadow-xl max-h-48 overflow-y-auto"
        >
          {suggestions.map((pkg, i) => (
            <li
              key={pkg.name}
              className={`px-2.5 py-1.5 cursor-pointer text-xs flex items-baseline gap-2 ${
                i === activeIndex
                  ? 'bg-geo-accent/20 text-foreground'
                  : 'hover:bg-geo-bg text-foreground'
              }`}
              onMouseDown={(e) => { e.preventDefault(); addTag(pkg.name) }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="font-medium shrink-0">{pkg.name}</span>
              <span className="text-geo-muted truncate">{pkg.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
