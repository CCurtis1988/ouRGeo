import React, { useMemo } from 'react'
import { THEMES } from '@/lib/themes'
import {
  codeThemeList, markdownThemeList,
  type SyntaxPalette, type MarkdownPalette,
} from '@/lib/editor-themes'
import { useThemeStore } from '@/store/theme'
import { useCustomThemeStore } from '@/store/custom-themes'
import { CodePreview, MarkdownPreview } from './EditorThemePreview'

interface Entry { id: string; label: string; isDark: boolean; custom?: true }

function ThemeCard({ entry, selected, isDefault, preview, onSelect }: {
  entry: Entry
  selected: boolean
  isDefault: boolean
  preview: React.ReactNode
  onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <button
      onClick={() => onSelect(entry.id)}
      className={`group rounded-lg border p-1 flex flex-col gap-1 transition-all text-left w-full ${
        selected
          ? 'border-geo-accent ring-1 ring-geo-accent'
          : 'border-geo-border hover:border-geo-muted'
      }`}
    >
      {preview}
      <span className="flex items-center gap-1 px-0.5 pb-0.5 min-w-0">
        <span className="text-[11px] text-foreground truncate">{entry.label}</span>
        {entry.custom && (
          <span className="shrink-0 text-[9px] text-geo-muted border border-geo-border rounded px-1">
            yours
          </span>
        )}
        {isDefault && (
          <span className="shrink-0 text-[9px] text-geo-muted border border-geo-border rounded px-1">
            default
          </span>
        )}
      </span>
    </button>
  )
}

/** One list for both axes. The only differences are the registry, the preview
 *  renderer and which store field is written. */
function Picker<T extends Entry>({ list, current, defaultId, isDark, renderPreview, onSelect }: {
  list: T[]
  current: string
  defaultId: string
  isDark: boolean
  renderPreview: (t: T) => React.ReactNode
  onSelect: (id: string) => void
}): React.ReactElement {
  // Show the palettes that match the app theme's brightness first — a light
  // syntax palette on a dark editor surface is legal but rarely what is wanted,
  // so it should not be what the eye lands on.
  const { primary, secondary } = useMemo(() => ({
    primary: list.filter((t) => t.isDark === isDark),
    secondary: list.filter((t) => t.isDark !== isDark),
  }), [list, isDark])

  const card = (t: T): React.ReactElement => (
    <ThemeCard
      key={t.id}
      entry={t}
      selected={current === t.id}
      isDefault={defaultId === t.id}
      preview={renderPreview(t)}
      onSelect={onSelect}
    />
  )

  return (
    <div className="max-h-64 overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-2">{primary.map(card)}</div>
      {secondary.length > 0 && (
        <>
          <div className="flex items-center gap-2 my-2">
            <span className="text-[10px] uppercase tracking-wider text-geo-muted">
              {isDark ? 'Light' : 'Dark'}
            </span>
            <span className="flex-1 h-px bg-geo-border" />
          </div>
          <div className="grid grid-cols-2 gap-2">{secondary.map(card)}</div>
        </>
      )}
    </div>
  )
}

export function CodeThemePicker(): React.ReactElement {
  const current = useThemeStore((s) => s.current)
  const revision = useThemeStore((s) => s.revision)
  const codeTheme = useThemeStore((s) => s.codeTheme)
  const setCodeTheme = useThemeStore((s) => s.setCodeTheme)
  // Subscribing to the store is what re-renders this on a Theme Studio edit;
  // the registry itself is a mutable object with stable identity.
  const mine = useCustomThemeStore((s) => s.code)
  const list = useMemo(codeThemeList, [mine, revision])
  const app = THEMES[current] ?? THEMES.dark

  return (
    <Picker<SyntaxPalette>
      list={list}
      current={codeTheme}
      defaultId={app.defaultCodeTheme}
      isDark={app.isDark}
      renderPreview={(t) => <CodePreview palette={t} />}
      onSelect={setCodeTheme}
    />
  )
}

export function MarkdownThemePicker(): React.ReactElement {
  const current = useThemeStore((s) => s.current)
  const revision = useThemeStore((s) => s.revision)
  const markdownTheme = useThemeStore((s) => s.markdownTheme)
  const setMarkdownTheme = useThemeStore((s) => s.setMarkdownTheme)
  const mine = useCustomThemeStore((s) => s.markdown)
  const list = useMemo(markdownThemeList, [mine, revision])
  const app = THEMES[current] ?? THEMES.dark

  return (
    <Picker<MarkdownPalette>
      list={list}
      current={markdownTheme}
      defaultId={app.defaultMarkdownTheme}
      isDark={app.isDark}
      renderPreview={(t) => <MarkdownPreview palette={t} />}
      onSelect={setMarkdownTheme}
    />
  )
}
