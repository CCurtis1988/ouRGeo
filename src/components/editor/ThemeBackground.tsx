import React from 'react'
import { useThemeBackgroundPlaybackStore } from '@/lib/theme-background-playback'
import { themeBackgroundGallery, backgroundPresentation } from '@/lib/theme-backgrounds'
import { useThemeBackgroundStore } from '@/store/theme-backgrounds'
import './theme-background.css'

/** Background preferences affect editor artwork, never the theme definition,
 * syntax palette, theme picker icon or the Theme Studio's authored preview. */
export function ThemeBackground({ themeId }: { themeId: string }): React.ReactElement {
  const current = useThemeBackgroundPlaybackStore(state => state.current)
  const previous = useThemeBackgroundPlaybackStore(state => state.previous)
  const reducedMotion = useThemeBackgroundPlaybackStore(state => state.reducedMotion)
  const visible = useThemeBackgroundPlaybackStore(state => state.visible)
  const strength = useThemeBackgroundStore(state => state.strengthPreview[themeId] ?? state.preferences[themeId]?.imageStrength)
  const presentation = backgroundPresentation(themeId, strength)
  const original = themeBackgroundGallery(themeId)[0]
  const fallbackUrl = reducedMotion || !visible ? original.posterUrl : original.url
  const frame = current?.themeId === themeId ? current : null
  const outgoing = previous?.themeId === themeId ? previous : null
  return <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true" data-theme-background={frame?.id ?? 'default'} style={{ ...presentation, backgroundImage: frame ? undefined : `url("${fallbackUrl}")` }}>
    {outgoing && <img className="absolute inset-0 h-full w-full object-cover" src={outgoing.url} alt="" draggable={false} decoding="async" />}
    {frame && <img key={`${frame.id}:${frame.url}`} className={`absolute inset-0 h-full w-full object-cover ${outgoing && !reducedMotion ? 'ourgeo-background-enter' : ''}`} src={frame.url} alt="" draggable={false} decoding="async" />}
  </div>
}
