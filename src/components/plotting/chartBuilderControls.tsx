// ── Chart Builder: presentational components ─────────────────────────────────
import React, { useState } from 'react'
import { X, Star, ChevronDown, ChevronRight, Eye, EyeOff, Trash2, AlertTriangle } from 'lucide-react'
import type { ColumnInfo } from '@/lib/r-client'
import {
  getVarType, TYPE_BADGE, GEOMS, GEOM_LABELS, AES_LABELS, AES_HINT, isCompatible,
  THEME_PACKAGES, DARK_PANEL_THEMES,
  type VarType, type AesMap, type CustomizeState, type LabelsState, type ThemeState,
  type GeomLayer, type AesKey, type GeomState,
} from './chartBuilderModel'

// ── Geom SVG icons ─────────────────────────────────────────────────────────────

export function GeomIcon({ geom, small }: { geom: string; small?: boolean }): React.ReactElement {
  const cls = small ? 'w-5 h-[14px]' : 'w-8 h-[22px]'
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const fa = { fill: 'currentColor', opacity: 0.7 }

  if (geom === 'point') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <circle cx="6" cy="16" r="2" {...fa} />
      <circle cx="13" cy="9" r="2" {...fa} />
      <circle cx="20" cy="13" r="2" {...fa} />
      <circle cx="26" cy="5" r="2" {...fa} />
      <circle cx="10" cy="17" r="2" {...fa} />
    </svg>
  )
  if (geom === 'line') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <polyline points="3,18 10,13 17,8 24,11 29,4" {...s} />
    </svg>
  )
  if (geom === 'bar') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <rect x="3" y="10" width="6" height="10" {...fa} />
      <rect x="13" y="4" width="6" height="16" {...fa} />
      <rect x="23" y="7" width="6" height="13" {...fa} />
    </svg>
  )
  if (geom === 'col') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <rect x="3" y="8" width="5" height="12" {...fa} />
      <rect x="10" y="3" width="5" height="17" {...fa} />
      <rect x="17" y="6" width="5" height="14" {...fa} />
      <rect x="24" y="11" width="5" height="9" {...fa} />
    </svg>
  )
  if (geom === 'histogram') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <rect x="2" y="14" width="5" height="6" {...fa} />
      <rect x="8" y="8" width="5" height="12" {...fa} />
      <rect x="14" y="4" width="5" height="16" {...fa} />
      <rect x="20" y="9" width="5" height="11" {...fa} />
      <rect x="26" y="13" width="5" height="7" {...fa} />
    </svg>
  )
  if (geom === 'boxplot') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <line x1="16" y1="2" x2="16" y2="6" {...s} />
      <rect x="8" y="6" width="16" height="10" {...s} />
      <line x1="8" y1="11" x2="24" y2="11" {...s} />
      <line x1="16" y1="16" x2="16" y2="20" {...s} />
      <line x1="10" y1="2" x2="22" y2="2" {...s} />
      <line x1="10" y1="20" x2="22" y2="20" {...s} />
    </svg>
  )
  if (geom === 'density') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <path d="M2,19 C6,19 8,4 16,4 C24,4 26,19 30,19" fill="currentColor" opacity="0.3" />
      <path d="M2,19 C6,19 8,4 16,4 C24,4 26,19 30,19" {...s} />
    </svg>
  )
  if (geom === 'violin') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <path d="M16,2 C20,2 22,8 22,11 C22,14 20,20 16,20 C12,20 10,14 10,11 C10,8 12,2 16,2 Z" {...s} fill="currentColor" opacity="0.25" />
    </svg>
  )
  if (geom === 'area') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <path d="M2,19 L8,13 L14,8 L20,11 L28,5 L28,19 Z" fill="currentColor" opacity="0.35" />
      <path d="M2,19 L8,13 L14,8 L20,11 L28,5" {...s} />
    </svg>
  )
  if (geom === 'smooth') return (
    <svg viewBox="0 0 32 22" className={cls}>
      <path d="M2,17 C8,17 10,5 16,5 C22,5 24,14 30,14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M2,19 C8,19 10,8 16,8 C22,8 24,17 30,17 L30,11 C24,11 22,2 16,2 C10,2 8,14 2,14 Z" fill="currentColor" opacity="0.2" />
    </svg>
  )
  return <svg viewBox="0 0 32 22" className={cls} />
}

