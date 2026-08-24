import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { HexColorPicker } from 'react-colorful'
import { X } from 'lucide-react'
import { useSpatialStore } from '@/store/spatial'
import type { LegendSettings, OverlayPosition } from '@/store/spatial'
import { DEFAULT_LEGEND_SETTINGS } from '@/store/spatial'
import { cn } from '@/lib/utils'

interface LegendSettingsDialogProps {
  open: boolean
  onClose: () => void
}

// ── Position grid ──────────────────────────────────────────────────

const CORNERS: OverlayPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const CORNER_LABELS: Record<OverlayPosition, string> = {
  'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘',
}
const CORNER_TITLES: Record<OverlayPosition, string> = {
  'top-left': 'Top left', 'top-right': 'Top right',
  'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right',
}

function PositionGrid({
  value, onChange,
}: { value: OverlayPosition; onChange: (p: OverlayPosition) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 w-[84px]">
      {CORNERS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          title={CORNER_TITLES[c]}
          className={cn(
            'py-1.5 text-sm rounded border text-center transition-colors',
            value === c
              ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
              : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg'
          )}
        >
          {CORNER_LABELS[c]}
        </button>
      ))}
    </div>
  )
}

// ── Slider ─────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step = 1, unit = '', onChange,
}: {
  label: string; value: number; min: number; max: number
  step?: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-geo-muted w-32 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-geo-accent h-1"
      />
      <span className="text-xs text-foreground w-12 text-right tabular-nums flex-shrink-0">
        {value}{unit}
      </span>
    </div>
  )
}

// ── Color field ─────────────────────────────────────────────────────

function ColorField({
  id, label, value, openPicker, onSwatchClick, onChange,
}: {
  id: string; label: string; value: string
  openPicker: string | null
  onSwatchClick: (id: string) => void
  onChange: (c: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-geo-muted w-32 flex-shrink-0">{label}</span>
        <button
          className="w-6 h-6 rounded border border-geo-border flex-shrink-0 hover:ring-1 hover:ring-geo-accent"
          style={{ backgroundColor: value }}
          onClick={() => onSwatchClick(id)}
        />
        <input
          type="text"
          value={value}
          maxLength={7}
          onChange={(e) => {
            if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value)
          }}
          className="w-20 bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground font-mono outline-none focus:border-geo-accent"
        />
      </div>
      {openPicker === id && (
        <div className="ml-[calc(128px+8px)]">
          <HexColorPicker color={value} onChange={onChange} style={{ width: '100%', height: '120px' }} />
        </div>
      )}
    </div>
  )
}

// ── Toggle row ─────────────────────────────────────────────────────

function ToggleRow({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className="flex items-center gap-2 text-xs text-foreground"
      onClick={() => onChange(!checked)}
    >
      <div className={cn(
        'w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center',
        checked ? 'bg-geo-accent border-geo-accent' : 'border-geo-muted'
      )}>
        {checked && (
          <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none">
            <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {label}
    </button>
  )
}

// ── Section header ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-geo-muted">{title}</p>
      <div className="space-y-3 pl-1">{children}</div>
    </div>
  )
}

// ── Main dialog ────────────────────────────────────────────────────

export function LegendSettingsDialog({ open, onClose }: LegendSettingsDialogProps) {
  const settings = useSpatialStore((s) => s.legendSettings)
  const setLegendSettings = useSpatialStore((s) => s.setLegendSettings)
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  const apply = (partial: Partial<LegendSettings>) =>
    setLegendSettings({ ...settings, ...partial })

  const handleSwatchClick = (id: string) =>
    setOpenPicker((prev) => (prev === id ? null : id))

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
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
              Legend Settings
            </Dialog.Title>
            <Dialog.Close className="text-geo-muted hover:text-foreground">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div
            className="px-4 py-4 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Position ── */}
            <Section title="Position">
              <div className="flex items-start gap-6">
                <PositionGrid
                  value={settings.position}
                  onChange={(p) => apply({ position: p })}
                />
                <div className="flex-1 space-y-3 pt-1">
                  <Slider label="Offset X" value={settings.offsetX} min={0} max={120} unit="px"
                    onChange={(v) => apply({ offsetX: v })} />
                  <Slider label="Offset Y" value={settings.offsetY} min={0} max={120} unit="px"
                    onChange={(v) => apply({ offsetY: v })} />
                </div>
              </div>
            </Section>

            {/* ── Title ── */}
            <Section title="Title">
              <ToggleRow label="Show title" checked={settings.showTitle}
                onChange={(v) => apply({ showTitle: v })} />
              {settings.showTitle && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-geo-muted w-32 flex-shrink-0">Title text</span>
                    <input
                      type="text"
                      value={settings.title}
                      onChange={(e) => apply({ title: e.target.value })}
                      className="flex-1 bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-geo-accent"
                    />
                  </div>
                  <Slider label="Title font size" value={settings.titleSize} min={8} max={20} unit="px"
                    onChange={(v) => apply({ titleSize: v })} />
                </>
              )}
            </Section>

            {/* ── Appearance ── */}
            <Section title="Appearance">
              <ColorField id="bg" label="Background color"
                value={settings.bgColor} openPicker={openPicker}
                onSwatchClick={handleSwatchClick}
                onChange={(c) => apply({ bgColor: c })} />
              <Slider label="Background opacity" value={Math.round(settings.bgOpacity * 100)}
                min={0} max={100} unit="%" step={5}
                onChange={(v) => apply({ bgOpacity: v / 100 })} />
              <ToggleRow label="Show border" checked={settings.showBorder}
                onChange={(v) => apply({ showBorder: v })} />
              {settings.showBorder && (
                <>
                  <ColorField id="border" label="Border color"
                    value={settings.borderColor} openPicker={openPicker}
                    onSwatchClick={handleSwatchClick}
                    onChange={(c) => apply({ borderColor: c })} />
                  <Slider label="Border width" value={settings.borderWidth} min={0} max={4} unit="px"
                    onChange={(v) => apply({ borderWidth: v })} />
                </>
              )}
              <Slider label="Corner radius" value={settings.borderRadius} min={0} max={20} unit="px"
                onChange={(v) => apply({ borderRadius: v })} />
            </Section>

            {/* ── Content ── */}
            <Section title="Content">
              <Slider label="Item font size" value={settings.itemFontSize} min={8} max={16} unit="px"
                onChange={(v) => apply({ itemFontSize: v })} />
              <Slider label="Max categories" value={settings.maxCategories} min={4} max={20}
                onChange={(v) => apply({ maxCategories: v })} />
              <div className="flex items-center gap-3">
                <span className="text-xs text-geo-muted w-32 flex-shrink-0">Category columns</span>
                <div className="flex gap-1">
                  {([1, 2] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => apply({ catColumns: n })}
                      className={cn(
                        'w-8 py-1 text-xs rounded border transition-colors',
                        settings.catColumns === n
                          ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                          : 'border-geo-border text-geo-muted hover:text-foreground'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <Slider label="Max width" value={settings.maxWidth} min={140} max={400} step={10} unit="px"
                onChange={(v) => apply({ maxWidth: v })} />
              <Slider label="Max height" value={settings.maxHeight} min={100} max={600} step={10} unit="px"
                onChange={(v) => apply({ maxHeight: v })} />
            </Section>
          </div>

          {/* Footer */}
          <div className="flex justify-end px-4 py-3 border-t border-geo-border">
            <button
              onClick={() => setLegendSettings(DEFAULT_LEGEND_SETTINGS)}
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
