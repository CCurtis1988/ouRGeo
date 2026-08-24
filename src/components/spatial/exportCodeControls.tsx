// ── Export dialog: shared form controls ──────────────────────────────────────
import React, { useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  TextAlign, FontFace, MapPosition, SideJustification, GgplotCornerPos,
} from '@/lib/map-annotations'
import { FONT_FACES, ALIGNS } from './exportCodeHelpers'

export function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="flex items-center gap-2 text-xs text-foreground" onClick={() => onChange(!checked)} type="button">
      <div className={cn('w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center',
        checked ? 'bg-geo-accent border-geo-accent' : 'border-geo-muted bg-transparent')}>
        {checked && (
          <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none">
            <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {label}
    </button>
  )
}

export function ColorField({ id, label, value, openPicker, onSwatchClick, onChange }: {
  id: string; label: string; value: string
  openPicker: string | null; onSwatchClick: (id: string) => void; onChange: (c: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-geo-muted w-16 flex-shrink-0">{label}</span>
        <button
          className="w-5 h-5 rounded border border-geo-border flex-shrink-0 hover:ring-1 hover:ring-geo-accent"
          style={{ backgroundColor: value }}
          onClick={() => onSwatchClick(id)}
          type="button"
        />
        <input
          type="text" value={value} maxLength={7}
          onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value) }}
          className="w-20 bg-geo-bg border border-geo-border rounded px-1.5 py-0.5 text-xs text-foreground font-mono outline-none focus:border-geo-accent"
        />
      </div>
      {openPicker === id && (
        <div className="ml-[calc(64px+8px)]">
          <HexColorPicker color={value} onChange={onChange} style={{ width: '100%', height: '100px' }} />
        </div>
      )}
    </div>
  )
}

export function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      type="button"
      className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-semibold
        tracking-widest text-geo-muted uppercase border-b border-geo-border hover:bg-geo-bg/50 flex-shrink-0"
    >
      <span>{label}</span>
      {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
    </button>
  )
}

