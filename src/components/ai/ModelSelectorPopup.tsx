import React, { useState, useEffect, useRef } from 'react'
import { Check, RefreshCw, Search } from 'lucide-react'
import { useAiStore } from '@/store/ai'
import { useAiModelCatalogue } from '@/hooks/useAiModelCatalogue'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
}

export function ModelSelectorPopup({ open, onClose, anchorRef }: Props): React.ReactElement | null {
  const provider = useAiStore((s) => s.provider)
  const currentModel = useAiStore((s) => s.currentModel())
  const setModel = useAiStore((s) => s.setModel)
  const catalogue = useAiModelCatalogue(provider, currentModel, open)

  const [query, setQuery] = useState('')
  const popupRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return
      if (anchorRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose, anchorRef])

  useEffect(() => {
    setQuery('')
  }, [open, provider])

  if (!open) return null

  const filtered = catalogue.models.filter(choice => `${choice.id} ${choice.label}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <div
      ref={popupRef}
      className="absolute top-full left-0 mt-1 z-50 w-64 bg-geo-panel border border-geo-border rounded-lg shadow-xl overflow-hidden"
    >
      {/* Search */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-geo-border">
        <Search className="w-3 h-3 text-geo-muted flex-shrink-0" />
        <input
          autoFocus
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-geo-muted focus:outline-none"
          placeholder="Filter models..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        {catalogue.canRefresh && (
          <button
            onClick={() => void catalogue.refresh()}
            className="text-geo-muted hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3 h-3', catalogue.loading && 'animate-spin')} />
          </button>
        )}
      </div>

      {/* Model list */}
      <div className="max-h-64 overflow-y-auto py-1">
        {catalogue.loading && (
          <p className="text-xs text-geo-muted px-3 py-2">Fetching models…</p>
        )}
        {!catalogue.loading && catalogue.error && (
          <p className="text-xs text-geo-error px-3 py-2">{catalogue.error}</p>
        )}
        {filtered.length === 0 && !catalogue.loading && !catalogue.error && (
          <p className="text-xs text-geo-muted px-3 py-2">No models match.</p>
        )}
        {filtered.map(({ id: m, label }) => (
          <button
            key={m}
            onClick={() => { setModel(m); onClose() }}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
              m === currentModel
                ? 'text-geo-accent bg-geo-accent/10'
                : 'text-foreground hover:bg-white/5'
            )}
          >
            <span className="flex-1 truncate">{label}</span>
            {m === currentModel && <Check className="w-3 h-3 flex-shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  )
}
