import React from 'react'
import type { EditorChrome } from '@/lib/themes'
import type { SyntaxPalette, MarkdownPalette } from '@/lib/editor-themes'
import type { SystemColors } from '@/lib/custom-themes'

// A miniature ouRGeo, painted from a DRAFT rather than from the live theme.
//
// The studio needs to show a colour the instant it changes, and applying every
// drag of a colour picker to the real application would mean a Monaco
// `defineTheme` per frame (see the deps note on that effect in CodeEditor).
// So the preview is a self-contained mock drawn with inline styles: it shares
// no CSS custom properties with the app, takes every colour as a prop, and is
// therefore also the only way to look at a theme you have NOT switched to.
//
// The sample text is chosen to exercise the palette entries a reader can name.
// Everything on screen is a token someone is about to go and pick a colour for.

type CodeRun = [keyof SyntaxPalette | null, string]
type MdRun = [keyof MarkdownPalette | null, string]

const CODE_LINES: CodeRun[][] = [
  [['comment', "#' "], ['tag', '@param'], ['comment', ' pts sample locations']],
  [
    ['fg', 'buf '], ['operator', '<- '], ['fn', 'st_buffer'], ['delimiter', '('],
    ['fg', 'pts'], ['delimiter', ', '], ['fg', 'dist '], ['operator', '= '],
    ['number', '250'], ['delimiter', ')'],
  ],
  [
    ['keyword', 'if'], ['delimiter', ' ('], ['fn', 'nrow'], ['delimiter', '('],
    ['fg', 'buf'], ['delimiter', ') '], ['operator', '> '], ['number', '0'],
    ['delimiter', ') '], ['fg', 'ok '], ['operator', '<- '], ['constant', 'TRUE'],
  ],
  [
    ['keyword', 'else'], [null, ' '], ['fn', 'stop'], ['delimiter', '('],
    ['string', '"empty buffer"'], ['delimiter', ')'],
  ],
]

const MD_LINES: MdRun[][] = [
  [['heading', '## Results']],
  [
    ['text', 'Buffered '], ['emphasis', '**250 m**'], ['text', ', then '],
    ['emphasis', '*joined*'], ['text', '.'],
  ],
  [['quote', '> 12 features dropped.']],
  [
    ['heading', '- '], ['code', '`st_buffer()`'], ['text', ' — '],
    ['link', '[docs](#)'],
  ],
]

function Lines<K extends string>({ lines, colors }: {
  lines: Array<Array<[K | null, string]>>
  colors: Record<K, string>
}): React.ReactElement {
  return (
    <>
      {lines.map((runs, i) => (
        <div key={i} className="whitespace-pre">
          {runs.map(([k, text], j) => (
            <span key={j} style={k ? { color: colors[k] } : undefined}>{text}</span>
          ))}
        </div>
      ))}
    </>
  )
}

export interface PreviewInput {
  colors: SystemColors
  chrome: EditorChrome
  code: SyntaxPalette
  markdown: MarkdownPalette
  backdrop: string | null
  backdropOpacity: number
  backdropGrayscale: boolean
}

/** A pill in the mock toolbar. */
function Chip({ text, fg, bg, border }: {
  text: string; fg: string; bg?: string; border: string
}): React.ReactElement {
  return (
    <span
      className="text-[8px] px-1.5 py-[2px] rounded leading-none"
      style={{ color: fg, background: bg, border: `1px solid ${border}` }}
    >
      {text}
    </span>
  )
}

export function ThemePreview({ input, className = '' }: {
  input: PreviewInput
  className?: string
}): React.ReactElement {
  const { colors: c, chrome, code, markdown, backdrop } = input
  return (
    <div
      className={`rounded-lg overflow-hidden border select-none ${className}`}
      style={{ borderColor: c.border, background: c.bg }}
      aria-hidden
    >
      {/* Toolbar — accent, muted and the three status colours, in the roles
          they actually occupy in the app. */}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 border-b"
        style={{ background: c.panel, borderColor: c.border }}
      >
        <span
          className="w-3.5 h-3.5 rounded-sm shrink-0"
          style={{ background: c.accent }}
        />
        <span className="text-[9px] font-medium" style={{ color: c.fg }}>ouRGeo</span>
        <span className="flex-1" />
        <Chip text="R ready" fg={c.success} border={c.border} />
        <Chip text="2 warnings" fg={c.warning} border={c.border} />
        <Chip text="1 error" fg={c.error} border={c.border} />
      </div>

      <div className="flex" style={{ height: 208 }}>
        {/* Left rail — the muted/foreground pair that most of the interface is
            actually made of, plus one selected row on the accent. */}
        <div
          className="w-[86px] shrink-0 border-r p-1.5 flex flex-col gap-1"
          style={{ background: c.panel, borderColor: c.border }}
        >
          {['Environment', 'Packages', 'Help'].map((t, i) => (
            <div
              key={t}
              className="text-[8px] px-1.5 py-1 rounded truncate"
              style={i === 0
                ? { color: c.accent, background: `${c.accent}22` }
                : { color: c.muted }}
            >
              {t}
            </div>
          ))}
          <div className="mt-auto flex flex-col gap-1">
            <div
              className="text-[8px] px-1.5 py-1 rounded text-center"
              style={{ background: c.accent, color: c.bg }}
            >
              Run
            </div>
            <div
              className="text-[8px] px-1.5 py-1 rounded text-center border"
              style={{ borderColor: c.border, color: c.fg }}
            >
              Knit
            </div>
          </div>
        </div>

        {/* Editor — the chrome palette, with the backdrop behind the text
            exactly as CodeEditor paints it. */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            className="flex items-stretch border-b text-[8px]"
            style={{ background: c.panel, borderColor: chrome.border }}
          >
            <span
              className="px-2 py-1 border-r"
              style={{
                background: chrome.panel, color: chrome.fg,
                borderColor: chrome.border,
                boxShadow: `inset 0 -2px 0 ${chrome.accent}`,
              }}
            >
              analysis.R
            </span>
            <span className="px-2 py-1" style={{ color: c.muted }}>report.Rmd</span>
          </div>

          <div className="relative flex-1 min-h-0" style={{ background: chrome.panel }}>
            {backdrop && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: `url("${backdrop}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: input.backdropGrayscale ? 'grayscale(1)' : 'none',
                  opacity: input.backdropOpacity,
                }}
              />
            )}
            <div className="relative h-full overflow-hidden px-1.5 py-1.5 flex gap-1.5">
              <div
                className="text-[8px] leading-[1.6] font-mono text-right pr-1 shrink-0"
                style={{ color: chrome.muted }}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <div key={n}>{n}</div>)}
              </div>
              <div className="min-w-0 flex-1 text-[8px] leading-[1.6] font-mono overflow-hidden">
                <Lines lines={CODE_LINES} colors={code as unknown as Record<string, string>} />
                <div style={{ color: chrome.fg }}>&nbsp;</div>
                <Lines lines={MD_LINES} colors={markdown as unknown as Record<string, string>} />
              </div>
            </div>
          </div>

          {/* Console — the one place the editor foreground and the interface
              foreground sit a few pixels apart, which is where a mismatch
              between the two palettes shows up first. */}
          <div
            className="border-t px-2 py-1 text-[8px] font-mono leading-[1.6]"
            style={{ background: c.bg, borderColor: c.border }}
          >
            <div style={{ color: c.muted }}>&gt; nrow(buf)</div>
            <div style={{ color: c.fg }}>[1] 128</div>
            <div style={{ color: c.error }}>Error: object &lsquo;pts&rsquo; not found</div>
          </div>
        </div>
      </div>
    </div>
  )
}