export function FontFaceGroup({ value, onChange }: { value: FontFace; onChange: (v: FontFace) => void }) {
  return (
    <div className="flex gap-1">
      {FONT_FACES.map((f) => (
        <button key={f.value} type="button" onClick={() => onChange(f.value)}
          className={cn('px-2 py-0.5 text-[10px] rounded border transition-colors',
            value === f.value
              ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
              : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
          {f.label}
        </button>
      ))}
    </div>
  )
}

export function AlignGroup({ value, onChange }: { value: TextAlign; onChange: (v: TextAlign) => void }) {
  return (
    <div className="flex gap-1">
      {ALIGNS.map((a) => (
        <button key={a.value} type="button" onClick={() => onChange(a.value)}
          className={cn('w-7 py-0.5 text-xs rounded border transition-colors',
            value === a.value
              ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
              : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
          {a.label}
        </button>
      ))}
    </div>
  )
}

export function LabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-geo-muted w-16 flex-shrink-0">{label}</span>
      {children}
    </div>
  )
}

export function MarginControl({ label, top, right, bottom, left, onChange }: {
  label: string
  top: number; right: number; bottom: number; left: number
  onChange: (t: number, r: number, b: number, l: number) => void
}) {
  const [linked, setLinked] = useState(true)

  const set = (t: number, r: number, b: number, l: number) => onChange(t, r, b, l)
  const setAll = (v: number) => set(v, v, v, v)
  const clamp = (v: number) => Math.max(0, Math.min(30, isNaN(v) ? 0 : v))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-geo-muted">{label}</span>
        <button type="button"
          onClick={() => { setLinked(!linked); if (!linked) setAll(top) }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg transition-colors">
          {linked ? 'Uniform' : 'Sides'}
        </button>
      </div>
      {linked ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-geo-muted w-16 flex-shrink-0">All sides</span>
          <input type="number" min={0} max={30} step={1} value={top}
            onChange={(e) => setAll(clamp(parseInt(e.target.value)))}
            className="w-14 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
          <span className="text-xs text-geo-muted">%</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {([
            ['Top',    top,    (v: number) => set(v, right, bottom, left)],
            ['Right',  right,  (v: number) => set(top, v, bottom, left)],
            ['Bottom', bottom, (v: number) => set(top, right, v, left)],
            ['Left',   left,   (v: number) => set(top, right, bottom, v)],
          ] as [string, number, (v: number) => void][]).map(([lbl, val, setter]) => (
            <div key={lbl} className="flex items-center gap-1">
              <span className="text-xs text-geo-muted w-10 flex-shrink-0">{lbl}</span>
              <input type="number" min={0} max={30} step={1} value={val}
                onChange={(e) => setter(clamp(parseInt(e.target.value)))}
                className="w-12 px-1.5 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
              <span className="text-xs text-geo-muted">%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PositionControl({ value, onChange }: {
  value: MapPosition
  onChange: (v: MapPosition) => void
}) {
  const positions: ([MapPosition, string] | null)[] = [
    ['top-left', '↖'], ['top', '↑'],    ['top-right', '↗'],
    ['left', '←'],     null,             ['right', '→'],
    ['bottom-left', '↙'], ['bottom', '↓'], ['bottom-right', '↘'],
  ]
  return (
    <LabelRow label="Position">
      <div className="grid grid-cols-3 gap-1">
        {positions.map((item, i) =>
          item === null
            ? <div key={i} className="w-8 h-6" />
            : <button key={item[0]} type="button" onClick={() => onChange(item[0])}
                className={cn('w-8 h-6 text-sm rounded border transition-colors',
                  value === item[0]
                    ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                    : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                {item[1]}
              </button>
        )}
      </div>
    </LabelRow>
  )
}

export function InsideOutsideRow({ value, onChange }: {
  value: boolean
  onChange: (inside: boolean) => void
}) {
  return (
    <LabelRow label="Frame">
      <div className="flex gap-1">
        {([true, false] as const).map((inside) => (
          <button key={String(inside)} type="button" onClick={() => onChange(inside)}
            className={cn('px-2 py-0.5 text-[10px] rounded border transition-colors',
              value === inside
                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
            {inside ? 'Inside' : 'Outside'}
          </button>
        ))}
      </div>
    </LabelRow>
  )
}

export function JustificationControl({ position, value, onChange }: {
  position: MapPosition
  value: SideJustification
  onChange: (v: SideJustification) => void
}) {
  const isHoriz = position === 'top' || position === 'bottom'
  const isVert  = position === 'left' || position === 'right'
  if (!isHoriz && !isVert) return null

  const options: [SideJustification, string][] = isHoriz
    ? [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]
    : [['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']]

  return (
    <LabelRow label="Justify">
      <div className="flex gap-1">
        {options.map(([v, label]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            className={cn('px-2 py-0.5 text-[10px] rounded border transition-colors',
              value === v
                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
            {label}
          </button>
        ))}
      </div>
    </LabelRow>
  )
}

export function CornerPositionControl({ value, onChange }: {
  value: GgplotCornerPos
  onChange: (v: GgplotCornerPos) => void
}) {
  const corners: [GgplotCornerPos, string][] = [
    ['top-left', '↖'], ['top-right', '↗'],
    ['bottom-left', '↙'], ['bottom-right', '↘'],
  ]
  return (
    <LabelRow label="Position">
      <div className="grid grid-cols-2 gap-1">
        {corners.map(([pos, glyph]) => (
          <button key={pos} type="button" onClick={() => onChange(pos)}
            className={cn('w-8 h-6 text-sm rounded border transition-colors',
              value === pos
                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
            {glyph}
          </button>
        ))}
      </div>
    </LabelRow>
  )
}

export function NumericField({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number
  step?: number; unit?: string; onChange: (v: number) => void
}) {
  return (
    <LabelRow label={label}>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || min)))}
        className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
      {unit && <span className="text-xs text-geo-muted">{unit}</span>}
    </LabelRow>
  )
}

export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="flex items-center gap-2 text-xs text-foreground" onClick={() => onChange(!checked)} type="button">
      <div className={cn('w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center',
        checked ? 'bg-geo-accent border-geo-accent' : 'border-geo-muted bg-transparent')}>
        {checked && (
          <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none">
            <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {label}
    </button>
  )
}
