import React, { useMemo } from 'react'
import { themeList, type ThemeDef } from '@/lib/themes'
import { themeIconUri } from '@/lib/themeScenes'
import { useThemeStore } from '@/store/theme'
import { useCustomThemeStore } from '@/store/custom-themes'

function ThemeCard({ theme, art, selected, onSelect }: {
  theme: ThemeDef
  art: string
  selected: boolean
  onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <button
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
  // The registry is a plain mutable object, so the store subscription — not
  // the registry — is what tells React a user theme was added or recoloured.
  const mine = useCustomThemeStore((s) => s.system)

  // `mine` and `revision` are signals: both `themeList()` and `themeIconUri()`
  // read the live registry, which the lint rule has no way to see.
  const themes = useMemo(themeList, [mine, revision])
  const art = useMemo(
    () => Object.fromEntries(themes.map((t) => [t.id, themeIconUri(t.id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themes, revision],
  )

  return (
    <div className="grid grid-cols-3 gap-2">
      {themes.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          art={art[theme.id]}
          selected={current === theme.id}
          onSelect={setTheme}
        />
      ))}
    </div>
  )
}
