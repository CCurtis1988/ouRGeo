import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { HexColorPicker } from 'react-colorful'
import { X } from 'lucide-react'
import { useSpatialStore } from '@/store/spatial'
import type { NorthArrowSettings, NorthArrowStyle, OverlayPosition } from '@/store/spatial'
import { DEFAULT_NORTH_ARROW_SETTINGS } from '@/store/spatial'
import { cn } from '@/lib/utils'

interface NorthArrowSettingsDialogProps {
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

// ── Arrow SVG previews ─────────────────────────────────────────────

function ArrowPreview({
  style, primary, secondary,
}: { style: NorthArrowStyle; primary: string; secondary: string }) {
  switch (style) {
    case 'split':
      return (
        <svg viewBox="0 0 24 32" width="28" height="37">
          <polygon points="12,2 19,28 12,21" fill={primary} />
          <polygon points="12,2 5,28 12,21" fill={secondary} />
          <polygon points="12,2 19,28 12,21 5,28" fill="none"
            stroke={secondary} strokeWidth="0.75" strokeLinejoin="round" />
        </svg>
      )
    case 'simple':
      return (
        <svg viewBox="0 0 24 32" width="28" height="37">
          <polygon points="12,2 19,28 12,20 5,28" fill={secondary} />
        </svg>
      )
    case 'open':
      return (
        <svg viewBox="0 0 24 32" width="28" height="37">
          <polygon points="12,2 19,28 12,20 5,28" fill="none"
            stroke={secondary} strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="12" y1="2" x2="12" y2="20" stroke={secondary} strokeWidth="0.75" />
        </svg>
      )
    case 'dot':
      return (
        <svg viewBox="0 0 24 36" width="28" height="42">
          <polygon points="12,2 18,18 12,14 6,18" fill={secondary} />
          <circle cx="12" cy="24" r="4" fill="none" stroke={secondary} strokeWidth="1.5" />
          <circle cx="12" cy="24" r="1.5" fill={secondary} />
        </svg>
      )
    case 'compass':
      return (
        <svg viewBox="0 0 24 32" width="28" height="37">
          <polygon points="12,2 14,16 12,12 10,16" fill={primary} />
          <polygon points="12,30 14,16 12,20 10,16" fill={secondary} />
          <polygon points="22,15 14,13 16,15 14,17" fill={secondary} />
          <polygon points="2,15 10,13 8,15 10,17" fill={secondary} />
          <circle cx="12" cy="15" r="1.5" fill={secondary} />
        </svg>
      )
  }
}

const STYLE_OPTIONS: { value: NorthArrowStyle; label: string }[] = [
  { value: 'split', label: 'Split' },
  { value: 'simple', label: 'Solid' },
  { value: 'open', label: 'Open' },
  { value: 'dot', label: 'Dot' },
  { value: 'compass', label: 'Compass' },
]

// ── Main dialog ────────────────────────────────────────────────────

export function NorthArrowSettingsDialog({ open, onClose }: NorthArrowSettingsDialogProps) {
  const settings = useSpatialStore((s) => s.northArrowSettings)
  const setNorthArrowSettings = useSpatialStore((s) => s.setNorthArrowSettings)
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  const apply = (partial: Partial<NorthArrowSettings>) =>
    setNorthArrowSettings({ ...settings, ...partial })

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
              North Arrow Settings
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
            {/* ── Style ── */}
            <Section title="Style">
              <div className="flex gap-2 flex-wrap">
                {STYLE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => apply({ style: value })}
                    title={label}
                    className={cn(
                      'flex flex-col items-center gap-1 px-3 py-2 rounded border transition-colors',
                      settings.style === value
                        ? 'border-geo-accent bg-geo-accent/10'
                        : 'border-geo-border hover:bg-geo-bg'
                    )}
                  >
                    <ArrowPreview
                      style={value}
                      primary={settings.primaryColor}
                      secondary={settings.secondaryColor}
                    />
                    <span className={cn(
                      'text-[10px]',
                      settings.style === value ? 'text-geo-accent' : 'text-geo-muted'
                    )}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </Section>

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

            {/* ── Appearance ── */}
            <Section title="Appearance">
              <Slider label="Size" value={settings.size} min={14} max={64} unit="px"
                onChange={(v) => apply({ size: v })} />
              <ColorField id="primary" label="Primary color"
                value={settings.primaryColor} openPicker={openPicker}
                onSwatchClick={handleSwatchClick}
                onChange={(c) => apply({ primaryColor: c })} />
              <ColorField id="secondary" label="Secondary color"
                value={settings.secondaryColor} openPicker={openPicker}
                onSwatchClick={handleSwatchClick}
                onChange={(c) => apply({ secondaryColor: c })} />
              <Slider label="Opacity" value={Math.round(settings.opacity * 100)}
                min={0} max={100} unit="%" step={5}
                onChange={(v) => apply({ opacity: v / 100 })} />
            </Section>

            {/* ── Label ── */}
            <Section title="Label">
              <ToggleRow label='Show "N" label' checked={settings.showLabel}
                onChange={(v) => apply({ showLabel: v })} />
              {settings.showLabel && (
                <>
                  <ColorField id="label" label="Label color"
                    value={settings.labelColor} openPicker={openPicker}
                    onSwatchClick={handleSwatchClick}
                    onChange={(c) => apply({ labelColor: c })} />
                  <Slider label="Label size" value={settings.labelSize} min={6} max={16} unit="px"
                    onChange={(v) => apply({ labelSize: v })} />
                </>
              )}
            </Section>
          </div>

          {/* Footer */}
          <div className="flex justify-end px-4 py-3 border-t border-geo-border">
            <button
              onClick={() => setNorthArrowSettings(DEFAULT_NORTH_ARROW_SETTINGS)}
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
