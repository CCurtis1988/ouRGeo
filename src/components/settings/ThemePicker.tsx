import React from 'react'
import { THEME_LIST, type ThemeDef } from '@/lib/themes'
import { sceneDataUri } from '@/lib/themeScenes'
import { useThemeStore } from '@/store/theme'

function ThemeCard({ theme, selected, onSelect }: {
  theme: ThemeDef
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
        src={sceneDataUri(theme.id)}
        alt=""
        draggable={false}
        className={`w-full h-16 rounded-md object-cover transition-transform ${
          selected ? '' : 'opacity-90 group-hover:opacity-100'
        }`}
      />
      <span className="text-[11px] text-center text-foreground truncate w-full block pb-0.5">
        {theme.label}
      </span>
    </button>
  )
}

export function ThemePicker(): React.ReactElement {
  const current = useThemeStore((s) => s.current)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className="grid grid-cols-3 gap-2">
      {THEME_LIST.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          selected={current === theme.id}
          onSelect={setTheme}
        />
      ))}
    </div>
  )
}
