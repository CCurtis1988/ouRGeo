import React from 'react'
import type { SyntaxPalette, MarkdownPalette } from '@/lib/editor-themes'

// A hand-tokenized sample, rendered as coloured spans. No Monaco and no
// tokenizer: the picker has to draw 40-odd of these, and a real editor per card
// would be absurd. The fixtures are chosen to exercise the palette entries a
// reader would actually recognise.

type CodeKey = Exclude<keyof SyntaxPalette, 'id' | 'label' | 'isDark'>
type MdKey = Exclude<keyof MarkdownPalette, 'id' | 'label' | 'isDark'>

type Run<K> = [K | null, string]

const CODE_SAMPLE: Array<Array<Run<CodeKey>>> = [
  [['comment', "#' "], ['tag', '@param'], ['comment', ' pts an sf object']],
  [
    ['fg', 'buf '], ['operator', '<- '], ['fn', 'st_buffer'], ['delimiter', '('],
    ['fg', 'pts'], ['delimiter', ', '], ['fg', 'dist '], ['operator', '= '],
    ['number', '250'], ['delimiter', ')'],
  ],
  [
    ['keyword', 'if'], ['delimiter', ' ('], ['fn', 'nrow'], ['delimiter', '('],
    ['fg', 'buf'], ['delimiter', ') '], ['operator', '> '], ['number', '0'],
    ['delimiter', ') '], ['fg', 'ok '], ['operator', '<- '], ['constant', 'TRUE'],
    [null, ' '], ['keyword', 'else'], [null, ' '], ['string', '"none"'],
  ],
]

const MD_SAMPLE: Array<Array<Run<MdKey>>> = [
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

function Sample<K extends string>({ lines, colors }: {
  lines: Array<Array<Run<K>>>
  colors: Record<K, string>
}): React.ReactElement {
  return (
    // The surface is the APP theme's panel colour, never the palette's — which
    // is exactly the promise the picker is making.
    <pre
      className="bg-geo-bg rounded px-2 py-1.5 text-[9px] leading-[1.45]
        font-mono overflow-hidden whitespace-pre"
      aria-hidden
    >
      {lines.map((runs, i) => (
        <div key={i} className="truncate">
          {runs.map(([key, text], j) => (
            <span key={j} style={key ? { color: colors[key] } : undefined}>{text}</span>
          ))}
        </div>
      ))}
    </pre>
  )
}

export function CodePreview({ palette }: { palette: SyntaxPalette }): React.ReactElement {
  return <Sample lines={CODE_SAMPLE} colors={palette as unknown as Record<CodeKey, string>} />
}

export function MarkdownPreview({ palette }: { palette: MarkdownPalette }): React.ReactElement {
  return <Sample lines={MD_SAMPLE} colors={palette as unknown as Record<MdKey, string>} />
}
