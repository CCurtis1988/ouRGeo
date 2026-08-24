import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useSelectionStore } from '@/store/selection'
import { useSpatialStore } from '@/store/spatial'
import type { LayerPick } from '@/lib/selection-apply'

/**
 * Confirmation popup for an ambiguous point/lasso capture: lists every
 * candidate feature grouped by layer with a checkbox (all checked by
 * default). Enter applies the checked items, Escape cancels. Rendered
 * inside the map container, anchored at the capture point.
 */
export function SelectionPopup(): React.ReactElement | null {
  const pending = useSelectionStore((s) => s.pending)
  const setPending = useSelectionStore((s) => s.setPending)
  const setPendingChecked = useSelectionStore((s) => s.setPendingChecked)
  const setPendingCheckedMany = useSelectionStore((s) => s.setPendingCheckedMany)
  const applyPicks = useSelectionStore((s) => s.applyPicks)
  const layers = useSpatialStore((s) => s.layers)

  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // Position at the capture point, flipped/clamped to stay inside the map
  useLayoutEffect(() => {
    if (!pending || !ref.current) { setPos(null); return }
    const rect = ref.current.getBoundingClientRect()
    const parent = ref.current.parentElement
    const pw = parent?.clientWidth ?? window.innerWidth
    const ph = parent?.clientHeight ?? window.innerHeight
    let x = pending.anchor.x + 8
    let y = pending.anchor.y + 8
    if (x + rect.width > pw) x = Math.max(0, pending.anchor.x - rect.width - 8)
    if (y + rect.height > ph) y = Math.max(0, pending.anchor.y - rect.height - 8)
    setPos({ x, y })
  }, [pending])

  useEffect(() => {
    if (pending) ref.current?.focus()
  }, [pending])

  // Group candidate positions by layer, preserving capture order
  const groups = useMemo(() => {
    if (!pending) return []
    const byKey = new Map<string, { name: string; positions: number[] }>()
    pending.candidates.forEach((c, i) => {
      const k = `${c.accessPath}::${c.envName}`
      let g = byKey.get(k)
      if (!g) { g = { name: c.accessPath, positions: [] }; byKey.set(k, g) }
      g.positions.push(i)
    })
    return [...byKey.values()]
  }, [pending])

  const handleApply = useCallback(() => {
    if (!pending) return
    const byLayer = new Map<string, LayerPick>()
    pending.candidates.forEach((c, i) => {
      if (!pending.checked[i]) return
      // Skip candidates whose layer was removed or hidden meanwhile
      const layer = layers.find((l) => l.id === c.layerId)
      if (!layer || !layer.visible) return
      const k = `${c.accessPath}::${c.envName}`
      let pick = byLayer.get(k)
      if (!pick) {
        pick = { accessPath: c.accessPath, envName: c.envName, indices: [] }
        byLayer.set(k, pick)
      }
      pick.indices.push(c.featureIndex)
    })
    applyPicks(
      [...byLayer.values()],
      pending.merge,
      layers
        .filter((l) => l.visible && l.kind !== 'raster')
        .map((l) => ({ accessPath: l.name, envName: l.envName }))
    )
  }, [pending, layers, applyPicks])

  // Window-level capture listener: focus usually sits on the map canvas
  // (MapLibre grabs it on the very click that opened this popup), so an
  // element-scoped onKeyDown would never fire. Capture phase preempts the
  // drawing hotkeys (useDrawHotkeys listens on window bubble).
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'TEXTAREA' || target?.isContentEditable) return
      if (tag === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') return
      if (e.key === 'Enter') {
        // Let a focused button keep its native Enter behavior
        if (tag === 'BUTTON') return
        e.preventDefault()
        e.stopPropagation()
        handleApply()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setPending(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, handleApply, setPending])

  if (!pending) return null

  const checkedCount = pending.checked.filter(Boolean).length

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="absolute z-40 w-64 bg-geo-panel border border-geo-border rounded-lg shadow-xl p-3 flex flex-col gap-2 outline-none"
      style={pos ? { left: pos.x, top: pos.y } : { left: pending.anchor.x + 8, top: pending.anchor.y + 8, visibility: 'hidden' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          Select features — {checkedCount} of {pending.candidates.length} checked
        </span>
        <button
          className="text-geo-muted hover:text-foreground"
          title="Cancel selection"
          onClick={() => setPending(null)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
        {groups.map((g) => {
          const groupChecked = g.positions.filter((i) => pending.checked[i]).length
          const allChecked = groupChecked === g.positions.length
          return (
            <div key={g.name} className="flex flex-col gap-0.5">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[#4493f8]"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = groupChecked > 0 && !allChecked
                  }}
                  onChange={() => setPendingCheckedMany(g.positions, !allChecked)}
                />
                <span className="font-semibold text-geo-accent truncate" title={g.name}>
                  {g.name}
                </span>
              </label>
              {g.positions.map((i) => {
                const c = pending.candidates[i]
                return (
                  <label key={i} className="flex items-center gap-2 text-xs cursor-pointer pl-4">
                    <input
                      type="checkbox"
                      className="accent-[#4493f8]"
                      checked={pending.checked[i]}
                      onChange={(e) => setPendingChecked(i, e.target.checked)}
                    />
                    <span className="truncate text-foreground" title={c.label}>
                      {c.label}
                    </span>
                  </label>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-geo-muted">
          Enter to apply · Esc to cancel
          {pending.merge && <span className="text-geo-accent"> · adding to selection</span>}
        </span>
        <div className="flex gap-1.5">
          <button
            className="px-2 py-1 text-xs rounded border border-geo-border text-foreground hover:bg-geo-bg"
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
          <button
            className="px-2 py-1 text-xs rounded border border-geo-accent bg-geo-accent/10 text-geo-accent hover:bg-geo-accent/20 flex items-center gap-1"
            onClick={handleApply}
          >
            <Check className="w-3 h-3" />
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
