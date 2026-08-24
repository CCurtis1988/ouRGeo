import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import React, { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { HexColorPicker } from 'react-colorful'
import { X } from 'lucide-react'
import { useSpatialStore } from '@/store/spatial'
import type { LayerSymbology, PointShape, LineDash, ColorBinding } from '@/store/spatial'
import { getEffectiveSym, getLayerDataColumns } from '@/lib/layer-symbology'
import {
  SEQUENTIAL_SCALES,
  CATEGORICAL_PALETTES,
  ALL_SCALE_KEYS,
  ALL_PALETTE_KEYS,
} from '@/lib/color-scales'
import { cn } from '@/lib/utils'

interface SymbologyDialogProps {
  layerId: string | null
  onClose: () => void
}

type PickerKey = 'fill' | 'border' | 'halo'

const POINT_SHAPES: { shape: PointShape; label: string }[] = [
  { shape: 'circle',   label: '●' },
  { shape: 'square',   label: '■' },
  { shape: 'triangle', label: '▲' },
  { shape: 'cross',    label: '✚' },
  { shape: 'diamond',  label: '◆' },
]

const LINE_DASHES: { dash: LineDash; label: string; preview: string }[] = [
  { dash: 'solid',  label: 'Solid',  preview: '——————' },
  { dash: 'dashed', label: 'Dashed', preview: '- - - -' },
  { dash: 'dotted', label: 'Dotted', preview: '· · · ·' },
]

// ---------- Slider ----------

function Slider({
  label, value, min, max, step = 0.5, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-geo-muted w-28 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-geo-accent h-1"
      />
      <span className="text-xs text-foreground w-8 text-right tabular-nums">{value}</span>
    </div>
  )
}

// ---------- Fixed color picker row ----------

function ColorRow({
  label, color, pickerKey, openPicker,
  onSwatchClick, onColorChange, children,
}: {
  label: string; color: string; pickerKey: PickerKey; openPicker: PickerKey | null
  onSwatchClick: (k: PickerKey) => void
  onColorChange: (k: PickerKey, c: string) => void
  children?: React.ReactNode
}) {
  const isOpen = openPicker === pickerKey
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          className="w-6 h-6 rounded border border-geo-border flex-shrink-0 hover:ring-1 hover:ring-geo-accent"
          style={{ backgroundColor: color }}
          onClick={() => onSwatchClick(pickerKey)}
          title="Pick color"
        />
        <input
          type="text"
          value={color}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onColorChange(pickerKey, v)
          }}
          className="w-20 bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground font-mono outline-none focus:border-geo-accent"
        />
        {children}
      </div>
      {isOpen && (
        <HexColorPicker
          color={color}
          onChange={(c) => onColorChange(pickerKey, c)}
          style={{ width: '100%', height: '140px' }}
        />
      )}
    </div>
  )
}

// ---------- Scale swatch strip ----------

function ScaleSwatch({
  colors, selected, onClick,
}: {
  colors: string[]; selected: boolean; onClick: () => void
}): React.ReactElement {
  const gradient = `linear-gradient(to right, ${colors.join(', ')})`
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-5 rounded flex-shrink-0 border transition-all',
        selected
          ? 'border-geo-accent ring-1 ring-geo-accent'
          : 'border-geo-border hover:border-geo-muted'
      )}
      style={{ width: 36, background: gradient }}
      title={undefined}
    />
  )
}

function PaletteSwatch({
  colors, selected, onClick,
}: {
  colors: string[]; selected: boolean; onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex gap-px rounded border p-0.5 transition-all',
        selected
          ? 'border-geo-accent ring-1 ring-geo-accent'
          : 'border-geo-border hover:border-geo-muted'
      )}
      title={undefined}
    >
      {colors.slice(0, 5).map((c, i) => (
        <div key={i} className="w-2.5 h-4 rounded-sm" style={{ backgroundColor: c }} />
      ))}
    </button>
  )
}

