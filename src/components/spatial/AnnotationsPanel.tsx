// ── Export dialog: annotations sidebar ───────────────────────────────────────
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  FONT_FAMILIES,
  type MapAnnotations, type TmapCompassType, type LegendOrientation,
  type GgplotTheme, type GgplotLegendPos, type GgplotLegendDir, type GgplotScaleStyle,
  type GgplotUnitCategory, type GgplotNorthArrowStyle,
} from '@/lib/map-annotations'
import {
  ToggleRow, ColorField, SectionHeader, FontFaceGroup, AlignGroup, LabelRow,
  MarginControl, PositionControl, InsideOutsideRow, JustificationControl,
  CornerPositionControl, NumericField,
} from './exportCodeControls'
import { AR_PRESETS, type ArOrientation } from './exportCodeHelpers'

// ── Annotations sidebar ──────────────────────────────────────────────

interface AnnotationsPanelProps {
  annotations: MapAnnotations
  patch: (p: Partial<MapAnnotations>) => void
  mode: 'tmap' | 'ggplot'
  arPreset: string
  arOrientation: ArOrientation
  arCustomW: number
  arCustomH: number
  tileZoom: number
  effectiveRatio: string
  onArChange: (u: Partial<{ arPreset: string; arOrientation: ArOrientation; arCustomW: number; arCustomH: number; tileZoom: number }>) => void
}

