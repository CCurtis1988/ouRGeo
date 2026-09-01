import React from 'react'
import { THEMES } from '@/lib/themes'
import {
  CODE_COLOR_KEYS, MD_COLOR_KEYS, contrastWarning,
  type CustomCodeTheme, type CustomMarkdownTheme,
} from '@/lib/custom-themes'
import { useThemeStore } from '@/store/theme'
import { ColorField, Section, SelectField, TextField } from './fields'

// The two flat palettes. One component, because a code theme and a markdown
// theme differ only in their key list and in the sentence beside each key —
// which is precisely the part worth writing out, since "meta" and "tag" name
// nothing a user can picture.

const CODE_LABEL: Record<string, [string, string]> = {
  fg:        ['Identifiers', 'Variable names and plain code text.'],
  comment:   ['Comments', 'Everything after #, and roxygen bodies. Rendered italic.'],
  keyword:   ['Keywords', 'if, else, function, for, repeat, return. Rendered bold.'],
  constant:  ['Constants', 'TRUE, FALSE, NULL, NA, Inf, pi.'],
  string:    ['Strings', 'Quoted text, and the quote marks themselves.'],
  number:    ['Numbers', 'Numeric and hex literals.'],
  operator:  ['Operators', '<-, %>%, ==, and arithmetic.'],
  fn:        ['Functions', 'Function and type names. Monaco’s R grammar does not emit these, so in a .R file this shows through chunks, the AI panel and Visual mode.'],
  tag:       ['Tags', 'Roxygen @param and @return, and HTML tags inside chunks.'],
  delimiter: ['Delimiters', 'Brackets, commas, semicolons.'],
  error:     ['Errors', 'Unterminated strings and other lexical errors.'],
}

const MD_LABEL: Record<string, [string, string]> = {
  text:     ['Body text', 'Prose. Source mode cannot target it — both grammars leave plain text to the app theme’s foreground — so this drives Visual mode and these previews.'],
  heading:  ['Headings', 'Headings, setext underlines, list bullets, the table header row.'],
  emphasis: ['Emphasis', 'Bold and italic.'],
  link:     ['Links', 'Link text (underlined) and targets.'],
  code:     ['Code', 'Inline code, fence lines, and fenced bodies with no language.'],
  quote:    ['Quotes', 'Blockquotes, and HTML comments.'],
  meta:     ['Meta', 'Thematic breaks, table pipes, HTML delimiters.'],
  html:     ['HTML', 'Raw HTML tags and attribute names.'],
  escape:   ['Escapes', 'Backslash escapes such as \\_ and \\*.'],
}

interface PaletteDraft {
  id: string
  label: string
  isDark: boolean
  basedOn?: string
  [k: string]: unknown
}

function PaletteForm({ draft, onChange, keys, labels, kindHint }: {
  draft: PaletteDraft
  onChange: (patch: Record<string, unknown>) => void
  keys: readonly string[]
  labels: Record<string, [string, string]>
  kindHint: string
}): React.ReactElement {
  // Contrast is judged against the editor surface of the CURRENTLY ACTIVE app
  // theme, because that is the surface this palette will be read on. A palette
  // is legible or not only in combination with a background, and the palette
  // itself deliberately carries none.
  const appId = useThemeStore((s) => s.current)
  const app = THEMES[appId] ?? THEMES.dark
  const surface = app.editorChrome.panel

  return (
    <div className="divide-y divide-geo-border">
      <Section title="Identity">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <TextField
            label="Name"
            value={draft.label}
            maxLength={40}
            onChange={(label) => onChange({ label })}
          />
          <SelectField
            label="Brightness"
            hint="Which app themes list this palette first. It changes no colour."
            value={draft.isDark ? 'dark' : 'light'}
            onChange={(v) => onChange({ isDark: v === 'dark' })}
          >
            <option value="dark">For dark themes</option>
            <option value="light">For light themes</option>
          </SelectField>
        </div>
      </Section>

      <Section title="Colours" hint={kindHint}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(232px,1fr))] gap-x-5">
          {keys.map((k) => (
            <ColorField
              key={k}
              label={labels[k][0]}
              hint={labels[k][1]}
              value={String(draft[k] ?? '#000000')}
              warn={contrastWarning(String(draft[k] ?? '#000000'), surface, labels[k][0])}
              onChange={(hex) => onChange({ [k]: hex })}
            />
          ))}
        </div>
        <p className="text-[10px] text-geo-muted leading-relaxed mt-2">
          Contrast is measured against <span className="text-foreground">{app.label}</span>&rsquo;s
          editor background, the surface you are reading code on right now. A palette
          carries no background of its own — that is the guarantee that switching one
          never moves the editor.
        </p>
      </Section>
    </div>
  )
}

export function CodeThemeEditor({ draft, onChange }: {
  draft: CustomCodeTheme
  onChange: (patch: Partial<CustomCodeTheme>) => void
}): React.ReactElement {
  return (
    <PaletteForm
      draft={draft as unknown as PaletteDraft}
      onChange={onChange as (p: Record<string, unknown>) => void}
      keys={CODE_COLOR_KEYS}
      labels={CODE_LABEL}
      kindHint={
        'Syntax colours for R — in .R files, in R Markdown chunks, and in every ' +
        'other embedded language, which falls through to these same rules.'
      }
    />
  )
}

export function MarkdownThemeEditor({ draft, onChange }: {
  draft: CustomMarkdownTheme
  onChange: (patch: Partial<CustomMarkdownTheme>) => void
}): React.ReactElement {
  return (
    <PaletteForm
      draft={draft as unknown as PaletteDraft}
      onChange={onChange as (p: Record<string, unknown>) => void}
      keys={MD_COLOR_KEYS}
      labels={MD_LABEL}
      kindHint={
        'Prose colours for .md, .Rmd and .qmd, in both Source and Visual mode. ' +
        'Code inside a chunk follows the code theme, not this one.'
      }
    />
  )
}
