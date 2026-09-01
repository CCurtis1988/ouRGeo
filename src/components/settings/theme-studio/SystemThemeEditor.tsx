import React, { useMemo } from 'react'
import { Wand2 } from 'lucide-react'
import { THEMES } from '@/lib/themes'
import { BASEMAPS_BY_ID, THEME_DEFAULT_BASEMAPS } from '@/lib/basemaps'
import {
  codeThemeList, markdownThemeList,
  resolveCodeTheme, resolveMarkdownTheme,
} from '@/lib/editor-themes'
import {
  BACKGROUND_SPEC, ICON_SPEC, SYSTEM_COLOR_KEYS, CHROME_KEYS,
  contrastWarning, luminance, shade,
  type CustomSystemTheme, type SystemColors,
} from '@/lib/custom-themes'
import type { EditorChrome } from '@/lib/themes'
import {
  CheckField, ColorField, ImageField, Section, SelectField, SliderField, TextField,
} from './fields'

// What each colour actually paints, said in terms of things on screen. A user
// choosing "Muted" is choosing the colour of every secondary label in the
// application; "muted" alone does not tell them that.
const COLOR_LABEL: Record<keyof SystemColors, [string, string]> = {
  bg:          ['Background', 'The deepest surface — behind panels, and the console.'],
  panel:       ['Panel', 'Toolbars, side panels, dialogs, tab strips.'],
  border:      ['Border', 'Dividers, outlines, panel edges.'],
  accent:      ['Accent', 'Primary buttons, selection, focus rings, the R-ready dot.'],
  accentHover: ['Accent (hover)', 'The accent when a control is hovered.'],
  muted:       ['Muted text', 'Secondary labels, inactive tabs, most icons.'],
  success:     ['Success', 'Connected states, saved edits, valid input.'],
  warning:     ['Warning', 'Warnings from R, and cautions in dialogs.'],
  error:       ['Error', 'Errors from R, destructive buttons.'],
  fg:          ['Foreground', 'Primary text.'],
}

const CHROME_LABEL: Record<keyof EditorChrome, [string, string]> = {
  panel:  ['Editor background', 'The surface the code sits on. Sets Monaco’s background.'],
  bg:     ['Current line', 'The highlight behind the line the caret is on.'],
  border: ['Indent guides', 'Indent guides and the scrollbar thumb.'],
  accent: ['Caret & selection', 'The text cursor, and the selection wash.'],
  muted:  ['Line numbers', 'The gutter’s inactive line numbers.'],
  fg:     ['Editor text', 'Plain editor text, and active line numbers.'],
}

/** Derive an editor surface from the interface colours. The relationship is
 *  the shipped themes': the editor panel is the interface panel, the current
 *  line is the deeper background, and the rest carry straight across. */
function chromeFromColors(c: SystemColors): EditorChrome {
  return {
    panel: c.panel,
    bg: c.bg,
    border: c.border,
    accent: c.accent,
    muted: c.muted,
    fg: c.fg,
  }
}

