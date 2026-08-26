import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { iconFor } from '@/lib/completion/icons'
import type { CompletionCandidate } from '@/lib/completion/types'

const ROW_H = 22
const MAX_ROWS = 11

interface Props {
  candidates: CompletionCandidate[]
  selected: number
  /** caret position in viewport coordinates */
  left: number
  top: number
  /** height of the current text line, to offset the popup below the caret */
  lineHeight: number
  onPick: (index: number) => void
  onHover: (index: number) => void
}

/**
 * The shared autocomplete dropdown — one presentational component used by both
 * the Monaco editor and the console. Renders a fixed-position, portalled list
 * with per-type glyphs, match highlighting, the R type, and a detail column.
 */
export function CompletionPopup({
  candidates,
  selected,
  left,
  top,
  lineHeight,
  onPick,
  onHover,
}: Props): React.ReactElement | null {
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (candidates.length === 0) return null

  const maxHeight = ROW_H * MAX_ROWS
  // Flip above the caret when there isn't room below it.
  const belowSpace = window.innerHeight - (top + lineHeight)
  const flipUp = belowSpace < maxHeight + 8 && top > belowSpace
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(left, window.innerWidth - 340),
    top: flipUp ? undefined : top + lineHeight,
    bottom: flipUp ? window.innerHeight - top + 2 : undefined,
    maxHeight,
    zIndex: 1000,
  }

  return createPortal(
    <div
      ref={listRef}
      className="w-[320px] overflow-y-auto rounded-md border border-geo-border bg-geo-panel py-1 font-mono text-xs shadow-2xl shadow-black/50"
      style={style}
      // Keep focus in the host input while clicking a row.
      onMouseDown={(e) => e.preventDefault()}
    >
      {candidates.map((c, i) => {
        const icon = iconFor(c.kind, c.rType)
        const isSel = i === selected
        return (
          <div
            key={c.id}
            ref={(el) => (rowRefs.current[i] = el)}
            className={`flex cursor-pointer items-center gap-2 px-2 ${
              isSel ? 'bg-geo-accent/20' : 'hover:bg-geo-bg/60'
            }`}
            style={{ height: ROW_H, borderLeft: `2px solid ${isSel ? 'var(--geo-accent, #4493f8)' : 'transparent'}` }}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(i)
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span
              className="flex w-4 flex-shrink-0 items-center justify-center text-[13px] leading-none"
              style={{ color: c.iconTint ?? icon.color }}
              title={icon.tip}
            >
              {/* A drawn icon when the candidate has one (the markdown catalog
                  shares the ribbon's), the kind's typographic glyph otherwise. */}
              {c.icon ? <c.icon size={13} /> : icon.glyph}
            </span>
            <span className="flex-shrink-0 truncate">
              <HighlightedLabel label={c.label} matched={c.matched} selected={isSel} />
            </span>
            {c.detail && (
              <span className="ml-1 flex-1 truncate text-right text-[10px] text-geo-muted/70">
                {c.detail}
              </span>
            )}
            <span className={`flex-shrink-0 text-[10px] ${c.detail ? '' : 'ml-auto'} text-geo-muted`}>
              {c.rType}
            </span>
          </div>
        )
      })}
    </div>,
    document.body
  )
}

function HighlightedLabel({
  label,
  matched,
  selected,
}: {
  label: string
  matched?: number[]
  selected: boolean
}): React.ReactElement {
  const set = new Set(matched)
  return (
    <span className={selected ? 'text-foreground' : 'text-foreground/90'}>
      {label.split('').map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-bold text-geo-accent">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </span>
  )
}
