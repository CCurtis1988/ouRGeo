import React, { useState, useMemo, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Play, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useSpatialStore } from '@/store/spatial'
import { useBasemapStore } from '@/store/basemap'
import { useThemeStore } from '@/store/theme'
import { THEME_DEFAULT_BASEMAPS } from '@/lib/basemaps'
import { generateTmapCode } from '@/lib/tmap-codegen'
import { generateGgplotCode } from '@/lib/ggplot-codegen'
import {
  DEFAULT_MAP_ANNOTATIONS,
  type MapAnnotations, type MapPosition, type GgplotCornerPos, type GgplotNorthArrowStyle,
} from '@/lib/map-annotations'
import { rClient } from '@/lib/r-client'
import { cn } from '@/lib/utils'
import { AnnotationsPanel } from './AnnotationsPanel'
import { CheckboxField } from './exportCodeControls'
import {
  northArrowStyleToTmap, AR_PRESETS, DPI_PRESETS,
  toRatioString, adjustBboxForAspectRatio,
  type ExportFormat, type ExportUnit, type ArOrientation,
} from './exportCodeHelpers'

interface ExportCodeDialogProps {
  open: boolean
  onClose: () => void
  mode: 'tmap' | 'ggplot'
  mapContainerRef?: React.RefObject<HTMLDivElement>
}