export function SystemThemeEditor({ draft, onChange }: {
  draft: CustomSystemTheme
  onChange: (patch: Partial<CustomSystemTheme>) => void
}): React.ReactElement {
  const c = draft.colors
  const setColor = (k: keyof SystemColors, hex: string): void =>
    onChange({ colors: { ...c, [k]: hex } })
  const setChrome = (k: keyof EditorChrome, hex: string): void =>
    onChange({ chrome: { ...draft.chrome, [k]: hex } })

  const codeList = useMemo(codeThemeList, [])
  const mdList = useMemo(markdownThemeList, [])

  // The basemap menu, grouped so the ones needing an API key are visibly
  // separate from the ones that just work.
  const basemapGroups = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; name: string }>>()
    for (const b of Object.values(BASEMAPS_BY_ID)) {
      const key = b.apiKeyId ? `${b.provider} (needs an API key)` : b.provider
      const list = groups.get(key) ?? []
      list.push({ id: b.id, name: b.name })
      groups.set(key, list)
    }
    return [...groups.entries()]
  }, [])

  const inherited = THEME_DEFAULT_BASEMAPS[draft.basedOn] ?? 'carto-dark-matter'

  const colorWarn: Partial<Record<keyof SystemColors, string | null>> = {
    fg: contrastWarning(c.fg, c.panel, 'Foreground'),
    muted: contrastWarning(c.muted, c.panel, 'Muted text'),
    accent: contrastWarning(c.accent, c.panel, 'Accent'),
    error: contrastWarning(c.error, c.bg, 'Error'),
  }

  return (
    <div className="divide-y divide-geo-border">
      <Section title="Identity">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <TextField
            label="Name"
            value={draft.label}
            maxLength={40}
            placeholder="Slate Blue"
            onChange={(label) => onChange({ label })}
          />
          <SelectField
            label="Brightness"
            hint="Chooses Monaco's base theme, and which editor palettes the pickers list first."
            value={draft.isDark ? 'dark' : 'light'}
            onChange={(v) => onChange({ isDark: v === 'dark' })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </SelectField>
        </div>
        <p className="text-[10px] text-geo-muted mt-2 leading-relaxed">
          Started from <span className="text-foreground">{THEMES[draft.basedOn]?.label ?? draft.basedOn}</span>,
          which also supplies this theme&rsquo;s generated artwork until you upload your own.
        </p>
      </Section>

      <Section
        title="Interface colours"
        hint="The ten values behind every --geo-* custom property. They paint the whole application except the editor surface, which has its own set below."
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(232px,1fr))] gap-x-5">
          {SYSTEM_COLOR_KEYS.map((k) => (
            <ColorField
              key={k}
              label={COLOR_LABEL[k][0]}
              hint={COLOR_LABEL[k][1]}
              value={c[k]}
              warn={colorWarn[k]}
              onChange={(hex) => setColor(k, hex)}
            />
          ))}
        </div>
        <button
          onClick={() => onChange({
            colors: { ...c, accentHover: shade(c.accent, draft.isDark ? 0.18 : -0.18) },
          })}
          className="mt-2 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded
            border border-geo-border text-geo-muted hover:text-geo-accent
            hover:border-geo-accent transition-colors"
        >
          <Wand2 className="w-3 h-3" />
          Derive hover from accent
        </button>
      </Section>

      <Section
        title="Editor surface"
        hint="Where the code sits. Deliberately separate from the interface colours — the shipped themes give the editor a slightly different surface from the panels around it — but you can collapse the distinction."
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(232px,1fr))] gap-x-5">
          {CHROME_KEYS.map((k) => (
            <ColorField
              key={k}
              label={CHROME_LABEL[k][0]}
              hint={CHROME_LABEL[k][1]}
              value={draft.chrome[k]}
              warn={k === 'fg'
                ? contrastWarning(draft.chrome.fg, draft.chrome.panel, 'Editor text')
                : k === 'muted'
                  ? contrastWarning(draft.chrome.muted, draft.chrome.panel, 'Line numbers')
                  : null}
              onChange={(hex) => setChrome(k, hex)}
            />
          ))}
        </div>
        <button
          onClick={() => onChange({ chrome: chromeFromColors(c) })}
          className="mt-2 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded
            border border-geo-border text-geo-muted hover:text-geo-accent
            hover:border-geo-accent transition-colors"
        >
          <Wand2 className="w-3 h-3" />
          Match the interface colours
        </button>
      </Section>

      <Section
        title="Editor palettes"
        hint="Which syntax and prose colours this theme starts with. Selecting the theme applies both; the pickers in Settings are how you depart from them afterwards."
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <SelectField
            label="Default code theme"
            value={draft.defaultCodeTheme}
            onChange={(defaultCodeTheme) => onChange({ defaultCodeTheme })}
          >
            {codeList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}{t.custom ? ' (yours)' : ''}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Default markdown theme"
            value={draft.defaultMarkdownTheme}
            onChange={(defaultMarkdownTheme) => onChange({ defaultMarkdownTheme })}
          >
            {mdList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}{t.custom ? ' (yours)' : ''}
              </option>
            ))}
          </SelectField>
        </div>
      </Section>

      <Section
        title="Map"
        hint="The basemap the Spatial Editor opens with under this theme. The basemap picker still overrides it for the session."
      >
        <SelectField
          label="Default basemap"
          value={draft.defaultBasemap}
          onChange={(defaultBasemap) => onChange({ defaultBasemap })}
        >
          <option value="">
            Follow {THEMES[draft.basedOn]?.label ?? 'the template'} ({BASEMAPS_BY_ID[inherited]?.name ?? inherited})
          </option>
          {basemapGroups.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </optgroup>
          ))}
        </SelectField>
      </Section>

      <Section
        title="Artwork"
        hint="Two optional images. The backdrop is painted behind the code editor; the card image represents the theme in the App Theme picker."
      >
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-[11px] text-foreground mb-1.5">Editor backdrop</div>
            <ImageField
              label="editor backdrop"
              spec={BACKGROUND_SPEC}
              value={draft.backgroundImage}
              onChange={(backgroundImage) => onChange({ backgroundImage })}
            />
            <div className="mt-1.5 pl-[124px]">
              <SliderField
                label="Opacity"
                value={draft.backgroundOpacity}
                min={0} max={1} step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(backgroundOpacity) => onChange({ backgroundOpacity })}
              />
              <CheckField
                label="Grey-scale it"
                checked={draft.backgroundGrayscale}
                onChange={(backgroundGrayscale) => onChange({ backgroundGrayscale })}
              />
              <p className="text-[10px] text-geo-muted leading-relaxed">
                The shipped scenes are drawn to be greyed to 15%. A photograph of
                your own usually wants colour and a lower opacity — code has to
                stay the most legible thing in the panel.
              </p>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-foreground mb-1.5">Theme card image</div>
            <ImageField
              label="theme card image"
              spec={ICON_SPEC}
              value={draft.iconImage}
              onChange={(iconImage) => onChange({ iconImage })}
            />
          </div>
        </div>
      </Section>

      <Section title="Preview colours">
        <p className="text-[10px] text-geo-muted leading-relaxed">
          The preview beside this form draws its code and prose with{' '}
          <span className="text-foreground">
            {resolveCodeTheme(draft.basedOn, draft.defaultCodeTheme).label}
          </span>{' '}and{' '}
          <span className="text-foreground">
            {resolveMarkdownTheme(draft.basedOn, draft.defaultMarkdownTheme).label}
          </span>
          {' '}— this theme&rsquo;s defaults. Background luminance is{' '}
          {(luminance(c.bg) * 100).toFixed(0)}%, so ouRGeo would call it a{' '}
          {luminance(c.bg) < 0.35 ? 'dark' : 'light'} theme.
        </p>
      </Section>
    </div>
  )
}