export function AestheticSlot({
  aesKey, value, draggingType, onAssign, columns,
}: {
  aesKey: AesKey
  value: string
  draggingType: VarType | null
  onAssign: (key: AesKey, col: string) => void
  columns: ColumnInfo[]
}) {
  const [dragOver, setDragOver] = useState(false)
  const col = columns.find(c => c.name === value)
  const vt = col ? getVarType(col.type) : null

  const compatible = draggingType ? isCompatible(aesKey, draggingType) : true
  const showReject = dragOver && !compatible

  return (
    <div className="flex items-center gap-2 min-h-[30px]">
      <span className="text-[10px] text-[#8b949e] w-16 flex-shrink-0 text-right">{AES_LABELS[aesKey]}</span>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false)
          const colName = e.dataTransfer.getData('text/plain')
          const dropped = columns.find(c => c.name === colName)
          if (!dropped || !isCompatible(aesKey, getVarType(dropped.type))) return
          onAssign(aesKey, colName)
        }}
        title={`Accepts: ${AES_HINT[aesKey]}`}
        className={`flex-1 rounded border border-dashed min-h-[28px] flex items-center px-2 transition-colors ${
          showReject
            ? 'border-[#f85149] bg-[#f85149]/10'
            : dragOver
              ? 'border-[#4493f8] bg-[#4493f8]/10'
              : value
                ? 'border-[#21262d] bg-[#0f1117]'
                : 'border-[#21262d] hover:border-[#4493f8]/40'
        }`}
      >
        {value ? (
          <div className="flex items-center gap-1.5 flex-1 overflow-hidden">
            {vt && <span className={`text-[9px] px-1 py-0.5 rounded font-mono font-medium flex-shrink-0 ${TYPE_BADGE[vt]}`}>{vt}</span>}
            <span className="text-xs text-white truncate">{value}</span>
            <button
              className="ml-auto flex-shrink-0 text-[#8b949e] hover:text-[#f85149]"
              onMouseDown={e => { e.preventDefault(); onAssign(aesKey, '') }}
              title="Clear"
            ><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <span className={`text-[10px] ${showReject ? 'text-[#f85149]/80' : 'text-[#8b949e]/50'}`}>
            {showReject ? `Needs ${AES_HINT[aesKey]}` : 'drop variable here'}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Variable chip (draggable) ──────────────────────────────────────────────────

export function VarChip({ col, onClick, onDragStart, onDragEnd }: {
  col: ColumnInfo; onClick: () => void
  onDragStart?: (vt: VarType) => void; onDragEnd?: () => void
}) {
  const vt = getVarType(col.type)
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', col.name); e.dataTransfer.effectAllowed = 'copy'; onDragStart?.(vt) }}
      onDragEnd={() => onDragEnd?.()}
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0f1117] border border-[#21262d] hover:border-[#4493f8]/60 cursor-grab active:cursor-grabbing select-none text-xs text-[#e6edf3] hover:text-white transition-colors"
      title={`${col.name} (${col.type})`}
    >
      <span className={`text-[9px] px-1 py-0.5 rounded font-mono font-medium flex-shrink-0 ${TYPE_BADGE[vt]}`}>{vt}</span>
      <span className="truncate max-w-[130px]">{col.name}</span>
    </div>
  )
}

// ── Geom button ────────────────────────────────────────────────────────────────

export function GeomButton({
  geom, selected, state: avail, onClick,
}: { geom: string; selected: boolean; state: GeomState; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={GEOM_LABELS[geom]}
      className={`relative flex flex-col items-center gap-1 p-2 rounded border transition-all ${
        selected
          ? 'border-[#4493f8] bg-[#4493f8]/15 text-[#4493f8]'
          : avail === 'dim'
            ? 'border-[#21262d] text-[#8b949e]/40 hover:text-[#8b949e] hover:border-[#21262d]'
            : 'border-[#21262d] text-[#8b949e] hover:border-[#4493f8]/50 hover:text-white'
      }`}
    >
      {avail === 'recommended' && !selected && (
        <Star className="absolute top-0.5 right-0.5 w-2.5 h-2.5 text-[#f0c040] fill-[#f0c040]" />
      )}
      <GeomIcon geom={geom} />
      <span className="text-[9px] leading-none font-medium">{GEOM_LABELS[geom]}</span>
    </button>
  )
}

// ── Shared form primitives ─────────────────────────────────────────────────────

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-[#8b949e] w-28 flex-shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1.5 text-xs text-white placeholder-[#8b949e] focus:outline-none focus:border-[#4493f8]"
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    />
  )
}

