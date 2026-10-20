import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Lock, Unlock, FolderOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { savePlotCode, projectFileName, destinationLabel, type FileDestination } from '@/lib/project-file-code'
import { ExportDestinationField, type ExportTarget } from '../project/ExportDestinationField'
import { confirmProjectFileReplace } from '@/store/project-file-replace'

type Format = 'png' | 'jpg' | 'pdf'
type Unit = 'px' | 'in' | 'cm'

const CM_PER_INCH = 2.54

function toPx(value: number, unit: Unit, dpi: number): number {
  if (unit === 'px') return Math.round(value)
  if (unit === 'in') return Math.round(value * dpi)
  return Math.round((value / CM_PER_INCH) * dpi)
}

function fromPx(px: number, unit: Unit, dpi: number): number {
  if (unit === 'px') return px
  if (unit === 'in') return parseFloat((px / dpi).toFixed(2))
  return parseFloat(((px / dpi) * CM_PER_INCH).toFixed(2))
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2))
}

interface SizePreset {
  label: string
  width: number
  height: number
  unit: Unit
  dpi?: number
}

const SIZE_PRESETS: SizePreset[] = [
  { label: '16:9 — 1920 × 1080 px',   width: 1920, height: 1080, unit: 'px' },
  { label: '4:3 — 1600 × 1200 px',    width: 1600, height: 1200, unit: 'px' },
  { label: '1:1 — 1024 × 1024 px',    width: 1024, height: 1024, unit: 'px' },
  { label: 'A4 Portrait',             width: 8.27, height: 11.69, unit: 'in', dpi: 300 },
  { label: 'A4 Landscape',            width: 11.69, height: 8.27, unit: 'in', dpi: 300 },
  { label: 'Letter Portrait',         width: 8.5,  height: 11,   unit: 'in', dpi: 300 },
  { label: 'Letter Landscape',        width: 11,   height: 8.5,  unit: 'in', dpi: 300 },
  { label: 'Custom',                  width: 0,    height: 0,    unit: 'in' },
]

const DPI_PRESETS = [72, 96, 150, 300, 600]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Which recorded plot to render. Null (or a plot R no longer holds) falls
   * back to the most recent plot — without it, exporting after navigating back
   * would silently export the newest plot instead of the visible one.
   */
  plotId?: string | null
}

