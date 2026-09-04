import React, { useEffect, useLayoutEffect, useState } from 'react'
import { useUiStore } from '@/store/ui'
import { useLayoutStore } from '@/store/layout'

// Pointing at a control instead of pressing it.
//
// The assistant can drive the GUI, but for a tutorial that is often the wrong
// thing to do: a user who watches the Toolbox open by itself has not learned
// where the Toolbox button is. This overlay lets the assistant say "here" —
// a ring around the real control and a callout — and then wait while the user
// does it themselves.
//
// Targets are resolved from `data-ourgeo-id`, not from CSS classes or DOM
// structure, so a restyle cannot silently break the pointing. The catalogue of
// valid ids lives in src/lib/ai-actions/targets.ts and is covered by a test
// that greps the source for each attribute.

/** Ring padding around the target, in px. */
const PAD = 4
/** Auto-clear, so a highlight can never be left stuck on the screen. */
const TIMEOUT_MS = 30_000

interface Box { top: number; left: number; width: number; height: number }

/**
 * The element to ring.
 *
 * A workspace with two editors has two "New file" buttons, and both carry the
 * same `data-ourgeo-id` — deliberately, because a tutorial says "the New file
 * button", not "the New file button in the second editor". So when there is
 * more than one, the one inside the FOCUSED panel wins: that is the editor the
 * user is working in, and therefore the button they are being pointed at.
 * `data-panel-id` is put on every panel box by `Zone`.
 */
function pick(target: string, focusedPanel: string | null): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-ourgeo-id="${CSS.escape(target)}"]`)
  if (all.length <= 1) return all[0] ?? null
  if (focusedPanel) {
    for (const el of all) {
      if (el.closest('[data-panel-id]')?.getAttribute('data-panel-id') === focusedPanel) return el
    }
  }
  return all[0]
}

function measure(target: string, focusedPanel: string | null): Box | null {
  const el = pick(target, focusedPanel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

export function HighlightOverlay(): React.ReactElement | null {
  const highlight = useUiStore((s) => s.highlight)
  const setHighlight = useUiStore((s) => s.setHighlight)
  const focusedPanel = useLayoutStore((s) => s.focusedPanel)
  const [box, setBox] = useState<Box | null>(null)

  // Measure after paint, and keep measuring: the target may be inside a panel
  // that is still opening when the highlight is set.
  useLayoutEffect(() => {
    if (!highlight) { setBox(null); return }
    let frame = 0
    const tick = (): void => {
      setBox(measure(highlight.target, focusedPanel))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [highlight, focusedPanel])

  // Any interaction dismisses it — including the click it was asking for.
  useEffect(() => {
    if (!highlight) return
    const clear = (): void => setHighlight(null)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') clear() }
    const timer = window.setTimeout(clear, TIMEOUT_MS)
    window.addEventListener('pointerdown', clear)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', clear)
      window.removeEventListener('keydown', onKey)
    }
  }, [highlight, setHighlight])

  if (!highlight || !box) return null

  // The callout goes below the target, or above it when there is no room.
  const below = box.top + box.height + 8
  const calloutTop = below + 60 < window.innerHeight ? below : Math.max(8, box.top - 46)
  const calloutLeft = Math.max(8, Math.min(box.left, window.innerWidth - 268))

  return (
    // pointer-events-none throughout: the ring must never intercept the click
    // it is asking the user to make.
    <div className="fixed inset-0 z-[100] pointer-events-none" aria-live="polite">
      <div
        className="absolute rounded-md border-2 border-geo-accent animate-pulse"
        style={{
          top: box.top, left: box.left, width: box.width, height: box.height,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.35), 0 0 12px 2px rgba(68,147,248,0.6)',
        }}
      />
      {highlight.message && (
        <div
          className="absolute max-w-[260px] bg-geo-panel border border-geo-accent rounded-md
                     px-3 py-2 text-[11px] text-foreground shadow-xl"
          style={{ top: calloutTop, left: calloutLeft }}
        >
          {highlight.message}
        </div>
      )}
    </div>
  )
}