export function ExportCodeDialog({ open, onClose, mode, mapContainerRef }: ExportCodeDialogProps): React.ReactElement {
  const layers = useSpatialStore((s) => s.layers)
  const viewState = useSpatialStore((s) => s.viewState)
  const viewBbox = useSpatialStore((s) => s.viewBbox)
  const showLegend = useSpatialStore((s) => s.showLegend)
  const legendSettings = useSpatialStore((s) => s.legendSettings)
  const showNorthArrow = useSpatialStore((s) => s.showNorthArrow)
  const northArrowSettings = useSpatialStore((s) => s.northArrowSettings)
  const overrideId = useBasemapStore((s) => s.overrideBasemapId)
  const currentTheme = useThemeStore((s) => s.current)
  const basemapId = overrideId ?? THEME_DEFAULT_BASEMAPS[currentTheme] ?? 'carto-dark-matter'

  const [activeView, setActiveView] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [exportWidth, setExportWidth] = useState(1200)
  const [exportHeight, setExportHeight] = useState(900)
  const [exportUnit, setExportUnit] = useState<ExportUnit>('px')
  const [exportDpi, setExportDpi] = useState(150)
  const [customDpi, setCustomDpi] = useState('')
  const [exportFilename, setExportFilename] = useState('map.png')
  const [exportDir, setExportDir] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [annotations, setAnnotations] = useState<MapAnnotations>(() => ({
    ...DEFAULT_MAP_ANNOTATIONS,
    showLegendExport:        showLegend,
    legendExportPosition:    legendSettings.position as MapPosition,
    legendExportTitle:       legendSettings.title,
    legendExportTitleSize:   legendSettings.titleSize / 12,
    legendExportTextSize:    legendSettings.itemFontSize / 12,
    legendExportFrame:       legendSettings.showBorder,
    legendExportBgColor:     '#ffffff',
    legendExportBgAlpha:     0.7,
    showCompassExport:       showNorthArrow,
    compassExportPosition:   northArrowSettings.position as MapPosition,
    compassExportSize:       northArrowSettings.size / 10,
    compassExportType:       northArrowStyleToTmap(northArrowSettings.style),
    compassExportColorDark:  northArrowSettings.secondaryColor,
    compassExportColorLight: northArrowSettings.primaryColor,
    compassExportShowLabels: northArrowSettings.showLabel,
    compassExportTextSize:   northArrowSettings.labelSize / 12,
  }))
  const [arPreset, setArPreset] = useState('editor')
  const [arOrientation, setArOrientation] = useState<ArOrientation>('landscape')
  const [arCustomW, setArCustomW] = useState(16)
  const [arCustomH, setArCustomH] = useState(9)
  const [tileZoom, setTileZoom] = useState(2)
  const codeRef = useRef<HTMLPreElement>(null)

  const patchAnnotations = (p: Partial<MapAnnotations>) =>
    setAnnotations((prev) => ({ ...prev, ...p }))

  const handleArChange = (u: Partial<{ arPreset: string; arOrientation: ArOrientation; arCustomW: number; arCustomH: number; tileZoom: number }>) => {
    if (u.arPreset !== undefined) setArPreset(u.arPreset)
    if (u.arOrientation !== undefined) setArOrientation(u.arOrientation)
    if (u.arCustomW !== undefined) setArCustomW(u.arCustomW)
    if (u.arCustomH !== undefined) setArCustomH(u.arCustomH)
    if (u.tileZoom !== undefined) setTileZoom(u.tileZoom)
  }

  // When dialog opens: init tile zoom + snapshot legend/compass from spatial editor
  useEffect(() => {
    if (!open) return
    if (mapContainerRef?.current) {
      const { clientWidth: w, clientHeight: h } = mapContainerRef.current
      if (w > 0 && h > 0)
        setExportHeight(Math.round(Math.max(100, Math.min(8000, 1200 * (h / w)))))
    }
    setTileZoom(Math.max(1, Math.min(18, Math.round(viewState.zoom))))

    // Snapshot legend and compass settings from the spatial editor state
    const naPos = northArrowSettings.position
    const ggNaPos: GgplotCornerPos =
      naPos === 'top-left'     ? 'top-left'
      : naPos === 'top-right'  ? 'top-right'
      : naPos === 'bottom-left' ? 'bottom-left'
      : 'bottom-right'
    patchAnnotations({
      showLegendExport:        showLegend,
      legendExportPosition:    legendSettings.position as MapPosition,
      legendExportTitle:       legendSettings.title,
      legendExportTitleSize:   legendSettings.titleSize / 12,
      legendExportTextSize:    legendSettings.itemFontSize / 12,
      legendExportFrame:       legendSettings.showBorder,
      legendExportBgColor:     '#ffffff',
      legendExportBgAlpha:     0.7,
      showCompassExport:       showNorthArrow,
      compassExportPosition:   northArrowSettings.position as MapPosition,
      compassExportSize:       northArrowSettings.size / 10,
      compassExportType:       northArrowStyleToTmap(northArrowSettings.style),
      compassExportColorDark:  northArrowSettings.secondaryColor,
      compassExportColorLight: northArrowSettings.primaryColor,
      compassExportShowLabels: northArrowSettings.showLabel,
      compassExportTextSize:   northArrowSettings.labelSize / 12,
      showNorthArrowExport:    showNorthArrow,
      northArrowExportStyle:   northArrowSettings.style as GgplotNorthArrowStyle,
      northArrowExportPos:     ggNaPos,
      northArrowExportSize:    northArrowSettings.size / 10,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Sync export height when AR preset or orientation changes
  useEffect(() => {
    if (arPreset === 'none' || arPreset === 'custom') return
    let pw: number, ph: number
    if (arPreset === 'editor') {
      const el = mapContainerRef?.current
      if (!el || el.clientWidth === 0) return
      pw = el.clientWidth; ph = el.clientHeight
    } else {
      const p = AR_PRESETS.find((p) => p.id === arPreset)!
      const isLand = arOrientation === 'landscape'
      pw = isLand ? Math.max(p.rw, p.rh) : Math.min(p.rw, p.rh)
      ph = isLand ? Math.min(p.rw, p.rh) : Math.max(p.rw, p.rh)
    }
    if (pw > 0 && ph > 0)
      setExportHeight(Math.round(Math.max(100, Math.min(8000, exportWidth * (ph / pw)))))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arPreset, arOrientation, mapContainerRef])

  // Sync filename extension with format
  useEffect(() => {
    const base = exportFilename.replace(/\.[^.]+$/, '')
    setExportFilename(`${base}.${exportFormat}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportFormat])

  // Compute aspect-ratio-adjusted bbox for tmap static mode
  const adjustedBbox = useMemo<[number, number, number, number] | null>(() => {
    if (!viewBbox) return null
    if (arPreset === 'none') return null
    let w: number, h: number
    if (arPreset === 'editor') {
      const el = mapContainerRef?.current
      if (!el || el.clientWidth === 0) return null
      w = el.clientWidth; h = el.clientHeight
    } else if (arPreset === 'custom') {
      w = arCustomW; h = arCustomH
    } else {
      const p = AR_PRESETS.find((p) => p.id === arPreset)!
      const isLand = arOrientation === 'landscape'
      w = isLand ? Math.max(p.rw, p.rh) : Math.min(p.rw, p.rh)
      h = isLand ? Math.min(p.rw, p.rh) : Math.max(p.rw, p.rh)
    }
    return w > 0 && h > 0 ? adjustBboxForAspectRatio(viewBbox, w, h) : null
  }, [viewBbox, arPreset, arOrientation, arCustomW, arCustomH, mapContainerRef])

  // Ratio string shown in the panel
  const effectiveRatioStr = useMemo(() => {
    if (arPreset === 'editor' || arPreset === 'none' || arPreset === 'custom') return ''
    const p = AR_PRESETS.find((p) => p.id === arPreset)!
    const isLand = arOrientation === 'landscape'
    const pw = isLand ? Math.max(p.rw, p.rh) : Math.min(p.rw, p.rh)
    const ph = isLand ? Math.min(p.rw, p.rh) : Math.max(p.rw, p.rh)
    return toRatioString(pw, ph)
  }, [arPreset, arOrientation])

  const codeParams = useMemo(() => ({
    layers,
    viewState,
    viewBbox,
    showLegend,
    legendSettings,
    showNorthArrow,
    northArrowSettings,
    basemapId,
    activeView,
    annotations,
    adjustedBbox,
    tileZoom,
  }), [layers, viewState, viewBbox, showLegend, legendSettings,
      showNorthArrow, northArrowSettings, basemapId, activeView, annotations,
      adjustedBbox, tileZoom, mode])

  const code = useMemo(() => {
    return mode === 'tmap'
      ? generateTmapCode(codeParams)
      : generateGgplotCode(codeParams)
  }, [mode, codeParams])

  const handleRun = async () => {
    setIsRunning(true)
    try {
      await rClient.execute(code)
    } finally {
      setIsRunning(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleBrowse = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.dialog?.openDirectory) {
      const dir = await window.electronAPI.dialog.openDirectory()
      if (dir) setExportDir(dir)
    }
  }

  const handleActiveViewChange = (val: boolean) => {
    setActiveView(val)
    if (val) setExportOpen(false)
  }

  const handleRenderSave = async () => {
    const exportOpts = {
      path: exportDir ? `${exportDir}/${exportFilename}` : exportFilename,
      width: exportWidth,
      height: exportHeight,
      units: exportUnit,
      dpi: exportDpi,
      format: exportFormat,
    }
    const fullCode = mode === 'tmap'
      ? generateTmapCode({ ...codeParams, exportOpts })
      : generateGgplotCode({ ...codeParams, exportOpts })
    await rClient.execute(fullCode)
  }

  const title = mode === 'tmap' ? 'Export to Tmap' : 'Export to ggplot'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[200]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201]
            w-[900px] max-h-[88vh] bg-geo-panel border border-geo-border rounded-lg shadow-xl
            flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground rounded p-0.5">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-geo-border flex-shrink-0">
            <button
              onClick={handleRun}
              disabled={isRunning}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors',
                isRunning
                  ? 'border-geo-border text-geo-muted cursor-wait'
                  : 'border-geo-accent/50 text-geo-accent hover:bg-geo-accent/10'
              )}
            >
              <Play className="w-3 h-3" />
              {isRunning ? 'Running…' : 'Run in Console'}
            </button>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border
                border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-geo-success" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied!' : 'Copy Code'}
            </button>

            <div className="w-px h-4 bg-geo-border mx-1" />

            <CheckboxField
              label="Active View"
              checked={activeView}
              onChange={handleActiveViewChange}
            />

            <div
              className="ml-auto"
              title={activeView ? 'Disable Active View to export to file' : undefined}
            >
              <button
                onClick={() => !activeView && setExportOpen((v) => !v)}
                disabled={activeView}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors',
                  activeView
                    ? 'border-geo-border text-geo-muted/40 cursor-not-allowed'
                    : exportOpen
                      ? 'border-geo-border bg-geo-bg text-foreground'
                      : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg'
                )}
              >
                Export to File
                {exportOpen
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />
                }
              </button>
            </div>
          </div>

          {/* Body: annotations panel + code area */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Annotations sidebar */}
            <AnnotationsPanel
              annotations={annotations} patch={patchAnnotations} mode={mode}
              arPreset={arPreset} arOrientation={arOrientation}
              arCustomW={arCustomW} arCustomH={arCustomH}
              tileZoom={tileZoom}
              effectiveRatio={effectiveRatioStr}
              onArChange={handleArChange}
            />

            {/* Right: code + export panel */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              {/* Code area */}
              <div className="overflow-y-auto flex-1 min-h-0">
                <pre
                  ref={codeRef}
                  className="p-4 text-xs font-mono text-foreground leading-relaxed whitespace-pre select-all cursor-text"
                  onClick={() => {
                    const sel = window.getSelection()
                    const range = document.createRange()
                    if (codeRef.current) {
                      range.selectNodeContents(codeRef.current)
                      sel?.removeAllRanges()
                      sel?.addRange(range)
                    }
                  }}
                >
                  {code}
                </pre>
              </div>

              {/* Export panel */}
              {exportOpen && !activeView && (
                <div className="border-t border-geo-border px-4 py-3 flex-shrink-0 space-y-3">
                  <p className="text-xs font-semibold text-foreground">Export to File</p>

                  {/* Format */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-16 flex-shrink-0">Format</span>
                    <div className="flex gap-1">
                      {(['png', 'jpg', 'pdf'] as ExportFormat[]).map((f) => (
                        <button
                          key={f}
                          onClick={() => setExportFormat(f)}
                          className={cn(
                            'px-3 py-1 text-xs rounded border uppercase transition-colors',
                            exportFormat === f
                              ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                              : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg'
                          )}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Size */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-16 flex-shrink-0">Size</span>
                    <input
                      type="number" min={1} value={exportWidth}
                      onChange={(e) => setExportWidth(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground focus:outline-none focus:border-geo-accent"
                    />
                    <span className="text-xs text-geo-muted">×</span>
                    <input
                      type="number" min={1} value={exportHeight}
                      onChange={(e) => setExportHeight(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground focus:outline-none focus:border-geo-accent"
                    />
                    <select
                      value={exportUnit}
                      onChange={(e) => setExportUnit(e.target.value as ExportUnit)}
                      className="px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground focus:outline-none focus:border-geo-accent"
                    >
                      <option value="px">px</option>
                      <option value="in">in</option>
                      <option value="cm">cm</option>
                    </select>
                  </div>

                  {/* DPI */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-16 flex-shrink-0">DPI</span>
                    <div className="flex gap-1 flex-wrap">
                      {DPI_PRESETS.map((d) => (
                        <button
                          key={d}
                          onClick={() => { setExportDpi(d); setCustomDpi('') }}
                          className={cn(
                            'px-2 py-1 text-xs rounded border transition-colors',
                            exportDpi === d && customDpi === ''
                              ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                              : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg'
                          )}
                        >
                          {d}
                        </button>
                      ))}
                      <input
                        type="number" min={1} placeholder="Custom" value={customDpi}
                        onChange={(e) => {
                          setCustomDpi(e.target.value)
                          const v = parseInt(e.target.value)
                          if (!isNaN(v) && v > 0) setExportDpi(v)
                        }}
                        className="w-20 px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground placeholder-geo-muted/50 focus:outline-none focus:border-geo-accent"
                      />
                    </div>
                  </div>

                  {/* Filename */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-16 flex-shrink-0">File</span>
                    <input
                      type="text" value={exportFilename}
                      onChange={(e) => setExportFilename(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground focus:outline-none focus:border-geo-accent min-w-0"
                    />
                  </div>

                  {/* Directory */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-16 flex-shrink-0">Directory</span>
                    <input
                      type="text" value={exportDir}
                      onChange={(e) => setExportDir(e.target.value)}
                      placeholder="/home/user/..."
                      className="flex-1 px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground placeholder-geo-muted/50 focus:outline-none focus:border-geo-accent min-w-0"
                    />
                    <button
                      onClick={handleBrowse}
                      className="px-3 py-1 text-xs rounded border border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg transition-colors flex-shrink-0"
                    >
                      Browse
                    </button>
                  </div>

                  {/* Render & Save */}
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={handleRenderSave}
                      className="px-4 py-1.5 text-xs rounded border border-geo-accent/50 text-geo-accent hover:bg-geo-accent/10 transition-colors"
                    >
                      Render &amp; Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