export function RangeRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 accent-[#4493f8] cursor-pointer" />
        <span className="text-xs text-[#e6edf3] w-8 text-right tabular-nums">{value}</span>
      </div>
    </Row>
  )
}

export function ButtonGroup<T extends string | number>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(o => (
        <button key={String(o.value)} onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs rounded border transition-colors ${
            value === o.value
              ? 'border-[#4493f8] bg-[#4493f8]/15 text-[#4493f8]'
              : 'border-[#21262d] text-[#8b949e] hover:text-white hover:border-[#4493f8]/40'
          }`}>{o.label}</button>
      ))}
    </div>
  )
}

export function SmallSelect<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)}
      className="w-full bg-[#0f1117] border border-[#21262d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#4493f8] cursor-pointer">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function SectionHead({ title }: { title: string }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mt-4 mb-2 first:mt-0">{title}</div>
}

// ── Customize panel (per-layer) ────────────────────────────────────────────────

export function CustomizePanel({
  geom, aes, customize, onChange,
}: {
  geom: string
  aes: AesMap
  customize: CustomizeState
  onChange: (c: Partial<CustomizeState>) => void
}) {
  const c = customize
  const showPos = ['bar', 'col', 'histogram'].includes(geom)
  const showPointOpts = geom === 'point'
  const showLineOpts = ['line', 'area', 'smooth'].includes(geom)
  const showSmooth = geom === 'smooth'
  const showHist = geom === 'histogram'

  return (
    <div className="space-y-3">
      <RangeRow label="Opacity (alpha)" value={c.alphaFixed} min={0} max={1} step={0.05}
        onChange={v => onChange({ alphaFixed: v })} />

      {!aes.colour && (
        <Row label="Fixed Colour">
          <div className="flex items-center gap-2">
            <input type="color" value={c.colorFixed || '#888888'}
              onChange={e => onChange({ colorFixed: e.target.value })}
              className="w-8 h-7 rounded cursor-pointer border border-[#21262d] bg-transparent" />
            {c.colorFixed && <button onClick={() => onChange({ colorFixed: '' })} className="text-xs text-[#8b949e] hover:text-white">Clear</button>}
          </div>
        </Row>
      )}
      {!aes.fill && ['bar', 'col', 'histogram', 'area', 'density', 'violin', 'boxplot'].includes(geom) && (
        <Row label="Fixed Fill">
          <div className="flex items-center gap-2">
            <input type="color" value={c.fillFixed || '#4493f8'}
              onChange={e => onChange({ fillFixed: e.target.value })}
              className="w-8 h-7 rounded cursor-pointer border border-[#21262d] bg-transparent" />
            {c.fillFixed && <button onClick={() => onChange({ fillFixed: '' })} className="text-xs text-[#8b949e] hover:text-white">Clear</button>}
          </div>
        </Row>
      )}

      {showPointOpts && (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mt-3 mb-1">Point</div>
          <RangeRow label="Point Size" value={c.pointSize} min={0.5} max={8} step={0.5}
            onChange={v => onChange({ pointSize: v })} />
          <Row label="Jitter">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={c.jitter} onChange={e => onChange({ jitter: e.target.checked })}
                className="accent-[#4493f8]" />
              <span className="text-xs text-[#e6edf3]">Add jitter</span>
            </label>
          </Row>
        </>
      )}

      {showLineOpts && (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mt-3 mb-1">Line</div>
          <RangeRow label="Line Width" value={c.linewidth} min={0.2} max={4} step={0.1}
            onChange={v => onChange({ linewidth: v })} />
          {geom === 'line' && (
            <Row label="Line Type">
              <SmallSelect value={c.linetype} onChange={v => onChange({ linetype: v })}
                options={[
                  { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' },
                  { value: 'dotted', label: 'Dotted' }, { value: 'dotdash', label: 'Dot-dash' },
                  { value: 'longdash', label: 'Long dash' }, { value: 'twodash', label: 'Two-dash' },
                ]} />
            </Row>
          )}
        </>
      )}

      {showHist && (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mt-3 mb-1">Histogram</div>
          <Row label="Bins">
            <input type="number" min={1} max={500} value={c.bins}
              onChange={e => onChange({ bins: Math.max(1, Number(e.target.value)) })}
              className="w-24 bg-[#0f1117] border border-[#21262d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#4493f8]" />
          </Row>
        </>
      )}

      {showSmooth && (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mt-3 mb-1">Smooth</div>
          <Row label="Method">
            <SmallSelect value={c.smoothMethod} onChange={v => onChange({ smoothMethod: v })}
              options={[
                { value: 'auto', label: 'Auto' }, { value: 'lm', label: 'Linear (lm)' },
                { value: 'loess', label: 'LOESS' }, { value: 'gam', label: 'GAM' },
              ]} />
          </Row>
          <Row label="Conf. Ribbon">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={c.smoothSe} onChange={e => onChange({ smoothSe: e.target.checked })}
                className="accent-[#4493f8]" />
              <span className="text-xs text-[#e6edf3]">Show confidence interval</span>
            </label>
          </Row>
        </>
      )}

      {showPos && (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mt-3 mb-1">Position</div>
          <ButtonGroup value={c.position} onChange={v => onChange({ position: v })}
            options={[
              { value: 'stack', label: 'Stack' }, { value: 'dodge', label: 'Dodge' },
              { value: 'fill', label: 'Fill (100%)' }, { value: 'identity', label: 'Identity' },
            ]} />
        </>
      )}
    </div>
  )
}

// ── Labels tab ────────────────────────────────────────────────────────────────

export function LabelsTab({
  labels, aes, onChange,
}: { labels: LabelsState; aes: AesMap; onChange: (l: Partial<LabelsState>) => void }) {
  return (
    <div className="space-y-3">
      <SectionHead title="Plot Text" />
      <Row label="Title"><TextInput value={labels.title} onChange={v => onChange({ title: v })} placeholder="Chart title…" /></Row>
      <Row label="Subtitle"><TextInput value={labels.subtitle} onChange={v => onChange({ subtitle: v })} placeholder="Subtitle…" /></Row>
      <Row label="Caption"><TextInput value={labels.caption} onChange={v => onChange({ caption: v })} placeholder="Caption / source…" /></Row>
      <SectionHead title="Axis Labels" />
      <Row label="X-axis"><TextInput value={labels.xLabel} onChange={v => onChange({ xLabel: v })} placeholder={aes.x || 'X label…'} /></Row>
      <Row label="Y-axis"><TextInput value={labels.yLabel} onChange={v => onChange({ yLabel: v })} placeholder={aes.y || 'Y label…'} /></Row>
      {aes.colour && (
        <><SectionHead title="Legend Titles" />
          <Row label="Colour"><TextInput value={labels.colourLabel} onChange={v => onChange({ colourLabel: v })} placeholder={aes.colour || 'Colour legend…'} /></Row>
        </>
      )}
      {aes.fill && (
        <Row label="Fill"><TextInput value={labels.fillLabel} onChange={v => onChange({ fillLabel: v })} placeholder={aes.fill || 'Fill legend…'} /></Row>
      )}
    </div>
  )
}


// ── Theme mini preview ────────────────────────────────────────────────────────

export function ThemePreview({
  label, selected, onClick, bg, panel, border, grid, dotColor = '#4493f8',
}: {
  label: string; selected: boolean; onClick: () => void
  bg: string; panel: string; border: string; grid: string; dotColor?: string
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex flex-col items-center gap-1.5 p-1.5 rounded border transition-all ${
        selected ? 'border-[#4493f8] bg-[#4493f8]/10' : 'border-[#21262d] hover:border-[#4493f8]/40'
      }`}
    >
      <svg viewBox="0 0 60 40" className="w-[54px] h-9 rounded overflow-hidden">
        <rect x="0" y="0" width="60" height="40" fill={bg} />
        <rect x="8" y="4" width="46" height="30" fill={panel}
          stroke={border !== 'none' ? border : 'transparent'} strokeWidth="1" />
        {grid !== 'none' && <>
          <line x1="8" y1="13" x2="54" y2="13" stroke={grid} strokeWidth="0.5" />
          <line x1="8" y1="21" x2="54" y2="21" stroke={grid} strokeWidth="0.5" />
          <line x1="8" y1="29" x2="54" y2="29" stroke={grid} strokeWidth="0.5" />
        </>}
        <circle cx="15" cy="27" r="2.2" fill={dotColor} />
        <circle cx="24" cy="19" r="2.2" fill={dotColor} />
        <circle cx="33" cy="23" r="2.2" fill={dotColor} />
        <circle cx="42" cy="14" r="2.2" fill={dotColor} />
        <circle cx="50" cy="10" r="2.2" fill={dotColor} />
      </svg>
      <span className="text-[8px] text-[#8b949e] truncate max-w-[54px] leading-none">{label}</span>
    </button>
  )
}

