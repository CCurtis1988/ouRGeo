import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { X, AlertTriangle, Lock, Unlock, FolderOpen, ChevronDown } from 'lucide-react'
import { captureMapContainer, dataUriToBase64 } from '@/lib/export-canvas'
import { cn } from '@/lib/utils'

// ---- Warning toast ----

interface ToastProps { visible: boolean; onDismiss: () => void }

function ExportWarningToast({ visible, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(onDismiss, 3000)
    return () => clearTimeout(t)
  }, [visible, onDismiss])

  if (!visible) return null
  return createPortal(
    <div
      className="fixed bottom-6 right-6 z-[9999] max-w-xs
        bg-amber-950/90 border border-amber-700 rounded-lg px-4 py-3
        text-xs shadow-xl flex gap-2 items-start"
    >
      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-amber-200 mb-0.5">Canvas export limitations</p>
        <p className="text-amber-300/80 leading-relaxed">
          Resolution is capped at screen DPI (~96). For publication-quality
          output use Export to Tmap or Export to ggplot.
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-amber-400 hover:text-amber-200 ml-1 flex-shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>,
    document.body
  )
}

// ---- Types ----

type ExportFormat = 'png' | 'jpg' | 'pdf'
type SizeUnit = 'px' | 'in' | 'cm'

interface Preset { label: string; w: number; h: number; unit: SizeUnit }

const PRESETS: Preset[] = [
  { label: '16:9 — 1920×1080',    w: 1920, h: 1080, unit: 'px' },
  { label: '4:3 — 1600×1200',     w: 1600, h: 1200, unit: 'px' },
  { label: '1:1 — 1024×1024',     w: 1024, h: 1024, unit: 'px' },
  { label: 'A4 Portrait',         w: 8.27, h: 11.69, unit: 'in' },
  { label: 'A4 Landscape',        w: 11.69, h: 8.27, unit: 'in' },
  { label: 'Letter Portrait',     w: 8.5,  h: 11,   unit: 'in' },
  { label: 'Letter Landscape',    w: 11,   h: 8.5,  unit: 'in' },
]

const DPI_PRESETS = [72, 96, 150, 300, 600]

// Convert dimension value between units
function convertUnit(value: number, from: SizeUnit, to: SizeUnit, dpi: number): number {
  // First convert to px
  let px: number
  if (from === 'px') px = value
  else if (from === 'in') px = value * dpi
  else px = (value / 2.54) * dpi

  // Then to target
  if (to === 'px') return Math.round(px)
  if (to === 'in') return parseFloat((px / dpi).toFixed(3))
  return parseFloat((px / dpi * 2.54).toFixed(3))
}

function toPx(value: number, unit: SizeUnit, dpi: number): number {
  return Math.max(1, Math.round(convertUnit(value, unit, 'px', dpi)))
}

// ---- Dialog ----

interface ExportImgDialogProps {
  open: boolean
  onClose: () => void
  mapContainerRef: React.RefObject<HTMLDivElement>
}

