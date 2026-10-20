import React, { useEffect, useId, useMemo, useState } from 'react'
import { THEMES, themeList, type ThemeDef } from '@/lib/themes'
import { themeBackgroundGallery } from '@/lib/theme-backgrounds'
import { useThemeStore } from '@/store/theme'
import { useCustomThemeStore } from '@/store/custom-themes'
import { APP_THEME_COLLECTIONS, appThemeCollection, type AppThemeCollection } from '@/lib/theme-collections'

function ThemeCard({ theme, art, selected, onSelect }: {
  theme: ThemeDef
  art: string
  selected: boolean
  onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={theme.description}
      onClick={() => onSelect(theme.id)}
      className={`group rounded-lg border p-1 flex flex-col gap-1.5 transition-all text-left w-full ${
        selected
          ? 'border-geo-accent ring-1 ring-geo-accent'
          : 'border-geo-border hover:border-geo-muted'
      }`}
    >
      <img
        src={art}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`w-full h-16 rounded-md object-cover transition-transform ${
          selected ? '' : 'opacity-90 group-hover:opacity-100'
        }`}
      />
      <span className="flex items-center gap-1 px-0.5 pb-0.5 min-w-0">
        <span className="flex-1 text-[11px] text-foreground truncate">{theme.label}</span>
        {theme.custom && (
          <span className="shrink-0 text-[9px] text-geo-muted border border-geo-border rounded px-1">
            yours
          </span>
        )}
      </span>
    </button>
  )
}

export function ThemePicker(): React.ReactElement {
  const current = useThemeStore((s) => s.current)
  const revision = useThemeStore((s) => s.revision)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [collection, setCollection] = useState<AppThemeCollection>(() => appThemeCollection(THEMES[current]))
  const collectionId = useId()
  // The registry is a plain mutable object, so the store subscription — not
  // the registry — is what tells React a user theme was added or recoloured.
  const mine = useCustomThemeStore((s) => s.system)

  // `mine` and `revision` are signals: the registry and artwork lookup
  // read the live registry, which the lint rule has no way to see.
  const themes = useMemo(themeList, [mine, revision])
  useEffect(() => { setCollection(appThemeCollection(themes.find(theme => theme.id === current))) }, [current, themes])
  const art = useMemo(
    () => Object.fromEntries(themes.map((t) => [t.id, t.iconImage || themeBackgroundGallery(t.id)[0].thumbnailUrl])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themes, revision],
  )

  const cards = (items: ThemeDef[]): React.ReactElement => (
    <div className="grid grid-cols-3 gap-2">
      {items.map((theme) => (
        <ThemeCard key={theme.id} theme={theme} art={art[theme.id]}
          selected={current === theme.id} onSelect={setTheme} />
      ))}
    </div>
  )

  const tabProps = (id: AppThemeCollection): React.ButtonHTMLAttributes<HTMLButtonElement> => ({
    type: 'button', role: 'tab', id: `${collectionId}-${id}`, tabIndex: collection === id ? 0 : -1,
    'aria-controls': `${collectionId}-themes`, 'aria-selected': collection === id,
    onClick: () => setCollection(id),
    className: `flex-1 rounded-md px-1.5 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent ${collection === id ? 'bg-geo-panel text-foreground shadow-sm' : 'text-geo-muted hover:text-foreground'}`,
  })
  const visibleThemes = themes.filter(theme => appThemeCollection(theme) === collection)

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Theme collection" className="flex gap-1 rounded-lg border border-geo-border bg-geo-bg p-1" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const currentIndex = APP_THEME_COLLECTIONS.findIndex(group => group.id === collection)
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? APP_THEME_COLLECTIONS.length - 1 : (currentIndex + (event.key === 'ArrowLeft' ? -1 : 1) + APP_THEME_COLLECTIONS.length) % APP_THEME_COLLECTIONS.length
        const next = APP_THEME_COLLECTIONS[nextIndex].id
        setCollection(next)
        document.getElementById(`${collectionId}-${next}`)?.focus()
      }}>
        <button {...tabProps('illustrated')} data-ourgeo-id="settings.illustratedThemes">Illustrated</button>
        <button {...tabProps('legacy')} data-ourgeo-id="settings.legacyThemes">Legacy</button>
        <button {...tabProps('field')} data-ourgeo-id="settings.fieldThemes">Field collection</button>
        <button {...tabProps('custom')} data-ourgeo-id="settings.customThemes">Custom</button>
      </div>
      <div role="tabpanel" id={`${collectionId}-themes`} aria-labelledby={`${collectionId}-${collection}`} tabIndex={0} className="space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent rounded-md">
        {collection === 'field' && <p className="text-[11px] leading-relaxed text-geo-muted">Website-inspired palettes, paired with rugged nature photography. Eight dark themes and five light.</p>}
        {collection === 'legacy' && <p className="text-[11px] leading-relaxed text-geo-muted">The original interface palettes and generated artwork.</p>}
        {collection === 'custom' && !visibleThemes.length && <p className="rounded-md border border-dashed border-geo-border p-3 text-[11px] leading-relaxed text-geo-muted">No custom themes yet. Open Theme Studio to create or import one.</p>}
        {cards(visibleThemes)}
      </div>
    </div>
  )
}