// ── Theme tab ─────────────────────────────────────────────────────────────────

export function ThemeTab({
  theme, onChange,
}: { theme: ThemeState; onChange: (t: Partial<ThemeState>) => void }) {
  const [expandedPkgs, setExpandedPkgs] = useState<Set<string>>(new Set(['ggplot2']))

  function togglePkg(name: string) {
    setExpandedPkgs(prev => {
      const s = new Set(prev)
      if (s.has(name)) s.delete(name); else s.add(name)
      return s
    })
  }

  // Auto-expand the package containing the currently selected theme
  const activePkg = THEME_PACKAGES.find(p => p.themes.some(t => t.id === theme.base))?.name ?? 'ggplot2'

  return (
    <div className="space-y-1">
      <SectionHead title="Base Theme" />

      {THEME_PACKAGES.map(pkg => {
        const isOpen = expandedPkgs.has(pkg.name)
        const activeInPkg = pkg.themes.find(t => t.id === theme.base)

        return (
          <div key={pkg.name} className="border border-[#21262d] rounded overflow-hidden">
            {/* Package header */}
            <button
              onClick={() => togglePkg(pkg.name)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#21262d]/50 transition-colors select-none"
            >
              {isOpen
                ? <ChevronDown className="w-3 h-3 text-[#8b949e] flex-shrink-0" />
                : <ChevronRight className="w-3 h-3 text-[#8b949e] flex-shrink-0" />
              }
              <span className={`text-xs font-medium ${pkg.name === activePkg ? 'text-white' : 'text-[#8b949e]'}`}>
                {pkg.name}
              </span>
              {activeInPkg && (
                <span className="ml-auto text-[9px] text-[#4493f8] font-medium truncate max-w-[100px]">
                  {activeInPkg.label}
                </span>
              )}
            </button>

            {/* Theme grid */}
            {isOpen && (
              <div className="border-t border-[#21262d] p-2">
                <div className="grid grid-cols-4 gap-1.5">
                  {pkg.themes.map(tc => (
                    <ThemePreview
                      key={tc.id}
                      label={tc.label}
                      selected={theme.base === tc.id}
                      onClick={() => onChange({ base: tc.id })}
                      bg={tc.bg}
                      panel={tc.panel}
                      border={tc.border}
                      grid={tc.grid}
                      dotColor={DARK_PANEL_THEMES.has(tc.id) ? '#88c0d0' : '#4493f8'}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}

      <div className="pt-3 space-y-4">
        <SectionHead title="Legend Position" />
        <ButtonGroup value={theme.legendPosition} onChange={v => onChange({ legendPosition: v })}
          options={[
            { value: 'right', label: 'Right' }, { value: 'left', label: 'Left' },
            { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' },
            { value: 'none', label: 'Hidden' },
          ]} />

        <SectionHead title="Axis Label Angle" />
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#8b949e] w-12 flex-shrink-0">X-axis</span>
            <ButtonGroup value={theme.xAngle} onChange={v => onChange({ xAngle: v })}
              options={[{ value: 0, label: '0°' }, { value: 45, label: '45°' }, { value: 90, label: '90°' }]} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#8b949e] w-12 flex-shrink-0">Y-axis</span>
            <ButtonGroup value={theme.yAngle} onChange={v => onChange({ yAngle: v })}
              options={[{ value: 0, label: '0°' }, { value: 45, label: '45°' }, { value: 90, label: '90°' }]} />
          </div>
        </div>

        <SectionHead title="Panel Grid" />
        <ButtonGroup value={theme.panelGrid} onChange={v => onChange({ panelGrid: v })}
          options={[{ value: 'both', label: 'Both' }, { value: 'major', label: 'Major only' }, { value: 'none', label: 'None' }]} />

        <SectionHead title="Font Size" />
        <Row label="Base font size">
          <div className="flex items-center gap-2">
            <input type="number" min={8} max={18} value={theme.baseFontSize}
              onChange={e => onChange({ baseFontSize: Math.max(8, Math.min(18, Number(e.target.value))) })}
              className="w-20 bg-[#0f1117] border border-[#21262d] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#4493f8]" />
            <span className="text-xs text-[#8b949e]">pt</span>
          </div>
        </Row>
      </div>
    </div>
  )
}

// ── Layer accordion ────────────────────────────────────────────────────────────

export function GeomLayerAccordion({
  layers, expandedId, conflictIds, aes, columns,
  availability,
  onExpand, onUpdateGeom, onUpdateCustomize, onToggleVisible, onDelete,
}: {
  layers: GeomLayer[]
  expandedId: string | null
  conflictIds: Set<string>
  aes: AesMap
  columns: ColumnInfo[]
  availability: Record<string, GeomState>
  onExpand: (id: string | null) => void
  onUpdateGeom: (id: string, geomType: string) => void
  onUpdateCustomize: (id: string, patch: Partial<CustomizeState>) => void
  onToggleVisible: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      {layers.map((layer, idx) => {
        const isExpanded = layer.id === expandedId
        const isConflict = conflictIds.has(layer.id)

        return (
          <div
            key={layer.id}
            className={`rounded border transition-all ${
              !layer.visible ? 'opacity-50' : ''
            } ${isExpanded ? 'border-[#4493f8]/40 bg-[#0f1117]/40' : 'border-[#21262d]'}`}
          >
            {/* Layer header */}
            <div
              className="flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none"
              onClick={() => onExpand(isExpanded ? null : layer.id)}
            >
              {isExpanded
                ? <ChevronDown className="w-3.5 h-3.5 text-[#8b949e] flex-shrink-0" />
                : <ChevronRight className="w-3.5 h-3.5 text-[#8b949e] flex-shrink-0" />
              }
              <span className="text-[#8b949e] flex-shrink-0">
                <GeomIcon geom={layer.geomType} small />
              </span>
              <span className="text-xs text-[#e6edf3] flex-1 truncate">
                Layer {idx + 1} — {GEOM_LABELS[layer.geomType] ?? layer.geomType}
              </span>
              {isConflict && (
                <span title="This geom conflicts with the current aesthetic mappings. Count-stat geoms (bar, histogram, density) cannot be combined with a Y mapping or identity-stat geoms.">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#f0c040] flex-shrink-0" />
                </span>
              )}
              <button
                onClick={e => { e.stopPropagation(); onToggleVisible(layer.id) }}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                className="text-[#8b949e] hover:text-white transition-colors flex-shrink-0"
              >
                {layer.visible
                  ? <Eye className="w-3.5 h-3.5" />
                  : <EyeOff className="w-3.5 h-3.5" />
                }
              </button>
              <button
                onClick={e => { e.stopPropagation(); onDelete(layer.id) }}
                title="Remove layer"
                className="text-[#8b949e] hover:text-[#f85149] transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-[#21262d] px-3 py-3 space-y-4">
                {/* Geom picker */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mb-2">Geom Type</div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {GEOMS.map(g => (
                      <GeomButton
                        key={g} geom={g}
                        selected={layer.geomType === g}
                        state={availability[g] ?? 'available'}
                        onClick={() => onUpdateGeom(layer.id, g)}
                      />
                    ))}
                  </div>
                  <p className="text-[9px] text-[#8b949e]/70 mt-1.5">
                    <Star className="inline w-2.5 h-2.5 text-[#f0c040] fill-[#f0c040] mr-0.5" />
                    Recommended for current aesthetic mappings
                  </p>
                </div>

                {/* Customize */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8b949e] mb-2">Customize</div>
                  <CustomizePanel
                    geom={layer.geomType}
                    aes={aes}
                    customize={layer.customize}
                    onChange={patch => onUpdateCustomize(layer.id, patch)}
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tab types ──────────────────────────────────────────────────────────────────