// ---------- ColorSection ----------

function ColorSection({
  label, pickerKey, sym, openPicker,
  onSwatchClick, onColorChange, onBindingChange,
  columns, disabled, disabledReason,
}: {
  label: string
  pickerKey: PickerKey
  sym: LayerSymbology
  openPicker: PickerKey | null
  onSwatchClick: (k: PickerKey) => void
  onColorChange: (k: PickerKey, c: string) => void
  onBindingChange: (k: PickerKey, b: ColorBinding | undefined) => void
  columns: { name: string; type: 'numeric' | 'categorical' }[]
  disabled?: boolean
  disabledReason?: string
}): React.ReactElement {
  const binding = pickerKey === 'fill'
    ? sym.fillColorBinding
    : pickerKey === 'border'
      ? sym.borderColorBinding
      : sym.haloColorBinding

  const fixedColor = pickerKey === 'fill'
    ? sym.fillColor
    : pickerKey === 'border'
      ? sym.borderColor
      : sym.haloColor

  const isDataMode = !!binding && !disabled

  const handleModeSwitch = (toData: boolean) => {
    if (disabled) return
    if (!toData) {
      onBindingChange(pickerKey, undefined)
      return
    }
    // Pick first available column, default numeric scale
    const firstCol = columns[0]
    if (!firstCol) return
    const scaleKey = firstCol.type === 'numeric'
      ? ALL_SCALE_KEYS[0]
      : ALL_PALETTE_KEYS[0]
    onBindingChange(pickerKey, { column: firstCol.name, type: firstCol.type, scale: scaleKey })
  }

  const handleColumnChange = (colName: string) => {
    if (!binding) return
    const col = columns.find((c) => c.name === colName)
    if (!col) return
    const scaleKey = col.type === 'numeric' ? ALL_SCALE_KEYS[0] : ALL_PALETTE_KEYS[0]
    onBindingChange(pickerKey, { column: colName, type: col.type, scale: scaleKey })
  }

  const handleScaleChange = (scale: string) => {
    if (!binding) return
    onBindingChange(pickerKey, { ...binding, scale })
  }

  const scaleKeys = binding?.type === 'numeric' ? ALL_SCALE_KEYS : ALL_PALETTE_KEYS
  const colType = binding?.type ?? 'numeric'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-geo-muted">{label}</p>
        {disabled ? (
          <span className="text-[10px] text-geo-muted italic" title={disabledReason}>
            {disabledReason}
          </span>
        ) : columns.length > 0 ? (
          <div className="flex rounded border border-geo-border overflow-hidden">
            <button
              onClick={() => handleModeSwitch(false)}
              className={cn(
                'px-2 py-0.5 text-[10px] transition-colors',
                !isDataMode
                  ? 'bg-geo-accent text-white'
                  : 'text-geo-muted hover:text-foreground'
              )}
            >
              Fixed
            </button>
            <button
              onClick={() => handleModeSwitch(true)}
              className={cn(
                'px-2 py-0.5 text-[10px] transition-colors border-l border-geo-border',
                isDataMode
                  ? 'bg-geo-accent text-white'
                  : 'text-geo-muted hover:text-foreground'
              )}
            >
              By Column
            </button>
          </div>
        ) : null}
      </div>

      {!isDataMode ? (
        <ColorRow
          label={label}
          color={fixedColor}
          pickerKey={pickerKey}
          openPicker={openPicker}
          onSwatchClick={onSwatchClick}
          onColorChange={onColorChange}
        />
      ) : (
        <div className="space-y-2 pl-1">
          {/* Column picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-geo-muted w-14 flex-shrink-0">Column</span>
            <select
              value={binding?.column ?? ''}
              onChange={(e) => handleColumnChange(e.target.value)}
              className="flex-1 bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent"
            >
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.type === 'numeric' ? 'num' : 'cat'})
                </option>
              ))}
            </select>
          </div>

          {/* Scale/palette picker */}
          <div className="space-y-1">
            <span className="text-xs text-geo-muted">{colType === 'numeric' ? 'Scale' : 'Palette'}</span>
            <div className="flex flex-wrap gap-1.5">
              {scaleKeys.map((key) => {
                const colors = colType === 'numeric'
                  ? SEQUENTIAL_SCALES[key]
                  : CATEGORICAL_PALETTES[key]
                return colType === 'numeric' ? (
                  <div key={key} className="flex flex-col items-center gap-0.5" title={key}>
                    <ScaleSwatch
                      colors={colors}
                      selected={binding?.scale === key}
                      onClick={() => handleScaleChange(key)}
                    />
                    <span className="text-[8px] text-geo-muted">{key}</span>
                  </div>
                ) : (
                  <div key={key} className="flex flex-col items-center gap-0.5" title={key}>
                    <PaletteSwatch
                      colors={colors}
                      selected={binding?.scale === key}
                      onClick={() => handleScaleChange(key)}
                    />
                    <span className="text-[8px] text-geo-muted">{key}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Main dialog ----------

export function SymbologyDialog({ layerId, onClose }: SymbologyDialogProps): React.ReactElement {
  const layer = useSpatialStore((s) => s.layers.find((l) => l.id === layerId) ?? null)
  const updateLayerSymbology = useSpatialStore((s) => s.updateLayerSymbology)

  const [sym, setSym] = useState<LayerSymbology | null>(null)
  const [openPicker, setOpenPicker] = useState<PickerKey | null>(null)

  useEffect(() => {
    if (!layer) return
    setSym(getEffectiveSym(layer))
    setOpenPicker(null)
  }, [layerId])

  const apply = useCallback((next: LayerSymbology) => {
    setSym(next)
    if (layer) updateLayerSymbology(layer.id, next)
  }, [layer, updateLayerSymbology])

  const handleColorChange = (key: PickerKey, color: string) => {
    if (!sym) return
    if (key === 'fill')   apply({ ...sym, fillColor: color })
    if (key === 'border') apply({ ...sym, borderColor: color })
    if (key === 'halo')   apply({ ...sym, haloColor: color })
  }

  const handleSwatchClick = (key: PickerKey) => {
    setOpenPicker((prev) => (prev === key ? null : key))
  }

  const handleBindingChange = (key: PickerKey, binding: ColorBinding | undefined) => {
    if (!sym) return
    if (key === 'fill')   apply({ ...sym, fillColorBinding: binding })
    if (key === 'border') apply({ ...sym, borderColorBinding: binding })
    if (key === 'halo')   apply({ ...sym, haloColorBinding: binding })
  }

  const handleReset = () => {
    if (!layer) return
    const fresh = getEffectiveSym({ ...layer, symbology: undefined })
    updateLayerSymbology(layer.id, fresh)
    setSym(fresh)
  }

  if (!layer || !sym) return <></>

  const gt = layer.geometryType.toUpperCase()
  const isPoly = familyIsPolygon(gt)
  const isLine = familyIsLine(gt) && !isPoly
  const isPoint = !isPoly && !isLine
  const isCustomShape = isPoint && sym.pointShape !== 'circle'

  const columns = getLayerDataColumns(layer)
  const fillLabel = isLine ? 'Line Color' : 'Fill Color'

  return (
    <Dialog.Root open={!!layerId} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[400px] max-h-[85vh] overflow-y-auto
            bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
          onClick={() => setOpenPicker(null)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Symbology — {layer.name}
            </Dialog.Title>
            <Dialog.Close className="text-geo-muted hover:text-foreground">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div
            className="px-4 py-4 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Point-specific ── */}
            {isPoint && (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs text-geo-muted">Shape</p>
                  <div className="flex gap-1">
                    {POINT_SHAPES.map(({ shape, label }) => (
                      <button
                        key={shape}
                        onClick={() => apply({ ...sym, pointShape: shape })}
                        className={cn(
                          'flex-1 py-1.5 text-sm rounded border transition-colors',
                          sym.pointShape === shape
                            ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                            : 'border-geo-border text-geo-muted hover:text-foreground'
                        )}
                        title={shape}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <Slider
                  label="Size"
                  value={sym.pointSize}
                  min={1} max={20} step={0.5}
                  onChange={(v) => apply({ ...sym, pointSize: v })}
                />
              </>
            )}

            {/* ── Line-specific ── */}
            {isLine && (
              <>
                <Slider
                  label="Line Thickness"
                  value={sym.lineWidth}
                  min={0.5} max={20} step={0.5}
                  onChange={(v) => apply({ ...sym, lineWidth: v })}
                />
                <div className="space-y-1.5">
                  <p className="text-xs text-geo-muted">Line Type</p>
                  <div className="flex gap-1">
                    {LINE_DASHES.map(({ dash, label, preview }) => (
                      <button
                        key={dash}
                        onClick={() => apply({ ...sym, lineDash: dash })}
                        title={label}
                        className={cn(
                          'flex-1 py-1.5 text-xs rounded border transition-colors font-mono',
                          sym.lineDash === dash
                            ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                            : 'border-geo-border text-geo-muted hover:text-foreground'
                        )}
                      >
                        {preview}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── Fill / Line color ── */}
            <ColorSection
              label={fillLabel}
              pickerKey="fill"
              sym={sym}
              openPicker={openPicker}
              onSwatchClick={handleSwatchClick}
              onColorChange={handleColorChange}
              onBindingChange={handleBindingChange}
              columns={columns}
              disabled={isCustomShape}
              disabledReason={isCustomShape ? 'Fixed for custom shapes' : undefined}
            />

            {isPoly && (
              <div className="flex items-center gap-3 pl-1">
                <span className="text-xs text-geo-muted w-14 flex-shrink-0">Opacity</span>
                <input
                  type="range" min={0} max={1} step={0.05} value={sym.fillOpacity}
                  onChange={(e) => apply({ ...sym, fillOpacity: Number(e.target.value) })}
                  className="flex-1 accent-geo-accent h-1"
                />
                <span className="text-xs text-foreground w-8 text-right tabular-nums">
                  {Math.round(sym.fillOpacity * 100)}%
                </span>
              </div>
            )}

            {/* ── Border ── */}
            <div className="space-y-2">
              <ColorSection
                label="Border Color"
                pickerKey="border"
                sym={sym}
                openPicker={openPicker}
                onSwatchClick={handleSwatchClick}
                onColorChange={handleColorChange}
                onBindingChange={handleBindingChange}
                columns={columns}
                disabled={isCustomShape}
                disabledReason={isCustomShape ? 'Fixed for custom shapes' : undefined}
              />
              <Slider
                label="Border Thickness"
                value={sym.borderWidth}
                min={0} max={10} step={0.5}
                onChange={(v) => apply({ ...sym, borderWidth: v })}
              />
            </div>

            {/* ── Halo ── */}
            <div className="space-y-2">
              <ColorSection
                label="Halo Color"
                pickerKey="halo"
                sym={sym}
                openPicker={openPicker}
                onSwatchClick={handleSwatchClick}
                onColorChange={handleColorChange}
                onBindingChange={handleBindingChange}
                columns={columns}
                disabled={isCustomShape}
                disabledReason={isCustomShape ? 'Fixed for custom shapes' : undefined}
              />
              <Slider
                label="Halo Strength"
                value={sym.haloStrength}
                min={0} max={20} step={0.5}
                onChange={(v) => apply({ ...sym, haloStrength: v })}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end px-4 py-3 border-t border-geo-border">
            <button
              onClick={handleReset}
              className="text-xs text-geo-muted hover:text-foreground px-3 py-1.5 rounded border border-geo-border hover:bg-geo-bg"
            >
              Reset to defaults
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
