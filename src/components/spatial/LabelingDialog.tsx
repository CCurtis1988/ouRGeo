import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { HexColorPicker } from 'react-colorful'
import { X, ChevronDown } from 'lucide-react'
import { useSpatialStore } from '@/store/spatial'
import type { LabelSettings } from '@/store/spatial'
import { getLayerDataColumns } from '@/lib/layer-symbology'
import { DEFAULT_LABEL_SETTINGS } from '@/lib/label-utils'
import { cn } from '@/lib/utils'

interface LabelingDialogProps {
  layerId: string | null
  onClose: () => void
}

// ---------- Helpers ----------

type PickerKey = 'color' | 'halo'

type AnchorValue = LabelSettings['anchor']

const ANCHOR_GRID: { anchor: AnchorValue; title: string }[][] = [
  [
    { anchor: 'top-left',     title: 'Top Left' },
    { anchor: 'top',          title: 'Top' },
    { anchor: 'top-right',    title: 'Top Right' },
  ],
  [
    { anchor: 'left',         title: 'Left' },
    { anchor: 'center',       title: 'Center' },
    { anchor: 'right',        title: 'Right' },
  ],
  [
    { anchor: 'bottom-left',  title: 'Bottom Left' },
    { anchor: 'bottom',       title: 'Bottom' },
    { anchor: 'bottom-right', title: 'Bottom Right' },
  ],
]

/** Small SVG showing feature dot + label position for each anchor */
function AnchorIcon({ anchor }: { anchor: AnchorValue }): React.ReactElement {
  const dot = { cx: 6, cy: 6, r: 1.8 }
  const lbl = { w: 7, h: 2.5, rx: 0.5 }

  const placements: Record<AnchorValue, { x: number; y: number }> = {
    'top':          { x: 2.5,  y: 0.5 },
    'bottom':       { x: 2.5,  y: 9   },
    'left':         { x: 0,    y: 4.75 },
    'right':        { x: 5,    y: 4.75 },
    'center':       { x: 2.5,  y: 4.75 },
    'top-left':     { x: 0,    y: 0.5  },
    'top-right':    { x: 5,    y: 0.5  },
    'bottom-left':  { x: 0,    y: 9    },
    'bottom-right': { x: 5,    y: 9    },
  }

  const dotPositions: Record<AnchorValue, { cx: number; cy: number }> = {
    'top':          { cx: 6,   cy: 9   },
    'bottom':       { cx: 6,   cy: 3   },
    'left':         { cx: 10,  cy: 6   },
    'right':        { cx: 2,   cy: 6   },
    'center':       { cx: 6,   cy: 6   },
    'top-left':     { cx: 10,  cy: 9   },
    'top-right':    { cx: 2,   cy: 9   },
    'bottom-left':  { cx: 10,  cy: 3   },
    'bottom-right': { cx: 2,   cy: 3   },
  }

  const p = placements[anchor]
  const d = dotPositions[anchor]

  return (
    <svg viewBox="0 0 12 12" width={14} height={14} className="text-current">
      <rect x={p.x} y={p.y} width={lbl.w} height={lbl.h} rx={lbl.rx} fill="currentColor" opacity={0.75} />
      <circle cx={d.cx} cy={d.cy} r={dot.r} fill="currentColor" />
    </svg>
  )
}

// ---------- Sub-components ----------

function SectionHeader({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="text-[10px] font-semibold text-geo-muted uppercase tracking-wider mb-2.5">
      {children}
    </p>
  )
}

function LabelSlider({
  label, value, min, max, step = 1, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number
  unit?: string; onChange: (v: number) => void
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-geo-muted w-28 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-geo-accent h-1"
      />
      <span className="text-xs text-foreground w-10 text-right tabular-nums flex-shrink-0">
        {value}{unit ? <span className="text-geo-muted ml-0.5">{unit}</span> : null}
      </span>
    </div>
  )
}

function ColorRow({
  label, color, pickerKey, openPicker, onSwatchClick, onColorChange,
}: {
  label: string; color: string; pickerKey: PickerKey; openPicker: PickerKey | null
  onSwatchClick: (k: PickerKey) => void
  onColorChange: (k: PickerKey, c: string) => void
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-geo-muted w-28 flex-shrink-0">{label}</span>
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
      </div>
      {openPicker === pickerKey && (
        <HexColorPicker
          color={color}
          onChange={(c) => onColorChange(pickerKey, c)}
          style={{ width: '100%', height: '140px' }}
        />
      )}
    </div>
  )
}

// ---------- Main dialog ----------