export function ExportImgDialog({ open, onClose, mapContainerRef }: ExportImgDialogProps): React.ReactElement {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [unit, setUnit] = useState<SizeUnit>('px')
  const [dpi, setDpi] = useState(96)
  const [customDpi, setCustomDpi] = useState('')
  const [lockRatio, setLockRatio] = useState(true)
  const [expandMargins, setExpandMargins] = useState(false)
  const [marginAll, setMarginAll] = useState(0)
  const [marginTop, setMarginTop] = useState(0)
  const [marginRight, setMarginRight] = useState(0)
  const [marginBottom, setMarginBottom] = useState(0)
  const [marginLeft, setMarginLeft] = useState(0)
  const [filename, setFilename] = useState('spatial-export.png')
  const [exportDir, setExportDir] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [presetOpen, setPresetOpen] = useState(false)
  const presetRef = useRef<HTMLDivElement>(null)
  const aspectRatioRef = useRef<number | null>(null)

  // Capture aspect ratio on open
  useEffect(() => {
    if (!open) return
    const el = mapContainerRef.current
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      aspectRatioRef.current = el.clientWidth / el.clientHeight
      // Set initial dimensions based on container
      setWidth(el.clientWidth)
      setHeight(el.clientHeight)
      setUnit('px')
    }
  }, [open, mapContainerRef])

  // Sync filename extension with format
  useEffect(() => {
    setFilename((prev) => {
      const base = prev.replace(/\.(png|jpg|jpeg|pdf)$/i, '')
      return `${base}.${format}`
    })
  }, [format])

  // Close preset dropdown on click-outside
  useEffect(() => {
    if (!presetOpen) return
    function onDown(e: MouseEvent) {
      if (presetRef.current && !presetRef.current.contains(e.target as Node))
        setPresetOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [presetOpen])

  const effectiveDpi = customDpi ? parseInt(customDpi, 10) || dpi : dpi

  const handleWidthChange = (val: number) => {
    setWidth(val)
    if (lockRatio && aspectRatioRef.current) {
      setHeight(parseFloat((val / aspectRatioRef.current).toFixed(3)))
    }
  }

  const handleHeightChange = (val: number) => {
    setHeight(val)
    if (lockRatio && aspectRatioRef.current) {
      setWidth(parseFloat((val * aspectRatioRef.current).toFixed(3)))
    }
  }

  const handleUnitChange = (newUnit: SizeUnit) => {
    setWidth(convertUnit(width, unit, newUnit, effectiveDpi))
    setHeight(convertUnit(height, unit, newUnit, effectiveDpi))
    setUnit(newUnit)
  }

  const handlePreset = (preset: Preset) => {
    setUnit(preset.unit)
    setWidth(preset.w)
    setHeight(preset.h)
    if (preset.w > 0 && preset.h > 0) {
      aspectRatioRef.current = preset.w / preset.h
    }
    setPresetOpen(false)
  }

  const handleDpiPreset = (val: number) => {
    setDpi(val)
    setCustomDpi('')
  }

  const effectiveMarginPx = expandMargins
    ? Math.max(marginTop, marginRight, marginBottom, marginLeft)
    : marginAll

  const handleBrowse = async () => {
    const dir = await window.electronAPI.dialog.openDirectory()
    if (dir) setExportDir(dir)
  }

  const handleExport = async () => {
    if (!exportDir) { setError('Please select an export directory.'); return }
    if (!mapContainerRef.current) { setError('Map container not available.'); return }
    setError(null)
    setIsExporting(true)
    try {
      const widthPx = toPx(width, unit, effectiveDpi)
      const heightPx = toPx(height, unit, effectiveDpi)
      const dataUri = await captureMapContainer(mapContainerRef.current, {
        widthPx, heightPx, dpi: effectiveDpi, format, marginPx: effectiveMarginPx,
      })
      const base64 = dataUriToBase64(dataUri)
      const sep = exportDir.endsWith('/') || exportDir.endsWith('\\') ? '' : '/'
      await window.electronAPI.file.writeBinary(`${exportDir}${sep}${filename}`, base64)
      onClose()
      setShowToast(true)
    } catch (err) {
      setError(`Export failed: ${String(err)}`)
    } finally {
      setIsExporting(false)
    }
  }

  const inputCls = 'bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent'

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
              w-[500px] max-h-[88vh] overflow-y-auto
              bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-geo-border sticky top-0 bg-geo-panel z-10">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Export to Image
              </Dialog.Title>
              <Dialog.Close className="text-geo-muted hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-5">

              {/* Format */}
              <div>
                <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-2">Format</p>
                <div className="flex gap-1">
                  {(['png', 'jpg', 'pdf'] as ExportFormat[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={cn(
                        'px-3 py-1 text-xs rounded border font-medium uppercase transition-colors',
                        format === f
                          ? 'bg-geo-accent/20 border-geo-accent text-geo-accent'
                          : 'border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dimensions */}
              <div>
                <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-2">Dimensions</p>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    min={1}
                    value={width}
                    onChange={(e) => handleWidthChange(parseFloat(e.target.value) || 1)}
                    className={cn(inputCls, 'w-24 text-center')}
                  />
                  <span className="text-geo-muted text-xs">×</span>
                  <input
                    type="number"
                    min={1}
                    value={height}
                    onChange={(e) => handleHeightChange(parseFloat(e.target.value) || 1)}
                    className={cn(inputCls, 'w-24 text-center')}
                  />
                  <select
                    value={unit}
                    onChange={(e) => handleUnitChange(e.target.value as SizeUnit)}
                    className={cn(inputCls, 'cursor-pointer')}
                  >
                    <option value="px">px</option>
                    <option value="in">in</option>
                    <option value="cm">cm</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setLockRatio((v) => !v)
                      if (!lockRatio && width > 0 && height > 0) {
                        aspectRatioRef.current = width / height
                      }
                    }}
                    className={cn(
                      'flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors',
                      lockRatio
                        ? 'border-geo-accent text-geo-accent bg-geo-accent/10'
                        : 'border-geo-border text-geo-muted hover:text-foreground'
                    )}
                  >
                    {lockRatio ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    Lock ratio
                  </button>

                  <div className="relative" ref={presetRef}>
                    <button
                      onClick={() => setPresetOpen((v) => !v)}
                      className={cn(
                        'flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors',
                        'border-geo-border text-geo-muted hover:text-foreground'
                      )}
                    >
                      Preset <ChevronDown className={cn('w-3 h-3 transition-transform', presetOpen && 'rotate-180')} />
                    </button>
                    {presetOpen && (
                      <div className="absolute left-0 top-full mt-1 w-52 bg-geo-panel border border-geo-border rounded shadow-lg z-50 py-1">
                        {PRESETS.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => handlePreset(p)}
                            className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* DPI */}
              <div>
                <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-2">Resolution (DPI)</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {DPI_PRESETS.map((d) => (
                    <button
                      key={d}
                      onClick={() => handleDpiPreset(d)}
                      className={cn(
                        'px-2.5 py-1 text-xs rounded border transition-colors',
                        dpi === d && !customDpi
                          ? 'bg-geo-accent/20 border-geo-accent text-geo-accent'
                          : 'border-geo-border text-geo-muted hover:text-foreground'
                      )}
                    >
                      {d}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={2400}
                    placeholder="Custom"
                    value={customDpi}
                    onChange={(e) => setCustomDpi(e.target.value)}
                    className={cn(inputCls, 'w-20 placeholder:text-geo-muted/50')}
                  />
                </div>
              </div>

              {/* Margins */}
              <div>
                <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-2">Margins (px)</p>
                {!expandMargins ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={marginAll}
                      onChange={(e) => setMarginAll(parseInt(e.target.value, 10) || 0)}
                      className={cn(inputCls, 'w-20')}
                    />
                    <span className="text-[11px] text-geo-muted">all sides</span>
                    <button
                      onClick={() => setExpandMargins(true)}
                      className="text-[11px] text-geo-muted hover:text-foreground underline underline-offset-2"
                    >
                      Expand
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Top', val: marginTop, set: setMarginTop },
                      { label: 'Right', val: marginRight, set: setMarginRight },
                      { label: 'Bottom', val: marginBottom, set: setMarginBottom },
                      { label: 'Left', val: marginLeft, set: setMarginLeft },
                    ].map(({ label, val, set }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-[11px] text-geo-muted w-12">{label}</span>
                        <input
                          type="number"
                          min={0}
                          value={val}
                          onChange={(e) => set(parseInt(e.target.value, 10) || 0)}
                          className={cn(inputCls, 'w-20')}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => setExpandMargins(false)}
                      className="text-[11px] text-geo-muted hover:text-foreground underline underline-offset-2 text-left col-span-2"
                    >
                      Collapse
                    </button>
                  </div>
                )}
              </div>

              {/* Output */}
              <div>
                <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-2">Output</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-geo-muted w-20 flex-shrink-0">File name</span>
                    <input
                      type="text"
                      value={filename}
                      onChange={(e) => setFilename(e.target.value)}
                      className={cn(inputCls, 'flex-1 font-mono')}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-geo-muted w-20 flex-shrink-0">Directory</span>
                    <input
                      type="text"
                      readOnly
                      value={exportDir}
                      placeholder="Select a directory..."
                      className={cn(inputCls, 'flex-1 font-mono text-geo-muted cursor-default placeholder:text-geo-muted/50')}
                    />
                    <button
                      onClick={handleBrowse}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs border border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted rounded transition-colors flex-shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Browse
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-xs text-geo-error">{error}</p>
              )}

              {/* Export button */}
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleExport}
                  disabled={isExporting || !exportDir}
                  className="px-4 py-2 text-xs bg-geo-accent text-white rounded hover:bg-geo-accent/90
                    disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  {isExporting ? 'Exporting…' : 'Export'}
                </button>
              </div>

            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ExportWarningToast visible={showToast} onDismiss={() => setShowToast(false)} />
    </>
  )
}
