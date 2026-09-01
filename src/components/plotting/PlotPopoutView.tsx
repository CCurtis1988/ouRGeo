import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Maximize2 } from 'lucide-react'
import { Button } from '../ui/button'
import { ExportDialog } from './ExportDialog'
import { rClient } from '@/lib/r-client'
import { loadTheme, loadUiScale, loadEditorThemes } from '@/lib/theme-persistence'
import { applyTheme } from '@/lib/themes'
import { loadCustomThemes } from '@/lib/custom-themes-persistence'
import { installBundle } from '@/lib/custom-themes'
import { applyEditorTheme } from '@/lib/editor-themes'
import { applyUiScale } from '@/store/theme'
import type { PlotPopoutState } from '@/store/plotting'

/** Wait this long after the last resize event before asking R to re-render. */
const RESIZE_SETTLE_MS = 200

const EMPTY_STATE: PlotPopoutState = { dataUrl: null, plotId: null, index: -1, total: 0 }

/**
 * The "Open in separate window" view. It mirrors the main window's plot store
 * (pushed over `plot:state`) and re-renders the current plot in R at the
 * window's own pixel size, so enlarging the window sharpens the plot instead
 * of scaling a fixed bitmap. Navigation is an intent sent back over
 * `plot:navigate` — the main window's store stays the single source of truth.
 */
export function PlotPopoutView(): React.ReactElement {
  const [state, setState] = useState<PlotPopoutState>(EMPTY_STATE)
  const [renderedSrc, setRenderedSrc] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  // Guards against a slow large render landing after a fast small one.
  const requestSeq = useRef(0)
  const lastRenderedPlotId = useRef<string | null>(null)

  const { dataUrl, plotId, index, total } = state
  const hasPlot = index >= 0 && !!dataUrl

  // ---- Bootstrap: theme, R connection, state feed ----
  // This window never mounts MainApp, so it has to set up its own theme
  // variables and R client.
  useEffect(() => {
    void (async () => {
      try {
        // The popout is a second BrowserWindow with its own module graph, so
        // it registers the user's themes for itself before resolving ids.
        try {
          installBundle(await loadCustomThemes())
        } catch { /* ship-only themes are a fine fallback */ }
        const themeId = await loadTheme()
        applyTheme(themeId)
        // No Monaco here, but an undefined custom property makes the whole
        // declaration invalid at computed-value time — a silent inherit, not a
        // fallback — so this window sets the editor vars too.
        const { codeTheme, markdownTheme } = await loadEditorThemes(themeId)
        applyEditorTheme(themeId, codeTheme, markdownTheme)
        applyUiScale(await loadUiScale())
      } catch {
        /* fall back to the stylesheet defaults */
      }
      try {
        await rClient.connect()
      } catch {
        /* re-render degrades to the cached bitmap */
      }
    })()

    const offState = window.electronAPI.plot.onState(setState)
    const offRestart = window.electronAPI.r.onRestarted(() => {
      void rClient.connect().catch(() => undefined)
    })
    return () => {
      offState()
      offRestart()
    }
  }, [])

  // ---- Track the available image area ----
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      // Keep the identity stable when nothing actually changed, so the render
      // effect below doesn't refire.
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ---- Re-render at the current size ----
  const render = useCallback(
    async (targetPlotId: string, w: number, h: number) => {
      const seq = ++requestSeq.current
      setRendering(true)
      // Match the device pixel ratio in *both* dimensions and dpi: more pixels
      // for a sharper raster, while text and line weights stay the same
      // physical size.
      const dpr = window.devicePixelRatio || 1
      const res = await rClient.exportPlot({
        format: 'png',
        widthPx: Math.max(1, Math.round(w * dpr)),
        heightPx: Math.max(1, Math.round(h * dpr)),
        dpi: Math.round(96 * dpr),
        plotId: targetPlotId,
      })
      if (seq !== requestSeq.current) return // superseded by a newer request
      setRendering(false)
      if (res.success && res.data) {
        setRenderedSrc(`data:image/png;base64,${res.data}`)
        setError(null)
      } else {
        // Fall back to the bitmap R already broadcast. A missing recording is
        // expected (old plot, restarted R) and gets the "cached" chip instead
        // of an error.
        setRenderedSrc(null)
        setError(/no longer available/i.test(res.error ?? '') ? null : res.error ?? null)
      }
    },
    []
  )

  useEffect(() => {
    // Navigating to a different plot renders immediately; a resize waits for
    // the drag to settle so we don't queue a request per frame.
    const switched = plotId !== lastRenderedPlotId.current
    lastRenderedPlotId.current = plotId
    if (switched) {
      // Drop the previous plot's high-res render — otherwise it would linger
      // on screen while the new one is being drawn.
      requestSeq.current++
      setRenderedSrc(null)
      setError(null)
      setRendering(false)
    }

    if (!plotId || !size || size.w < 1 || size.h < 1) return
    if (switched) {
      void render(plotId, size.w, size.h)
      return
    }
    const timer = setTimeout(() => void render(plotId, size.w, size.h), RESIZE_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [plotId, size, render])

  const navigate = (target: number): void => {
    void window.electronAPI.plot.navigate(target)
  }

  const displaySrc = renderedSrc ?? dataUrl
  // Only claim "cached" once we've settled — mid-render the bitmap is just a
  // placeholder, not the final answer.
  const isCached = hasPlot && !renderedSrc && !rendering

  return (
    <div className="flex flex-col h-screen w-screen bg-geo-panel">
      {/* Toolbar — mirrors the Plots panel header */}
      <div className="flex items-center justify-between px-2 h-9 border-b border-geo-border flex-shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
            onClick={() => navigate(index - 1)}
            disabled={index <= 0}
            title="Previous plot"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-xs text-geo-muted tabular-nums">
            {total > 0 ? `${index + 1} / ${total}` : '0 / 0'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
            onClick={() => navigate(index + 1)}
            disabled={index >= total - 1}
            title="Next plot"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>

          {isCached && (
            <span
              className="ml-1 px-1.5 py-0.5 rounded text-[10px] text-geo-muted border border-geo-border"
              title="This plot predates the current R session, so it can't be re-rendered at the window size."
            >
              cached
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {rendering && <span className="text-xs text-geo-muted animate-pulse mr-1">Rendering…</span>}
          {error && !rendering && (
            <span className="text-xs text-geo-error max-w-[240px] truncate mr-1" title={error}>
              {error}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
            onClick={() => setExportOpen(true)}
            disabled={!hasPlot}
            title="Export plot"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
            onClick={() => void window.electronAPI.plot.toggleFullscreen()}
            title="Toggle full screen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Plot area — the ResizeObserver target drives the render size */}
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 items-center justify-center p-2 bg-geo-bg"
      >
        {displaySrc ? (
          <img
            src={displaySrc}
            alt="R plot"
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-xs text-geo-muted">No plots yet.</span>
            <span className="text-xs text-geo-muted">Run a plot command in the console.</span>
          </div>
        )}
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} plotId={plotId} />
    </div>
  )
}