export function LabelingDialog({ layerId, onClose }: LabelingDialogProps): React.ReactElement {
  const layer = useSpatialStore((s) => s.layers.find((l) => l.id === layerId) ?? null)
  const updateLabelSettings = useSpatialStore((s) => s.updateLabelSettings)

  const [ls, setLs] = useState<LabelSettings | null>(null)
  const [openPicker, setOpenPicker] = useState<PickerKey | null>(null)
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false)
  const fieldInputRef = useRef<HTMLInputElement>(null)
  const cursorRef = useRef<number>(0)

  useEffect(() => {
    if (!layer) return
    setLs(layer.labelSettings ? { ...layer.labelSettings } : { ...DEFAULT_LABEL_SETTINGS })
    setOpenPicker(null)
    setFieldMenuOpen(false)
  }, [layerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback((next: LabelSettings) => {
    setLs(next)
    if (layer) updateLabelSettings(layer.id, next)
  }, [layer, updateLabelSettings])

  const handleColorChange = (key: PickerKey, color: string) => {
    if (!ls) return
    if (key === 'color') apply({ ...ls, color })
    if (key === 'halo')  apply({ ...ls, haloColor: color })
  }

  const handleSwatchClick = (key: PickerKey) => {
    setOpenPicker((prev) => (prev === key ? null : key))
  }

  const insertField = (columnName: string) => {
    if (!ls) return
    const pos = cursorRef.current ?? ls.field.length
    const newVal = ls.field.slice(0, pos) + `{${columnName}}` + ls.field.slice(pos)
    apply({ ...ls, field: newVal })
    setFieldMenuOpen(false)
    requestAnimationFrame(() => {
      if (!fieldInputRef.current) return
      fieldInputRef.current.focus()
      const newCursor = pos + columnName.length + 2
      fieldInputRef.current.setSelectionRange(newCursor, newCursor)
      cursorRef.current = newCursor
    })
  }

  const handleReset = () => {
    if (!layer || !ls) return
    const fresh = { ...DEFAULT_LABEL_SETTINGS, enabled: ls.enabled }
    apply(fresh)
  }

  if (!layer || !ls) return <></>

  const gt = layer.geometryType.toUpperCase()
  const isLine = familyIsLine(gt) && !familyIsPolygon(gt)
  const columns = getLayerDataColumns(layer)

  return (
    <Dialog.Root open={!!layerId} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[420px] max-h-[88vh] overflow-y-auto
            bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none"
          onClick={() => { setOpenPicker(null); setFieldMenuOpen(false) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border sticky top-0 bg-geo-panel z-10">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Labels — {layer.name}
            </Dialog.Title>
            <Dialog.Close className="text-geo-muted hover:text-foreground">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* ── Enable toggle ── */}
          <div
            className="flex items-center justify-between px-5 py-3.5 border-b border-geo-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-sm font-medium text-foreground">Feature Labels</p>
              <p className="text-xs text-geo-muted mt-0.5">
                {ls.enabled ? 'Labeling is enabled' : 'Toggle on to configure and display labels'}
              </p>
            </div>
            <button
              onClick={() => apply({ ...ls, enabled: !ls.enabled })}
              className={cn(
                'relative inline-flex h-5 w-9 rounded-full transition-colors flex-shrink-0',
                ls.enabled ? 'bg-geo-accent' : 'bg-geo-border'
              )}
              title={ls.enabled ? 'Disable labels' : 'Enable labels'}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform mt-[3px]',
                  ls.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                )}
              />
            </button>
          </div>

          {/* ── Settings (only when enabled) ── */}
          {ls.enabled && (
            <div
              className="px-5 py-4 space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Label Content ── */}
              <div>
                <SectionHeader>Label Content</SectionHeader>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      ref={fieldInputRef}
                      type="text"
                      value={ls.field}
                      placeholder="e.g. {NAME} or City: {NAME}"
                      onSelect={(e) => {
                        cursorRef.current = (e.target as HTMLInputElement).selectionStart ?? ls.field.length
                      }}
                      onChange={(e) => {
                        cursorRef.current = e.target.selectionStart ?? e.target.value.length
                        apply({ ...ls, field: e.target.value })
                      }}
                      className="flex-1 bg-geo-bg border border-geo-border rounded px-2.5 py-1.5 text-xs text-foreground font-mono outline-none focus:border-geo-accent placeholder:text-geo-muted/50"
                    />
                    {columns.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            cursorRef.current = fieldInputRef.current?.selectionStart ?? ls.field.length
                            setFieldMenuOpen((v) => !v)
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-geo-bg border border-geo-border rounded hover:border-geo-accent text-foreground whitespace-nowrap"
                        >
                          + Field <ChevronDown className="w-3 h-3 text-geo-muted" />
                        </button>
                        {fieldMenuOpen && (
                          <div className="absolute right-0 top-full mt-1 w-44 bg-geo-panel border border-geo-border rounded shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
                            {columns.map((col) => (
                              <button
                                key={col.name}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  insertField(col.name)
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-geo-bg flex items-center justify-between gap-2"
                              >
                                <span className="font-mono truncate">{col.name}</span>
                                <span className="text-[10px] text-geo-muted flex-shrink-0">{col.type}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-geo-muted">
                    Use <span className="font-mono bg-geo-bg px-1 rounded">{'{FIELD}'}</span> to insert feature attribute values
                  </p>
                </div>
              </div>

              {/* ── Typography ── */}
              <div>
                <SectionHeader>Typography</SectionHeader>
                <div className="space-y-3">
                  {/* Font family + bold/italic */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-28 flex-shrink-0">Font</span>
                    <select
                      value={ls.fontFamily}
                      onChange={(e) => apply({ ...ls, fontFamily: e.target.value as LabelSettings['fontFamily'] })}
                      className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-geo-accent"
                    >
                      <option value="Open Sans">Open Sans</option>
                      <option value="Noto Sans">Noto Sans</option>
                      <option value="Arial Unicode MS">Arial Unicode MS</option>
                    </select>
                    <button
                      onClick={() => apply({ ...ls, bold: !ls.bold })}
                      className={cn(
                        'w-7 h-7 rounded border text-xs font-bold transition-colors',
                        ls.bold
                          ? 'bg-geo-accent/20 border-geo-accent text-geo-accent'
                          : 'bg-geo-bg border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'
                      )}
                      title="Bold"
                    >
                      B
                    </button>
                    <button
                      onClick={() => apply({ ...ls, italic: !ls.italic })}
                      className={cn(
                        'w-7 h-7 rounded border text-xs italic transition-colors',
                        ls.italic
                          ? 'bg-geo-accent/20 border-geo-accent text-geo-accent'
                          : 'bg-geo-bg border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'
                      )}
                      title="Italic"
                    >
                      I
                    </button>
                  </div>
                  <LabelSlider
                    label="Font size"
                    value={ls.fontSize}
                    min={8} max={32} step={1}
                    unit="px"
                    onChange={(v) => apply({ ...ls, fontSize: v })}
                  />
                  <ColorRow
                    label="Text color"
                    color={ls.color}
                    pickerKey="color"
                    openPicker={openPicker}
                    onSwatchClick={handleSwatchClick}
                    onColorChange={handleColorChange}
                  />
                </div>
              </div>

              {/* ── Outline / Halo ── */}
              <div>
                <SectionHeader>Outline</SectionHeader>
                <div className="space-y-3">
                  <ColorRow
                    label="Halo color"
                    color={ls.haloColor}
                    pickerKey="halo"
                    openPicker={openPicker}
                    onSwatchClick={handleSwatchClick}
                    onColorChange={handleColorChange}
                  />
                  <LabelSlider
                    label="Halo width"
                    value={ls.haloWidth}
                    min={0} max={4} step={0.25}
                    unit="px"
                    onChange={(v) => apply({ ...ls, haloWidth: v })}
                  />
                  <LabelSlider
                    label="Halo blur"
                    value={ls.haloBlur}
                    min={0} max={2} step={0.1}
                    unit="px"
                    onChange={(v) => apply({ ...ls, haloBlur: v })}
                  />
                </div>
              </div>

              {/* ── Placement ── */}
              <div>
                <SectionHeader>Placement</SectionHeader>
                {isLine ? (
                  <div className="space-y-3">
                    <p className="text-xs text-geo-muted mb-1">
                      Labels flow along the line geometry.
                    </p>
                    <LabelSlider
                      label="Label spacing"
                      value={ls.symbolSpacing}
                      min={50} max={500} step={10}
                      unit="px"
                      onChange={(v) => apply({ ...ls, symbolSpacing: v })}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Anchor grid */}
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-geo-muted w-28 flex-shrink-0 mt-1.5">Anchor</span>
                      <div className="grid grid-cols-3 gap-1">
                        {ANCHOR_GRID.flat().map(({ anchor, title }) => (
                          <button
                            key={anchor}
                            title={title}
                            onClick={() => apply({ ...ls, anchor })}
                            className={cn(
                              'w-9 h-9 rounded border flex items-center justify-center transition-colors',
                              ls.anchor === anchor
                                ? 'bg-geo-accent/15 border-geo-accent text-geo-accent'
                                : 'bg-geo-bg border-geo-border text-geo-muted hover:border-geo-muted hover:text-foreground'
                            )}
                          >
                            <AnchorIcon anchor={anchor} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <LabelSlider
                      label="Offset X"
                      value={ls.offsetX}
                      min={-3} max={3} step={0.1}
                      unit="em"
                      onChange={(v) => apply({ ...ls, offsetX: v })}
                    />
                    <LabelSlider
                      label="Offset Y"
                      value={ls.offsetY}
                      min={-3} max={3} step={0.1}
                      unit="em"
                      onChange={(v) => apply({ ...ls, offsetY: v })}
                    />
                  </div>
                )}
              </div>

              {/* ── Conflict Resolution ── */}
              <div>
                <SectionHeader>Conflict Resolution</SectionHeader>
                <div className="space-y-1.5">
                  {([
                    {
                      value: 'never' as const,
                      label: 'Never Overlap',
                      desc: 'Labels are hidden when they conflict. Cleanest result for dense data.',
                    },
                    {
                      value: 'cooperative' as const,
                      label: 'Cooperative',
                      desc: 'Labels avoid each other cooperatively. Recommended for most use cases.',
                    },
                    {
                      value: 'always' as const,
                      label: 'Always Show',
                      desc: 'All labels are rendered regardless of overlap.',
                    },
                  ] as const).map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => apply({ ...ls, overlapStrategy: value })}
                      className={cn(
                        'w-full text-left px-3 py-2.5 rounded border transition-colors',
                        ls.overlapStrategy === value
                          ? 'border-geo-accent/50 bg-geo-accent/5'
                          : 'border-geo-border hover:border-geo-muted bg-geo-bg'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full flex-shrink-0',
                            ls.overlapStrategy === value ? 'bg-geo-accent' : 'bg-geo-border'
                          )}
                        />
                        <span className={cn(
                          'text-xs font-medium',
                          ls.overlapStrategy === value ? 'text-foreground' : 'text-geo-muted'
                        )}>
                          {label}
                        </span>
                      </div>
                      <p className="text-[10px] text-geo-muted mt-0.5 ml-4">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Text Style ── */}
              <div>
                <SectionHeader>Text Style</SectionHeader>
                <div className="space-y-3">
                  {/* Transform */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-28 flex-shrink-0">Transform</span>
                    <div className="flex gap-1">
                      {([
                        { value: 'none' as const,      label: 'Aa' },
                        { value: 'uppercase' as const,  label: 'AA' },
                        { value: 'lowercase' as const,  label: 'aa' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          onClick={() => apply({ ...ls, textTransform: value })}
                          className={cn(
                            'px-2.5 py-1 text-xs rounded border transition-colors',
                            ls.textTransform === value
                              ? 'bg-geo-accent/20 border-geo-accent text-geo-accent'
                              : 'bg-geo-bg border-geo-border text-geo-muted hover:text-foreground hover:border-geo-muted'
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <LabelSlider
                    label="Opacity"
                    value={ls.opacity}
                    min={0} max={1} step={0.05}
                    onChange={(v) => apply({ ...ls, opacity: v })}
                  />
                  <LabelSlider
                    label="Letter spacing"
                    value={ls.letterSpacing}
                    min={0} max={0.5} step={0.02}
                    unit="em"
                    onChange={(v) => apply({ ...ls, letterSpacing: v })}
                  />
                  <LabelSlider
                    label="Max width"
                    value={ls.maxWidth}
                    min={5} max={30} step={1}
                    unit="ch"
                    onChange={(v) => apply({ ...ls, maxWidth: v })}
                  />
                </div>
              </div>

              {/* ── Visibility ── */}
              <div>
                <SectionHeader>Visibility</SectionHeader>
                <LabelSlider
                  label="Min zoom"
                  value={ls.minZoom}
                  min={0} max={22} step={1}
                  onChange={(v) => apply({ ...ls, minZoom: v })}
                />
                <p className="text-[10px] text-geo-muted mt-1.5 ml-[calc(theme(spacing.28)+theme(spacing.3))]">
                  Labels appear at zoom {ls.minZoom} and above
                </p>
              </div>
            </div>
          )}

          {/* ── Footer ── */}
          <div className="px-5 py-3 border-t border-geo-border flex justify-between items-center">
            {ls.enabled ? (
              <button
                onClick={handleReset}
                className="text-xs text-geo-muted hover:text-foreground transition-colors"
              >
                Reset to defaults
              </button>
            ) : (
              <span />
            )}
            <Dialog.Close className="text-xs text-geo-muted hover:text-foreground transition-colors">
              Done
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