export function ExportDialog({ open, onOpenChange, plotId = null }: Props): React.ReactElement {
  const [format, setFormat]         = useState<Format>('png')
  const [unit, setUnit]             = useState<Unit>('in')
  const [width, setWidth]           = useState(7)
  const [height, setHeight]         = useState(5)
  const [dpi, setDpi]               = useState(300)
  const [customDpi, setCustomDpi]   = useState('')
  const [lockRatio, setLockRatio]   = useState(true)
  const [aspectRatio, setAspectRatio] = useState(7 / 5)
  const [filename, setFilename]     = useState('plot.png')
  const [exportDir, setExportDir]   = useState('')
  const [target, setTarget]         = useState<ExportTarget>('disk')
  const [projectFolder, setProjectFolder] = useState('figures')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const widthPx  = toPx(width, unit, dpi)
  const heightPx = toPx(height, unit, dpi)

  // ---- Preview ----
  const fetchPreview = useCallback(async () => {
    setPreviewLoading(true)
    setError(null)
    try {
      const res = await rClient.exportPlot({ format: 'png', widthPx, heightPx, dpi, plotId })
      if (res.success && res.data) {
        setPreviewSrc(`data:image/png;base64,${res.data}`)
      } else {
        setError(res.error ?? 'Failed to render preview')
      }
    } catch {
      setError('Failed to render preview')
    } finally {
      setPreviewLoading(false)
    }
  }, [widthPx, heightPx, dpi, plotId])

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchPreview, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [open, fetchPreview])

  // ---- Format change — update filename extension ----
  const handleFormatChange = (f: Format) => {
    setFormat(f)
    setFilename((prev) => prev.replace(/\.[^.]+$/, `.${f}`))
  }

  // ---- Unit change — convert dimensions ----
  const handleUnitChange = (newUnit: Unit) => {
    const wPx = toPx(width, unit, dpi)
    const hPx = toPx(height, unit, dpi)
    setWidth(fromPx(wPx, newUnit, dpi))
    setHeight(fromPx(hPx, newUnit, dpi))
    setUnit(newUnit)
  }

  // ---- Width change with ratio lock ----
  const handleWidthChange = (val: number) => {
    setWidth(val)
    if (lockRatio && val > 0) {
      setHeight(round2(val / aspectRatio))
    }
  }

  // ---- Height change with ratio lock ----
  const handleHeightChange = (val: number) => {
    setHeight(val)
    if (lockRatio && val > 0) {
      setWidth(round2(val * aspectRatio))
    }
  }

  // ---- Capture ratio on blur (manual edit) ----
  const captureRatio = () => {
    if (width > 0 && height > 0) setAspectRatio(width / height)
  }

  // ---- Size preset ----
  const [selectedPreset, setSelectedPreset] = useState('')

  const handlePreset = (label: string) => {
    setSelectedPreset(label)
    if (label === 'Custom') return
    const preset = SIZE_PRESETS.find((p) => p.label === label)
    if (!preset) return
    const newUnit = preset.unit
    const newDpi  = preset.dpi ?? dpi
    setUnit(newUnit)
    setWidth(preset.width)
    setHeight(preset.height)
    setDpi(newDpi)
    setCustomDpi('')
    if (preset.width > 0 && preset.height > 0) {
      setAspectRatio(preset.width / preset.height)
    }
  }

  // ---- DPI preset ----
  const activeDpiPreset = DPI_PRESETS.includes(dpi) && customDpi === '' ? dpi : null

  const handleDpiPreset = (d: number) => {
    setDpi(d)
    setCustomDpi('')
  }

  const handleCustomDpiChange = (val: string) => {
    setCustomDpi(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n > 0) setDpi(n)
  }

  // ---- Browse directory ----
  const handleBrowse = async () => {
    if (!window.electronAPI?.dialog?.openDirectory) return
    const dir = await window.electronAPI.dialog.openDirectory()
    if (dir) setExportDir(dir)
  }

  // ---- Export ----
  // Both destinations run R, so the export is echoed like every other GUI
  // operation: `ourgeo_save_plot("…/plot.png", …)` to disk, or with
  // `ourgeo_project_path("figures/plot.png")` into Project Files. Writing the
  // bytes from here (the old route) echoed nothing, and resolved an empty
  // directory against ouRGeo's process directory rather than R's.
  const handleExport = async () => {
    setSaving(true)
    setError(null)
    try {
      const destination: FileDestination = target === 'project'
        ? { kind: 'project', name: projectFileName(projectFolder, filename) }
        : { kind: 'disk', path: exportDir ? `${exportDir.replace(/[\\/]+$/, '')}/${filename}` : filename }
      if (destination.kind === 'project' && !await confirmProjectFileReplace(destination.name)) return
      const code = savePlotCode(destination, { width, height, units: unit, dpi, plotId })
      useSessionStore.getState().addConsoleEntry('input', code)
      const res = await rClient.execute(code)
      if (!res.success) {
        setError(res.error ?? `Export to ${destinationLabel(destination)} failed`)
        return
      }
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // ---- Style helpers ----
  const fmtBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs border rounded transition-colors ${
      active
        ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
        : 'border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'
    }`

  const dpiBtn = (active: boolean) =>
    `px-2 py-1 text-xs border rounded transition-colors ${
      active
        ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
        : 'border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'
    }`

  const step = unit === 'px' ? 1 : unit === 'in' ? 0.01 : 0.1

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[620px] max-h-[90vh] bg-geo-panel border border-geo-border rounded-lg shadow-xl flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">Export Plot</Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* Settings panel */}
            <div className="flex flex-col gap-4 p-4 w-[220px] flex-shrink-0 border-r border-geo-border overflow-y-auto">

              {/* Format */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-geo-muted font-medium uppercase tracking-wide">Format</span>
                <div className="flex gap-1">
                  {(['png', 'jpg', 'pdf'] as Format[]).map((f) => (
                    <button key={f} className={fmtBtn(format === f)} onClick={() => handleFormatChange(f)}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preset */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-geo-muted font-medium uppercase tracking-wide">Preset</span>
                <select
                  value={selectedPreset}
                  onChange={(e) => handlePreset(e.target.value)}
                  className="bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                >
                  <option value="">— select preset —</option>
                  {SIZE_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Dimensions */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-geo-muted font-medium uppercase tracking-wide">Size</span>
                  <select
                    value={unit}
                    onChange={(e) => handleUnitChange(e.target.value as Unit)}
                    className="bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                  >
                    <option value="px">px</option>
                    <option value="in">in</option>
                    <option value="cm">cm</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col gap-0.5 flex-1">
                    <label className="text-[10px] text-geo-muted">W</label>
                    <input
                      type="number"
                      value={width}
                      step={step}
                      min={step}
                      onChange={(e) => handleWidthChange(Number(e.target.value))}
                      onBlur={captureRatio}
                      className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                    />
                  </div>
                  <span className="text-geo-muted text-xs mt-4">×</span>
                  <div className="flex flex-col gap-0.5 flex-1">
                    <label className="text-[10px] text-geo-muted">H</label>
                    <input
                      type="number"
                      value={height}
                      step={step}
                      min={step}
                      onChange={(e) => handleHeightChange(Number(e.target.value))}
                      onBlur={captureRatio}
                      className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                    />
                  </div>
                </div>

                {/* Aspect ratio lock */}
                <button
                  onClick={() => setLockRatio((v) => !v)}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${lockRatio ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'}`}
                >
                  {lockRatio
                    ? <Lock className="w-3 h-3" />
                    : <Unlock className="w-3 h-3" />
                  }
                  Lock aspect ratio
                </button>
              </div>

              {/* DPI */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-geo-muted font-medium uppercase tracking-wide">
                  {unit === 'px' ? 'DPI (quality)' : 'DPI'}
                </span>
                <div className="flex flex-wrap gap-1">
                  {DPI_PRESETS.map((d) => (
                    <button key={d} className={dpiBtn(activeDpiPreset === d)} onClick={() => handleDpiPreset(d)}>
                      {d}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  placeholder="Custom…"
                  value={customDpi}
                  min={1}
                  max={1200}
                  onChange={(e) => handleCustomDpiChange(e.target.value)}
                  className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground placeholder-geo-muted focus:outline-none focus:border-geo-accent"
                />
              </div>

              {/* Divider */}
              <div className="border-t border-geo-border" />

              {/* File name */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-geo-muted font-medium uppercase tracking-wide">File Name</label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                />
              </div>

              {/* Destination */}
              <ExportDestinationField target={target} onTargetChange={setTarget} folder={projectFolder} onFolderChange={setProjectFolder}>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-geo-muted font-medium uppercase tracking-wide">Directory</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={exportDir}
                      placeholder="Working dir"
                      onChange={(e) => setExportDir(e.target.value)}
                      className="flex-1 min-w-0 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground placeholder-geo-muted focus:outline-none focus:border-geo-accent"
                    />
                    <button
                      onClick={handleBrowse}
                      title="Browse"
                      className="flex-shrink-0 px-2 py-1 bg-geo-bg border border-geo-border rounded text-geo-muted hover:text-foreground hover:border-geo-muted transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </ExportDestinationField>
            </div>

            {/* Preview panel */}
            <div className="flex flex-col flex-1 min-w-0 min-h-0">
              <div className="flex items-center justify-between px-3 py-2 border-b border-geo-border flex-shrink-0">
                <span className="text-xs text-geo-muted">Preview</span>
                {previewLoading && (
                  <span className="text-xs text-geo-muted animate-pulse">Rendering…</span>
                )}
              </div>
              <div className="flex flex-1 items-center justify-center p-4 bg-geo-bg overflow-hidden">
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt="Plot preview"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                ) : error ? (
                  <span className="text-xs text-geo-error text-center px-2">{error}</span>
                ) : (
                  <span className="text-xs text-geo-muted">Loading preview…</span>
                )}
              </div>
            </div>
          </div>

          {/* Status + actions */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-geo-border flex-shrink-0 gap-2">
            <span className="text-xs text-geo-muted">
              {widthPx} × {heightPx} px &middot; {dpi} dpi
            </span>
            <div className="flex items-center gap-2">
              {error && !previewLoading && (
                <span className="text-xs text-geo-error max-w-[200px] truncate" title={error}>{error}</span>
              )}
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button size="sm" onClick={handleExport} disabled={saving || !filename.trim()}>
                {saving ? 'Saving…' : 'Export'}
              </Button>
            </div>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