export function AnnotationsPanel({
  annotations, patch, mode,
  arPreset, arOrientation, arCustomW, arCustomH, tileZoom, effectiveRatio, onArChange,
}: AnnotationsPanelProps) {
  const [titleOpen, setTitleOpen]         = useState(true)
  const [subtitleOpen, setSubtitleOpen]   = useState(false)
  const [captionOpen, setCaptionOpen]     = useState(false)
  const [legendOpen, setLegendOpen]       = useState(false)
  const [compassOpen, setCompassOpen]     = useState(false)
  const [scalebarOpen, setScalebarOpen]   = useState(false)
  const [graticulesOpen, setGraticulesOpen] = useState(false)
  const [themeFrameOpen, setThemeFrameOpen] = useState(false)
  const [layoutOpen, setLayoutOpen]       = useState(false)
  const [aspectOpen, setAspectOpen] = useState(true)
  const [openPicker, setOpenPicker] = useState<string | null>(null)

  const togglePicker = (id: string) => setOpenPicker((v) => (v === id ? null : id))

  return (
    <div className="w-[260px] flex-shrink-0 border-r border-geo-border overflow-y-auto flex flex-col">

      {/* ── Title ── */}
      <SectionHeader label="Title" open={titleOpen} onToggle={() => setTitleOpen((v) => !v)} />
      {titleOpen && (
        <div className="px-3 py-2.5 space-y-2.5">
          <ToggleRow label="Show title" checked={annotations.showTitle} onChange={(v) => patch({ showTitle: v })} />
          {annotations.showTitle && (
            <>
              <input
                type="text" value={annotations.titleText}
                onChange={(e) => patch({ titleText: e.target.value })}
                placeholder="Map Title"
                className="w-full px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground
                  placeholder-geo-muted/50 outline-none focus:border-geo-accent"
              />
              <LabelRow label="Size">
                <input type="number" min={6} max={72} value={annotations.titleSize}
                  onChange={(e) => patch({ titleSize: Math.max(6, parseInt(e.target.value) || 16) })}
                  className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
                <span className="text-xs text-geo-muted">pt</span>
              </LabelRow>
              <LabelRow label="Style">
                <FontFaceGroup value={annotations.titleFace} onChange={(v) => patch({ titleFace: v })} />
              </LabelRow>
              <ColorField id="titleColor" label="Color" value={annotations.titleColor}
                openPicker={openPicker} onSwatchClick={togglePicker}
                onChange={(c) => patch({ titleColor: c })} />
              <LabelRow label="Align">
                <AlignGroup value={annotations.titleAlign} onChange={(v) => patch({ titleAlign: v })} />
              </LabelRow>
              {mode === 'tmap' && (
                <InsideOutsideRow
                  value={annotations.titlePosition === 'inside'}
                  onChange={(v) => patch({ titlePosition: v ? 'inside' : 'outside' })}
                />
              )}
              {mode === 'tmap' && (
                <LabelRow label="Justify">
                  <AlignGroup value={annotations.titleJust} onChange={(v) => patch({ titleJust: v })} />
                </LabelRow>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Subtitle ── */}
      <SectionHeader label="Subtitle" open={subtitleOpen} onToggle={() => setSubtitleOpen((v) => !v)} />
      {subtitleOpen && (
        <div className="px-3 py-2.5 space-y-2.5">
          <ToggleRow label="Show subtitle" checked={annotations.showSubtitle} onChange={(v) => patch({ showSubtitle: v })} />
          {annotations.showSubtitle && (
            <>
              <input
                type="text" value={annotations.subtitleText}
                onChange={(e) => patch({ subtitleText: e.target.value })}
                placeholder="Map subtitle"
                className="w-full px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground
                  placeholder-geo-muted/50 outline-none focus:border-geo-accent"
              />
              <LabelRow label="Size">
                <input type="number" min={6} max={48} value={annotations.subtitleSize}
                  onChange={(e) => patch({ subtitleSize: Math.max(6, parseInt(e.target.value) || 12) })}
                  className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
                <span className="text-xs text-geo-muted">pt</span>
              </LabelRow>
              <LabelRow label="Style">
                <FontFaceGroup value={annotations.subtitleFace} onChange={(v) => patch({ subtitleFace: v })} />
              </LabelRow>
              <ColorField id="subtitleColor" label="Color" value={annotations.subtitleColor}
                openPicker={openPicker} onSwatchClick={togglePicker}
                onChange={(c) => patch({ subtitleColor: c })} />
              <LabelRow label="Align">
                <AlignGroup value={annotations.subtitleAlign} onChange={(v) => patch({ subtitleAlign: v })} />
              </LabelRow>
              {mode === 'tmap' && (
                <InsideOutsideRow
                  value={annotations.subtitlePosition === 'inside'}
                  onChange={(v) => patch({ subtitlePosition: v ? 'inside' : 'outside' })}
                />
              )}
              {mode === 'tmap' && (
                <LabelRow label="Justify">
                  <AlignGroup value={annotations.subtitleJust} onChange={(v) => patch({ subtitleJust: v })} />
                </LabelRow>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Caption / Source ── */}
      <SectionHeader label="Caption / Source" open={captionOpen} onToggle={() => setCaptionOpen((v) => !v)} />
      {captionOpen && (
        <div className="px-3 py-2.5 space-y-2.5">
          <ToggleRow label="Show caption" checked={annotations.showCaption} onChange={(v) => patch({ showCaption: v })} />
          {annotations.showCaption && (
            <>
              <input
                type="text" value={annotations.captionText}
                onChange={(e) => patch({ captionText: e.target.value })}
                placeholder="Source: "
                className="w-full px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground
                  placeholder-geo-muted/50 outline-none focus:border-geo-accent"
              />
              <LabelRow label="Size">
                <input type="number" min={6} max={24} value={annotations.captionSize}
                  onChange={(e) => patch({ captionSize: Math.max(6, parseInt(e.target.value) || 9) })}
                  className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
                <span className="text-xs text-geo-muted">pt</span>
              </LabelRow>
              <LabelRow label="Style">
                <FontFaceGroup value={annotations.captionFace} onChange={(v) => patch({ captionFace: v })} />
              </LabelRow>
              <ColorField id="captionColor" label="Color" value={annotations.captionColor}
                openPicker={openPicker} onSwatchClick={togglePicker}
                onChange={(c) => patch({ captionColor: c })} />
              <LabelRow label="Align">
                <AlignGroup value={annotations.captionAlign} onChange={(v) => patch({ captionAlign: v })} />
              </LabelRow>
              {mode === 'tmap' && (
                <InsideOutsideRow
                  value={annotations.captionPosition === 'inside'}
                  onChange={(v) => patch({ captionPosition: v ? 'inside' : 'outside' })}
                />
              )}
              {mode === 'tmap' && (
                <LabelRow label="Justify">
                  <AlignGroup value={annotations.captionJust} onChange={(v) => patch({ captionJust: v })} />
                </LabelRow>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <>
        <SectionHeader label="Legend" open={legendOpen} onToggle={() => setLegendOpen((v) => !v)} />
        {legendOpen && (
          <div className="px-3 py-2.5 space-y-2.5">
            {mode === 'tmap' ? (
              <>
                <ToggleRow label="Show legend" checked={annotations.showLegendExport} onChange={(v) => patch({ showLegendExport: v })} />
                {annotations.showLegendExport && (
                  <>
                    <PositionControl value={annotations.legendExportPosition} onChange={(v) => patch({ legendExportPosition: v, legendExportJustification: 'center' })} />
                    <InsideOutsideRow value={annotations.legendExportPositionIn} onChange={(v) => patch({ legendExportPositionIn: v })} />
                    <JustificationControl position={annotations.legendExportPosition} value={annotations.legendExportJustification} onChange={(v) => patch({ legendExportJustification: v })} />
                    <LabelRow label="Orient.">
                      <div className="flex gap-1">
                        {(['portrait', 'landscape'] as LegendOrientation[]).map((o) => (
                          <button key={o} type="button" onClick={() => patch({ legendExportOrientation: o })}
                            className={cn('px-2 py-0.5 text-[10px] rounded border capitalize transition-colors',
                              annotations.legendExportOrientation === o
                                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                            {o}
                          </button>
                        ))}
                      </div>
                    </LabelRow>
                    <input type="text" value={annotations.legendExportTitle}
                      onChange={(e) => patch({ legendExportTitle: e.target.value })}
                      placeholder="Legend title"
                      className="w-full px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground placeholder-geo-muted/50 outline-none focus:border-geo-accent" />
                    <NumericField label="Title size" value={annotations.legendExportTitleSize} min={0.5} max={3} step={0.05}
                      onChange={(v) => patch({ legendExportTitleSize: v })} />
                    <ColorField id="legendTitleColor" label="Title color" value={annotations.legendExportTitleColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ legendExportTitleColor: c })} />
                    <LabelRow label="Title style">
                      <FontFaceGroup value={annotations.legendExportTitleFace} onChange={(v) => patch({ legendExportTitleFace: v })} />
                    </LabelRow>
                    <NumericField label="Text size" value={annotations.legendExportTextSize} min={0.5} max={2} step={0.05}
                      onChange={(v) => patch({ legendExportTextSize: v })} />
                    <ColorField id="legendTextColor" label="Text color" value={annotations.legendExportTextColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ legendExportTextColor: c })} />
                    <ColorField id="legendBgColor" label="Background" value={annotations.legendExportBgColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ legendExportBgColor: c })} />
                    <NumericField label="BG opacity" value={annotations.legendExportBgAlpha} min={0} max={1} step={0.05}
                      onChange={(v) => patch({ legendExportBgAlpha: v })} />
                    <ToggleRow label="Legend frame" checked={annotations.legendExportFrame} onChange={(v) => patch({ legendExportFrame: v })} />
                  </>
                )}
              </>
            ) : (
              <>
                <LabelRow label="Position">
                  <div className="flex gap-1 flex-wrap">
                    {(['right', 'left', 'top', 'bottom', 'none'] as GgplotLegendPos[]).map((p) => (
                      <button key={p} type="button" onClick={() => patch({ ggplotLegendPos: p })}
                        className={cn('px-2 py-0.5 text-[10px] rounded border capitalize transition-colors',
                          annotations.ggplotLegendPos === p
                            ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                            : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                        {p}
                      </button>
                    ))}
                  </div>
                </LabelRow>
                {annotations.ggplotLegendPos !== 'none' && (
                  <>
                    <LabelRow label="Direction">
                      <div className="flex gap-1">
                        {(['vertical', 'horizontal'] as GgplotLegendDir[]).map((d) => (
                          <button key={d} type="button" onClick={() => patch({ ggplotLegendDir: d })}
                            className={cn('px-2 py-0.5 text-[10px] rounded border capitalize transition-colors',
                              annotations.ggplotLegendDir === d
                                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </LabelRow>
                    <input type="text" value={annotations.ggplotLegendTitle}
                      onChange={(e) => patch({ ggplotLegendTitle: e.target.value })}
                      placeholder="Legend title (default: column name)"
                      className="w-full px-2 py-1 text-xs bg-geo-bg border border-geo-border rounded text-foreground placeholder-geo-muted/50 outline-none focus:border-geo-accent" />
                    <NumericField label="Title size" value={annotations.ggplotLegendTitleSize} min={6} max={24} step={1} unit="pt"
                      onChange={(v) => patch({ ggplotLegendTitleSize: v })} />
                    <ColorField id="ggLegendTitleColor" label="Title color" value={annotations.ggplotLegendTitleColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ ggplotLegendTitleColor: c })} />
                    <NumericField label="Text size" value={annotations.ggplotLegendTextSize} min={6} max={24} step={1} unit="pt"
                      onChange={(v) => patch({ ggplotLegendTextSize: v })} />
                    <ColorField id="ggLegendTextColor" label="Text color" value={annotations.ggplotLegendTextColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ ggplotLegendTextColor: c })} />
                    <ColorField id="ggLegendBg" label="Background" value={annotations.ggplotLegendBgColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ ggplotLegendBgColor: c })} />
                    <NumericField label="BG opacity" value={annotations.ggplotLegendBgAlpha} min={0} max={1} step={0.05}
                      onChange={(v) => patch({ ggplotLegendBgAlpha: v })} />
                    <ToggleRow label="Legend frame" checked={annotations.ggplotLegendFrame} onChange={(v) => patch({ ggplotLegendFrame: v })} />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </>

      {/* ── North Arrow ── */}
      <>
        <SectionHeader label="North Arrow" open={compassOpen} onToggle={() => setCompassOpen((v) => !v)} />
        {compassOpen && (
          <div className="px-3 py-2.5 space-y-2.5">
            {mode === 'tmap' ? (
              <>
                <ToggleRow label="Show compass" checked={annotations.showCompassExport} onChange={(v) => patch({ showCompassExport: v })} />
                {annotations.showCompassExport && (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {(['arrow', '4star', '8star', 'radar', 'rose'] as TmapCompassType[]).map((t) => (
                        <button key={t} type="button" onClick={() => patch({ compassExportType: t })}
                          className={cn('px-2 py-0.5 text-[10px] rounded border transition-colors',
                            annotations.compassExportType === t
                              ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                              : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <PositionControl value={annotations.compassExportPosition} onChange={(v) => patch({ compassExportPosition: v, compassExportJustification: 'center' })} />
                    <InsideOutsideRow value={annotations.compassExportPositionIn} onChange={(v) => patch({ compassExportPositionIn: v })} />
                    <JustificationControl position={annotations.compassExportPosition} value={annotations.compassExportJustification} onChange={(v) => patch({ compassExportJustification: v })} />
                    <NumericField label="Size" value={annotations.compassExportSize} min={0.5} max={5} step={0.1}
                      onChange={(v) => patch({ compassExportSize: v })} />
                    <ToggleRow label="Show N label" checked={annotations.compassExportShowLabels} onChange={(v) => patch({ compassExportShowLabels: v })} />
                    {annotations.compassExportShowLabels && (
                      <NumericField label="Label size" value={annotations.compassExportTextSize} min={0.5} max={2} step={0.05}
                        onChange={(v) => patch({ compassExportTextSize: v })} />
                    )}
                    <ColorField id="compassDark" label="Dark color" value={annotations.compassExportColorDark}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ compassExportColorDark: c })} />
                    <ColorField id="compassLight" label="Light color" value={annotations.compassExportColorLight}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ compassExportColorLight: c })} />
                  </>
                )}
              </>
            ) : (
              <>
                <ToggleRow label="Show north arrow" checked={annotations.showNorthArrowExport}
                  onChange={(v) => patch({ showNorthArrowExport: v })} />
                {annotations.showNorthArrowExport && (
                  <>
                    <LabelRow label="Style">
                      <div className="flex flex-wrap gap-1">
                        {([['split', 'Fancy'], ['open', 'Open'], ['simple', 'Minimal']] as [GgplotNorthArrowStyle, string][]).map(([s, l]) => (
                          <button key={s} type="button" onClick={() => patch({ northArrowExportStyle: s })}
                            className={cn('px-2 py-0.5 text-[10px] rounded border transition-colors',
                              annotations.northArrowExportStyle === s
                                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </LabelRow>
                    <CornerPositionControl value={annotations.northArrowExportPos}
                      onChange={(v) => patch({ northArrowExportPos: v })} />
                    <NumericField label="Size" value={annotations.northArrowExportSize} min={0.5} max={5} step={0.1} unit="cm"
                      onChange={(v) => patch({ northArrowExportSize: v })} />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </>

      {/* ── Scale Bar ── */}
      <>
        <SectionHeader label="Scale Bar" open={scalebarOpen} onToggle={() => setScalebarOpen((v) => !v)} />
        {scalebarOpen && (
          <div className="px-3 py-2.5 space-y-2.5">
            {mode === 'tmap' ? (
              <>
                <ToggleRow label="Show scale bar" checked={annotations.showScalebar} onChange={(v) => patch({ showScalebar: v })} />
                {annotations.showScalebar && (
                  <>
                    <PositionControl value={annotations.scalebarPosition} onChange={(v) => patch({ scalebarPosition: v, scalebarJustification: 'center' })} />
                    <InsideOutsideRow value={annotations.scalebarPositionIn} onChange={(v) => patch({ scalebarPositionIn: v })} />
                    <JustificationControl position={annotations.scalebarPosition} value={annotations.scalebarJustification} onChange={(v) => patch({ scalebarJustification: v })} />
                    <LabelRow label="Breaks">
                      <input type="text" value={annotations.scalebarBreaks}
                        onChange={(e) => patch({ scalebarBreaks: e.target.value })}
                        placeholder="auto, e.g. 0,50,100"
                        className="flex-1 min-w-0 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground placeholder-geo-muted/50 outline-none focus:border-geo-accent" />
                    </LabelRow>
                    <NumericField label="Text size" value={annotations.scalebarTextSize} min={0.4} max={2} step={0.05}
                      onChange={(v) => patch({ scalebarTextSize: v })} />
                    <ColorField id="scalebarDark" label="Dark color" value={annotations.scalebarColorDark}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ scalebarColorDark: c })} />
                    <ColorField id="scalebarLight" label="Light color" value={annotations.scalebarColorLight}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ scalebarColorLight: c })} />
                    <NumericField label="Line width" value={annotations.scalebarLwd} min={0.5} max={5} step={0.5} unit="pt"
                      onChange={(v) => patch({ scalebarLwd: v })} />
                  </>
                )}
              </>
            ) : (
              <>
                <ToggleRow label="Show scale bar" checked={annotations.showScalebarGgplot}
                  onChange={(v) => patch({ showScalebarGgplot: v })} />
                {annotations.showScalebarGgplot && (
                  <>
                    <CornerPositionControl value={annotations.scalebarGgplotPos}
                      onChange={(v) => patch({ scalebarGgplotPos: v })} />
                    <LabelRow label="Style">
                      <div className="flex gap-1">
                        {(['ticks', 'bar'] as GgplotScaleStyle[]).map((s) => (
                          <button key={s} type="button" onClick={() => patch({ scalebarGgplotStyle: s })}
                            className={cn('px-2 py-0.5 text-[10px] rounded border capitalize transition-colors',
                              annotations.scalebarGgplotStyle === s
                                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </LabelRow>
                    <LabelRow label="Units">
                      <div className="flex gap-1">
                        {(['metric', 'imperial'] as GgplotUnitCategory[]).map((u) => (
                          <button key={u} type="button" onClick={() => patch({ scalebarGgplotUnits: u })}
                            className={cn('px-2 py-0.5 text-[10px] rounded border capitalize transition-colors',
                              annotations.scalebarGgplotUnits === u
                                ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                                : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                            {u}
                          </button>
                        ))}
                      </div>
                    </LabelRow>
                    <NumericField label="Width hint" value={annotations.scalebarGgplotWidthHint} min={0.1} max={0.5} step={0.05}
                      onChange={(v) => patch({ scalebarGgplotWidthHint: v })} />
                    <NumericField label="Text size" value={annotations.scalebarGgplotTextCex} min={0.3} max={2} step={0.05}
                      onChange={(v) => patch({ scalebarGgplotTextCex: v })} />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </>

      {/* ── Graticules ── */}
      <>
        <SectionHeader label="Graticules" open={graticulesOpen} onToggle={() => setGraticulesOpen((v) => !v)} />
        {graticulesOpen && (
          <div className="px-3 py-2.5 space-y-2.5">
            {mode === 'tmap' ? (
              <>
                <ToggleRow label="Show graticules" checked={annotations.showGraticules} onChange={(v) => patch({ showGraticules: v })} />
                {annotations.showGraticules && (
                  <>
                    <LabelRow label="Lines X">
                      <input type="number" min={2} max={20} value={annotations.graticulesNX}
                        onChange={(e) => patch({ graticulesNX: Math.max(2, Math.min(20, parseInt(e.target.value) || 5)) })}
                        className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
                    </LabelRow>
                    <LabelRow label="Lines Y">
                      <input type="number" min={2} max={20} value={annotations.graticulesNY}
                        onChange={(e) => patch({ graticulesNY: Math.max(2, Math.min(20, parseInt(e.target.value) || 5)) })}
                        className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
                    </LabelRow>
                    <ToggleRow label="Cardinal labels" checked={annotations.graticulesLabels} onChange={(v) => patch({ graticulesLabels: v })} />
                    <ColorField id="graticulesColor" label="Color" value={annotations.graticulesColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ graticulesColor: c })} />
                    <NumericField label="Alpha" value={annotations.graticulesAlpha} min={0} max={1} step={0.05}
                      onChange={(v) => patch({ graticulesAlpha: v })} />
                    <NumericField label="Line width" value={annotations.graticulesLwd} min={0.1} max={5} step={0.1} unit="pt"
                      onChange={(v) => patch({ graticulesLwd: v })} />
                  </>
                )}
              </>
            ) : (
              <>
                <ToggleRow label="Show graticules" checked={annotations.showGraticulesGgplot}
                  onChange={(v) => patch({ showGraticulesGgplot: v })} />
                {annotations.showGraticulesGgplot && (
                  <>
                    <ColorField id="ggGratColor" label="Color" value={annotations.graticulesGgplotColor}
                      openPicker={openPicker} onSwatchClick={togglePicker}
                      onChange={(c) => patch({ graticulesGgplotColor: c })} />
                    <NumericField label="Alpha" value={annotations.graticulesGgplotAlpha} min={0} max={1} step={0.05}
                      onChange={(v) => patch({ graticulesGgplotAlpha: v })} />
                    <NumericField label="Line width" value={annotations.graticulesGgplotLwd} min={0.1} max={5} step={0.1} unit="pt"
                      onChange={(v) => patch({ graticulesGgplotLwd: v })} />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </>

      {/* ── Theme & Frame (ggplot only) ── */}
      {mode === 'ggplot' && (
        <>
          <SectionHeader label="Theme & Frame" open={themeFrameOpen} onToggle={() => setThemeFrameOpen((v) => !v)} />
          {themeFrameOpen && (
            <div className="px-3 py-2.5 space-y-2.5">
              <LabelRow label="Base theme">
                <div className="flex gap-1 flex-wrap">
                  {(['void', 'minimal', 'classic', 'bw', 'gray', 'linedraw', 'light', 'dark'] as GgplotTheme[]).map((t) => (
                    <button key={t} type="button" onClick={() => patch({ ggplotTheme: t })}
                      className={cn('px-2 py-0.5 text-[10px] rounded border capitalize transition-colors',
                        annotations.ggplotTheme === t
                          ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                          : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg')}>
                      {t}
                    </button>
                  ))}
                </div>
              </LabelRow>
              <ToggleRow label="Panel border" checked={annotations.showPanelBorder}
                onChange={(v) => patch({ showPanelBorder: v })} />
              {annotations.showPanelBorder && (
                <>
                  <ColorField id="panelBorderColor" label="Border color" value={annotations.panelBorderColor}
                    openPicker={openPicker} onSwatchClick={togglePicker}
                    onChange={(c) => patch({ panelBorderColor: c })} />
                  <NumericField label="Border width" value={annotations.panelBorderLwd} min={0.1} max={5} step={0.1} unit="pt"
                    onChange={(v) => patch({ panelBorderLwd: v })} />
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Layout ── */}
      <SectionHeader label="Layout" open={layoutOpen} onToggle={() => setLayoutOpen((v) => !v)} />
      {layoutOpen && (
        <div className="px-3 py-2.5 space-y-2.5">
          <ColorField id="bgColor" label="Background" value={annotations.bgColor}
            openPicker={openPicker} onSwatchClick={togglePicker}
            onChange={(c) => patch({ bgColor: c })} />
          <LabelRow label="Font family">
            <select value={annotations.fontFamily}
              onChange={(e) => patch({ fontFamily: e.target.value })}
              className="flex-1 min-w-0 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded
                text-foreground outline-none focus:border-geo-accent">
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </LabelRow>
          <LabelRow label="Base size">
            <input type="number" min={6} max={24} value={annotations.baseFontSize}
              onChange={(e) => patch({ baseFontSize: Math.max(6, parseInt(e.target.value) || 12) })}
              className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
            <span className="text-xs text-geo-muted">pt</span>
          </LabelRow>
          {mode === 'tmap' && (
            <>
              <ToggleRow label="Show map frame" checked={annotations.showFrame} onChange={(v) => patch({ showFrame: v })} />
              {annotations.showFrame && (
                <>
                  <ColorField id="frameColor" label="Frame color" value={annotations.frameColor}
                    openPicker={openPicker} onSwatchClick={togglePicker}
                    onChange={(c) => patch({ frameColor: c })} />
                  <LabelRow label="Frame width">
                    <input type="number" min={0.5} max={10} step={0.5} value={annotations.frameLwd}
                      onChange={(e) => patch({ frameLwd: Math.max(0.5, parseFloat(e.target.value) || 1) })}
                      className="w-16 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent" />
                    <span className="text-xs text-geo-muted">pt</span>
                  </LabelRow>
                </>
              )}
              <div className="w-full border-t border-geo-border/50 pt-2">
                <MarginControl
                  label="Outer margins"
                  top={annotations.outerMarginTop}
                  right={annotations.outerMarginRight}
                  bottom={annotations.outerMarginBottom}
                  left={annotations.outerMarginLeft}
                  onChange={(t, r, b, l) => patch({
                    outerMarginTop: t, outerMarginRight: r,
                    outerMarginBottom: b, outerMarginLeft: l,
                  })}
                />
              </div>
              <MarginControl
                label="Inner margins"
                top={annotations.innerMarginTop}
                right={annotations.innerMarginRight}
                bottom={annotations.innerMarginBottom}
                left={annotations.innerMarginLeft}
                onChange={(t, r, b, l) => patch({
                  innerMarginTop: t, innerMarginRight: r,
                  innerMarginBottom: b, innerMarginLeft: l,
                })}
              />
              <div className="w-full border-t border-geo-border/50 pt-2 space-y-2.5">
                <ToggleRow
                  label="Custom outer bg"
                  checked={annotations.outerBgColor !== ''}
                  onChange={(v) => patch({ outerBgColor: v ? '#ffffff' : '' })}
                />
                {annotations.outerBgColor !== '' && (
                  <ColorField id="outerBgColor" label="Outer bg" value={annotations.outerBgColor}
                    openPicker={openPicker} onSwatchClick={togglePicker}
                    onChange={(c) => patch({ outerBgColor: c })} />
                )}
                <NumericField label="Frame round" value={annotations.frameR} min={0} max={1} step={0.05}
                  onChange={(v) => patch({ frameR: v })} />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Aspect Ratio ── */}
      <>
        <SectionHeader label="Aspect Ratio" open={aspectOpen} onToggle={() => setAspectOpen((v) => !v)} />
        {aspectOpen && (
          <div className="px-3 py-2.5 space-y-2.5">
              {/* Preset chips */}
              <div className="flex flex-wrap gap-1">
                {AR_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onArChange({ arPreset: p.id })}
                    className={cn(
                      'px-2 py-0.5 text-[10px] rounded border transition-colors',
                      arPreset === p.id
                        ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                        : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Orientation toggle — hidden for editor / none / square / custom */}
              {arPreset !== 'editor' && arPreset !== 'none' && arPreset !== 'square' && arPreset !== 'custom' && (
                <LabelRow label="Orientation">
                  <div className="flex gap-1">
                    {(['landscape', 'portrait'] as ArOrientation[]).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => onArChange({ arOrientation: o })}
                        className={cn(
                          'px-2 py-0.5 text-[10px] rounded border capitalize transition-colors',
                          arOrientation === o
                            ? 'border-geo-accent bg-geo-accent/10 text-geo-accent'
                            : 'border-geo-border text-geo-muted hover:text-foreground hover:bg-geo-bg',
                        )}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </LabelRow>
              )}

              {/* Ratio display — shown for fixed presets only */}
              {arPreset !== 'editor' && arPreset !== 'none' && arPreset !== 'custom' && (
                <LabelRow label="Ratio">
                  <span className="text-xs text-foreground font-mono">{effectiveRatio}</span>
                </LabelRow>
              )}

              {/* Custom W : H inputs */}
              {arPreset === 'custom' && (
                <LabelRow label="W : H">
                  <input
                    type="number" min={1} value={arCustomW}
                    onChange={(e) => onArChange({ arCustomW: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-14 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent"
                  />
                  <span className="text-xs text-geo-muted">:</span>
                  <input
                    type="number" min={1} value={arCustomH}
                    onChange={(e) => onArChange({ arCustomH: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-14 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent"
                  />
                </LabelRow>
              )}

              {/* Tile zoom */}
              <LabelRow label="Tile zoom">
                <input
                  type="number" min={1} max={18} value={tileZoom}
                  onChange={(e) => onArChange({ tileZoom: Math.max(1, Math.min(18, parseInt(e.target.value) || 1)) })}
                  className="w-14 px-2 py-0.5 text-xs bg-geo-bg border border-geo-border rounded text-foreground outline-none focus:border-geo-accent"
                />
                <span className="text-xs text-geo-muted">1–18, higher = more detail</span>
              </LabelRow>
            </div>
          )}
        </>
    </div>
  )
}

// ── Main dialog ──────────────────────────────────────────────────────

