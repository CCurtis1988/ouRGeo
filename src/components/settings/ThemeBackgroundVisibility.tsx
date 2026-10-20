import React, { useCallback, useEffect, useId, useRef } from 'react'
import { useThemeStore } from '@/store/theme'
import { useThemeBackgroundStore } from '@/store/theme-backgrounds'
import { THEMES } from '@/lib/themes'
import { backgroundPresentation, getThemeBackgroundPreferences, selectedThemeBackgrounds, themeBackgroundGallery, type ThemeBackgroundImage } from '@/lib/theme-backgrounds'
import { useThemeBackgroundPoster } from '@/hooks/useThemeBackgroundPoster'

function VisibilityPreview({ image, themeId, strength }: { image: ThemeBackgroundImage; themeId: string; strength?: number }): React.ReactElement {
  const url = useThemeBackgroundPoster(image)
  const presentation = backgroundPresentation(themeId, strength)
  return <figure className="w-28 shrink-0 sm:w-36">
    <div className="relative aspect-video overflow-hidden rounded-md border border-geo-border bg-geo-panel" aria-hidden="true">
      <img src={url} alt="" className="h-full w-full object-cover" style={{ opacity: presentation.opacity, filter: presentation.filter }} />
      <span className="absolute left-2 top-2 font-mono text-[10px]" style={{ color: THEMES[themeId]?.editorChrome.fg }}>Project notes</span>
    </div>
    <figcaption className="mt-1 text-[10px] text-geo-muted">{image.kind === 'gif' ? 'Editor preview · still' : 'Editor preview'}</figcaption>
  </figure>
}

/** Preview while dragging; persist on release/keyboard/blur rather than queuing
 * a disk write for every pointer pixel. Closing or changing themes saves too. */
export function ThemeBackgroundVisibility({ showError = true }: { showError?: boolean }): React.ReactElement {
  const themeId = useThemeStore(state => state.current)
  const state = useThemeBackgroundStore()
  const init = state.init
  const id = useId()
  const requested = useRef<string | null>(null)
  const preference = getThemeBackgroundPreferences(themeId, state.preferences)
  const strength = state.strengthPreview[themeId] ?? preference.imageStrength
  const value = Math.round(backgroundPresentation(themeId, strength).opacity * 100)
  const gallery = themeBackgroundGallery(themeId, state.folders.filter(folder => folder.themeId === themeId && folder.status === 'ready').flatMap(folder => folder.images))
  const image = selectedThemeBackgrounds(gallery, preference.selectedIds)[0]
  const save = useCallback(() => {
    const strength = useThemeBackgroundStore.getState().strengthPreview[themeId]
    if (strength === undefined) return
    const key = `${themeId}:${strength}`
    if (requested.current === key) return
    requested.current = key
    void useThemeBackgroundStore.getState().setImageStrength(themeId, strength).catch(() => { if (requested.current === key) requested.current = null })
  }, [themeId])
  useEffect(() => { void init().catch(() => undefined) }, [init])
  useEffect(() => save, [save])

  return <div className="mt-3 rounded-lg border border-geo-border bg-geo-panel p-3">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={id} className="text-xs font-medium text-foreground">Background visibility</label>
          <output htmlFor={id} className="text-xs tabular-nums text-foreground">{value}%</output>
        </div>
        <input id={id} type="range" min={0} max={100} step={1} value={value} disabled={!state.initialized}
          data-ourgeo-id="themeBackgrounds.visibility" aria-valuetext={`${value}% visibility`} aria-describedby={`${id}-hint`}
          className="mt-2 block w-full accent-geo-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent disabled:opacity-50"
          onChange={event => { requested.current = null; state.previewStrength(themeId, Number(event.target.value)) }}
          onPointerUp={save} onKeyUp={save} onBlur={save} />
        <div className="mt-1 flex justify-between text-[10px] text-geo-muted"><span>Faded</span><span>Original image</span></div>
        <p id={`${id}-hint`} className="mt-2 text-[10px] leading-relaxed text-geo-muted">Applies to this theme in all editors. Stronger images can make text harder to read.</p>
        <button type="button" data-ourgeo-id="themeBackgrounds.resetVisibility" disabled={!state.initialized || strength === undefined}
          className="mt-1 text-[11px] text-geo-muted underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent disabled:no-underline disabled:opacity-50"
          onClick={() => { requested.current = null; void state.setImageStrength(themeId, null).catch(() => undefined) }}>Theme default</button>
      </div>
      <VisibilityPreview image={image} themeId={themeId} strength={strength} />
    </div>
    {showError && state.error && <p role="alert" className="mt-2 text-xs text-geo-error">{state.error}</p>}
  </div>
}
