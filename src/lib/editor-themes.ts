// ── Editor themes ─────────────────────────────────────────────────────────
//
// The code editor's syntax colours and the markdown editor's prose colours are
// picked independently of the app theme. What they must NOT touch is the
// surface the text sits on: the editor's background colour and the faint scene
// art behind it belong to the app theme alone (see `CodeEditor.tsx`, where a
// `bg-geo-panel` layer and `sceneDataUri(themeId)` sit beneath a deliberately
// transparent Monaco). So a palette here carries token colours and nothing
// else, and `buildMonacoTheme` reads its `colors` block only from the app
// theme. That is the whole guarantee, and `editor-themes.test.ts` enforces it.
//
// ── How one Monaco theme carries two palettes ──────────────────────────────
//
// Monarch appends `lexer.tokenPostfix` to every token it emits: `.r` for
// Monaco's R grammar, `.md` for its markdown grammar — and for our derived
// `rmarkdown` grammar too, since `rmarkdown-monarch.ts` spreads the markdown
// language. Monaco's theme resolution ignores the language id
// (`TokenTheme.match` uses it only for metadata bits), so that postfix is the
// only thing that distinguishes an R `keyword` from a markdown heading. It is
// enough: one theme holds both palettes and nothing has to swap on tab change.
//
// The catch is that the postfix is a SUFFIX, not a namespace. Monaco's
// `ThemeTrieElement.match` walks dot segments from the head and falls back to
// the nearest ancestor that exists, so `keyword.table.header.md` resolves
// keyword -> table -> header -> (no `md` child) and lands on the
// `keyword.table.header` rule. It never reaches `keyword.md`. Every
// multi-segment markdown token therefore needs its own full-path rule; a
// forgotten one silently takes the CODE palette's colour, for one construct
// only. `editor-themes-tokens.test.ts` tokenizes real fixtures and checks every
// emitted token against the trie for exactly this reason.

import { THEMES, BUILTIN_THEME_LIST, type ThemeDef } from './themes'

/** One Monaco theme name, redefined whenever any of the three inputs change.
 *  Monaco's `defineTheme` re-applies live when it replaces the active theme, so
 *  there is no need to compose a name per combination (and it could not be done
 *  anyway — theme names must match /^[a-z0-9-]+$/i). */
export const EDITOR_MONACO_THEME = 'ourgeo-editor'

export interface MonacoThemeDef {
  base: 'vs' | 'vs-dark'
  colors: Record<string, string>
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>
}

/** Syntax colours for code — R first, but every rule is also emitted bare so
 *  embedded chunk languages (python, sql, yaml…) follow the same palette. */
export interface SyntaxPalette {
  id: string
  label: string
  isDark: boolean
  /** Set on palettes the user built in the Theme Studio; see `custom-themes.ts`
   *  for why a user palette is a plain `SyntaxPalette` and not a subtype. */
  custom?: true
  /** The palette this one was started from. Recorded so an exported file says
   *  where it came from; nothing resolves through it. */
  basedOn?: string
  /** Identifiers and plain code text. */
  fg: string
  comment: string
  keyword: string
  /** TRUE / FALSE / NULL / NA / Inf / pi */
  constant: string
  string: string
  number: string
  /** `<-`, `%>%`, `==` … */
  operator: string
  /** Function and type names. Monaco's R grammar does not emit these, so in a
   *  .R file this shows only through embedded chunks and highlight.js. */
  fn: string
  /** Roxygen `@param`, HTML tags. */
  tag: string
  delimiter: string
  error: string
}

/** Prose colours for markdown and R Markdown. */
export interface MarkdownPalette {
  id: string
  label: string
  isDark: boolean
  custom?: true
  basedOn?: string
  /** Body prose. NOT reachable in Monaco — both grammars set
   *  `defaultToken: ''`, and Monaco turns `editor.foreground` into the `''`
   *  rule ahead of ours, so source-mode prose is always the app theme's
   *  foreground. This drives Visual mode and the picker preview only. */
  text: string
  /** Headings, setext underlines, list bullets, the table divider row. */
  heading: string
  emphasis: string
  link: string
  /** Inline code, fence lines, and fenced bodies with no embedded language. */
  code: string
  /** Blockquotes and HTML comments. */
  quote: string
  /** Thematic breaks, table pipes, HTML delimiters. */
  meta: string
  html: string
  escape: string
}

const strip = (h: string): string => h.replace('#', '')

type Rule = { token: string; foreground?: string; fontStyle?: string }

const r = (token: string, hex: string, fontStyle?: string): Rule =>
  fontStyle ? { token, foreground: strip(hex), fontStyle } : { token, foreground: strip(hex) }

/**
 * Compose the one Monaco theme.
 *
 * `colors` comes from the app theme and ONLY the app theme; `rules` come from
 * the two palettes and never carry a background. That split is what lets a code
 * theme change without the editor surface moving.
 */
export function buildMonacoTheme(
  system: ThemeDef, code: SyntaxPalette, md: MarkdownPalette,
): MonacoThemeDef {
  const c = system.editorChrome
  return {
    base: system.isDark ? 'vs-dark' : 'vs',
    colors: {
      'editor.background': c.panel,
      'editor.foreground': c.fg,
      'editorLineNumber.foreground': c.muted,
      'editorLineNumber.activeForeground': c.fg,
      'editor.lineHighlightBackground': c.bg,
      'editorCursor.foreground': c.accent,
      'editor.selectionBackground': c.accent + '40',
      'editorGutter.background': c.panel,
      'scrollbarSlider.background': c.border + '80',
      'editorIndentGuide.background1': c.border,
      'editorIndentGuide.activeBackground1': c.muted,
    },
    rules: [
      // ── Bare rules: the code palette ──────────────────────────────────────
      // These do double duty. They colour R, and they are what every embedded
      // chunk language falls through to — which is how "chunks follow the code
      // theme" is implemented. They also restate the tokens the inherited
      // vs/vs-dark base defines, which would otherwise leak VS Code's own
      // colours into .Rmd html/sql/yaml chunks.
      r('comment', code.comment, 'italic'),
      r('comment.doc', code.comment, 'italic'),
      r('keyword', code.keyword, 'bold'),
      r('keyword.flow', code.keyword, 'bold'),
      r('keyword.json', code.keyword),
      r('string', code.string),
      r('string.sql', code.string),
      r('string.yaml', code.string),
      r('string.html', code.string),
      r('string.value.json', code.string),
      // In R this token is the quote characters themselves. Painting them with
      // the string colour is the point; they used to take the number colour.
      r('string.escape', code.string),
      r('string.key.json', code.fn),
      r('regexp', code.string),
      r('number', code.number),
      r('number.hex', code.number),
      r('constant', code.constant),
      r('variable.predefined', code.constant),
      r('identifier', code.fg),
      r('variable', code.fg),
      r('type', code.fn),
      r('type.identifier', code.fn),
      r('identifier.function', code.fn),
      r('predefined', code.fn),
      r('predefined.sql', code.fn),
      r('key', code.fn),
      r('attribute.name', code.fn),
      r('attribute.value', code.string),
      r('operator', code.operator),
      r('operator.sql', code.operator),
      r('delimiter', code.delimiter),
      r('delimiter.html', code.delimiter),
      r('delimiter.xml', code.delimiter),
      r('tag', code.tag),
      r('metatag', code.tag),
      r('annotation', code.tag),
      r('invalid', code.error),
      r('error-token', code.error),

      // ── R (.r) ────────────────────────────────────────────────────────────
      // Redundant against the bare rules above by Monaco's trie fallback, but
      // written out so the grammar's actual vocabulary is visible here and a
      // future bare rule meant for prose cannot quietly recolour R.
      r('keyword.r', code.keyword, 'bold'),
      r('constant.r', code.constant),
      r('identifier.r', code.fg),
      r('number.r', code.number),
      r('number.hex.r', code.number),
      r('string.r', code.string),
      r('string.escape.r', code.string),
      r('operator.r', code.operator),
      r('comment.r', code.comment, 'italic'),
      r('comment.doc.r', code.comment, 'italic'),
      r('tag.r', code.tag),
      r('delimiter.r', code.delimiter),
      r('error-token.r', code.error),

      // ── Markdown (.md) ────────────────────────────────────────────────────
      // Every token Monaco's markdown grammar (and our derived rmarkdown one)
      // emits, each spelled as a FULL path — see the note at the top of the
      // file for why a `keyword.md` rule cannot cover `keyword.table.header.md`.
      r('keyword.md', md.heading, 'bold'),
      r('keyword.table.header.md', md.heading, 'bold'),
      r('keyword.table.left.md', md.meta),
      r('keyword.table.middle.md', md.meta),
      r('keyword.table.right.md', md.meta),
      // `***` thematic breaks. NOT YAML front matter: `---` matches the setext
      // rule first and comes through as `keyword`.
      r('meta.separator.md', md.meta),
      r('comment.md', md.quote, 'italic'),
      r('comment.content.md', md.quote, 'italic'),
      r('comment.content.invalid.md', md.quote, 'italic'),
      r('string.md', md.code),
      r('variable.md', md.code),
      r('variable.source.md', md.code),
      r('string.link.md', md.link, 'underline'),
      r('string.target.md', md.link),
      r('string.escape.md', md.escape),
      r('escape.md', md.escape),
      r('strong.md', md.emphasis, 'bold'),
      r('emphasis.md', md.emphasis, 'italic'),
      r('tag.md', md.html),
      r('attribute.name.html.md', md.html),
      r('string.html.md', md.html),
      r('delimiter.html.md', md.meta),
    ],
  }
}

// ── The app themes, ported ────────────────────────────────────────────────
// Each app theme's own syntax colours become a code theme and a markdown theme
// carrying its id and label, so `defaultCodeTheme` reads naturally and the
// out-of-the-box look is unchanged. The five colours below are exactly what
// each theme used to hand to the old `mkMonaco` in `themes.ts`.

interface LegacyFive { str: string; cmt: string; kw: string; num: string; fn: string }

const LEGACY: Record<string, LegacyFive> = {
  dark:           { str: '#e6c47a', cmt: '#5c7a9e', kw: '#79c9d9', num: '#f0a070', fn: '#b088d8' },
  bespin:         { str: '#d4a96a', cmt: '#7d8a4f', kw: '#f4a83a', num: '#d4b880', fn: '#d88a50' },
  neonLights:     { str: '#ff0088', cmt: '#006666', kw: '#00ff88', num: '#ffff00', fn: '#ff00ff' },
  forest:         { str: '#a8cc80', cmt: '#4a6e4e', kw: '#5eaa62', num: '#c9b850', fn: '#5abf88' },
  midnightDream:  { str: '#b899dd', cmt: '#4456aa', kw: '#9966e6', num: '#55ccbb', fn: '#6699ff' },
  candyAddiction: { str: '#ff88aa', cmt: '#6633aa', kw: '#ff1a66', num: '#ffcc00', fn: '#cc66ff' },
  heaven:         { str: '#1a5599', cmt: '#7a8fa8', kw: '#1a8080', num: '#cc5500', fn: '#4455aa' },
  volcanic:       { str: '#ff9940', cmt: '#6e4020', kw: '#ff6600', num: '#ffc040', fn: '#e08030' },
  arctic:         { str: '#88d8ee', cmt: '#3a7088', kw: '#29c4e6', num: '#aa88cc', fn: '#35b8b8' },
  retroTerminal:  { str: '#00ff00', cmt: '#2d5c30', kw: '#aaff00', num: '#ffff00', fn: '#00ff88' },
}

// `constant`, `operator`, `tag` and `delimiter` had no rule at all before, so
// TRUE/NA, `%>%` and roxygen tags fell through to VS Code's base theme and
// rendered as plain identifiers. Deriving them is a deliberate small change.
function portCode(t: ThemeDef): SyntaxPalette {
  const L = LEGACY[t.id]
  return {
    id: t.id, label: t.label, isDark: t.isDark,
    fg: t.editorChrome.fg,
    comment: L.cmt, keyword: L.kw, constant: L.num, string: L.str, number: L.num,
    operator: t.editorChrome.fg, fn: L.fn, tag: L.kw,
    delimiter: t.editorChrome.fg, error: t.palette.error,
  }
}

function portMarkdown(t: ThemeDef): MarkdownPalette {
  const L = LEGACY[t.id]
  return {
    id: t.id, label: t.label, isDark: t.isDark,
    text: t.editorChrome.fg,
    heading: L.kw, emphasis: t.editorChrome.fg, link: t.editorChrome.accent,
    code: L.str, quote: L.cmt, meta: L.cmt, html: L.kw, escape: L.num,
  }
}

type CodeColors = Omit<SyntaxPalette, 'id' | 'label' | 'isDark'>
type MdColors = Omit<MarkdownPalette, 'id' | 'label' | 'isDark'>

const mkCode = (id: string, label: string, isDark: boolean, c: CodeColors): SyntaxPalette =>
  ({ id, label, isDark, ...c })
const mkMd = (id: string, label: string, isDark: boolean, c: MdColors): MarkdownPalette =>
  ({ id, label, isDark, ...c })

// ── Code themes ───────────────────────────────────────────────────────────

const EXTRA_CODE: SyntaxPalette[] = [
  mkCode('oneDark', 'One Dark', true, {
    fg: '#abb2bf', comment: '#5c6370', keyword: '#c678dd', constant: '#d19a66',
    string: '#98c379', number: '#d19a66', operator: '#56b6c2', fn: '#61afef',
    tag: '#e06c75', delimiter: '#abb2bf', error: '#e06c75',
  }),
  mkCode('oneLight', 'One Light', false, {
    fg: '#383a42', comment: '#a0a1a7', keyword: '#a626a4', constant: '#986801',
    string: '#50a14f', number: '#986801', operator: '#0184bc', fn: '#4078f2',
    tag: '#e45649', delimiter: '#383a42', error: '#e45649',
  }),
  mkCode('dracula', 'Dracula', true, {
    fg: '#f8f8f2', comment: '#6272a4', keyword: '#ff79c6', constant: '#bd93f9',
    string: '#f1fa8c', number: '#bd93f9', operator: '#ff79c6', fn: '#50fa7b',
    tag: '#8be9fd', delimiter: '#f8f8f2', error: '#ff5555',
  }),
  mkCode('nord', 'Nord', true, {
    fg: '#d8dee9', comment: '#616e88', keyword: '#81a1c1', constant: '#81a1c1',
    string: '#a3be8c', number: '#b48ead', operator: '#81a1c1', fn: '#88c0d0',
    tag: '#8fbcbb', delimiter: '#eceff4', error: '#bf616a',
  }),
  mkCode('solarizedDark', 'Solarized Dark', true, {
    fg: '#839496', comment: '#586e75', keyword: '#859900', constant: '#2aa198',
    string: '#2aa198', number: '#d33682', operator: '#859900', fn: '#268bd2',
    tag: '#b58900', delimiter: '#93a1a1', error: '#dc322f',
  }),
  mkCode('solarizedLight', 'Solarized Light', false, {
    fg: '#657b83', comment: '#93a1a1', keyword: '#859900', constant: '#2aa198',
    string: '#2aa198', number: '#d33682', operator: '#859900', fn: '#268bd2',
    tag: '#b58900', delimiter: '#586e75', error: '#dc322f',
  }),
  mkCode('monokai', 'Monokai', true, {
    fg: '#f8f8f2', comment: '#75715e', keyword: '#f92672', constant: '#ae81ff',
    string: '#e6db74', number: '#ae81ff', operator: '#f92672', fn: '#a6e22e',
    tag: '#66d9ef', delimiter: '#f8f8f2', error: '#f92672',
  }),
  mkCode('gruvboxDark', 'Gruvbox Dark', true, {
    fg: '#ebdbb2', comment: '#928374', keyword: '#fb4934', constant: '#d3869b',
    string: '#b8bb26', number: '#d3869b', operator: '#8ec07c', fn: '#fabd2f',
    tag: '#83a598', delimiter: '#ebdbb2', error: '#fb4934',
  }),
  mkCode('gruvboxLight', 'Gruvbox Light', false, {
    fg: '#3c3836', comment: '#928374', keyword: '#9d0006', constant: '#8f3f71',
    string: '#79740e', number: '#8f3f71', operator: '#427b58', fn: '#b57614',
    tag: '#076678', delimiter: '#3c3836', error: '#9d0006',
  }),
  mkCode('tokyoNight', 'Tokyo Night', true, {
    fg: '#a9b1d6', comment: '#565f89', keyword: '#bb9af7', constant: '#ff9e64',
    string: '#9ece6a', number: '#ff9e64', operator: '#89ddff', fn: '#7aa2f7',
    tag: '#f7768e', delimiter: '#a9b1d6', error: '#f7768e',
  }),
  mkCode('githubDark', 'GitHub Dark', true, {
    fg: '#c9d1d9', comment: '#8b949e', keyword: '#ff7b72', constant: '#79c0ff',
    string: '#a5d6ff', number: '#79c0ff', operator: '#ff7b72', fn: '#d2a8ff',
    tag: '#7ee787', delimiter: '#c9d1d9', error: '#ffa198',
  }),
  mkCode('githubLight', 'GitHub Light', false, {
    fg: '#24292f', comment: '#6e7781', keyword: '#cf222e', constant: '#0550ae',
    string: '#0a3069', number: '#0550ae', operator: '#cf222e', fn: '#8250df',
    tag: '#116329', delimiter: '#24292f', error: '#82071e',
  }),
  mkCode('catppuccinMocha', 'Catppuccin Mocha', true, {
    fg: '#cdd6f4', comment: '#6c7086', keyword: '#cba6f7', constant: '#fab387',
    string: '#a6e3a1', number: '#fab387', operator: '#89dceb', fn: '#89b4fa',
    tag: '#f38ba8', delimiter: '#bac2de', error: '#f38ba8',
  }),
  mkCode('catppuccinLatte', 'Catppuccin Latte', false, {
    fg: '#4c4f69', comment: '#9ca0b0', keyword: '#8839ef', constant: '#fe640b',
    string: '#40a02b', number: '#fe640b', operator: '#04a5e5', fn: '#1e66f5',
    tag: '#d20f39', delimiter: '#5c5f77', error: '#d20f39',
  }),
  mkCode('nightOwl', 'Night Owl', true, {
    fg: '#d6deeb', comment: '#637777', keyword: '#c792ea', constant: '#ff5874',
    string: '#ecc48d', number: '#f78c6c', operator: '#7fdbca', fn: '#82aaff',
    tag: '#addb67', delimiter: '#d6deeb', error: '#ef5350',
  }),
  mkCode('everforest', 'Everforest Dark', true, {
    fg: '#d3c6aa', comment: '#7a8478', keyword: '#e67e80', constant: '#d699b6',
    string: '#a7c080', number: '#d699b6', operator: '#83c092', fn: '#a7c080',
    tag: '#dbbc7f', delimiter: '#d3c6aa', error: '#e67e80',
  }),
]

// ── Markdown themes ───────────────────────────────────────────────────────

const EXTRA_MARKDOWN: MarkdownPalette[] = [
  mkMd('prose', 'Prose', true, {
    text: '#d6d3cd', heading: '#e8b96a', emphasis: '#e8e4dd', link: '#7fb3d5',
    code: '#c3a6d9', quote: '#8a8578', meta: '#6f6a60', html: '#a89c8a', escape: '#c98a5a',
  }),
  mkMd('ink', 'Ink', false, {
    text: '#2b2b2b', heading: '#111111', emphasis: '#000000', link: '#0b5fa5',
    code: '#8a4b00', quote: '#6b6b6b', meta: '#9a9a9a', html: '#7a7a7a', escape: '#aa3333',
  }),
  mkMd('notion', 'Notion', true, {
    text: '#d4d4d4', heading: '#ffffff', emphasis: '#ffffff', link: '#529cca',
    code: '#eb5757', quote: '#9b9a97', meta: '#6f6f6f', html: '#9b9a97', escape: '#c9a227',
  }),
  mkMd('typewriter', 'Typewriter', true, {
    text: '#c8c093', heading: '#dca561', emphasis: '#e6c384', link: '#7fb4ca',
    code: '#98bb6c', quote: '#727169', meta: '#54546d', html: '#957fb8', escape: '#ffa066',
  }),
  mkMd('vivid', 'Vivid', true, {
    text: '#e6e6e6', heading: '#ff7edb', emphasis: '#fede5d', link: '#36f9f6',
    code: '#72f1b8', quote: '#848bbd', meta: '#495495', html: '#fe4450', escape: '#ff8b39',
  }),
  mkMd('githubMd', 'GitHub', false, {
    text: '#1f2328', heading: '#1f2328', emphasis: '#1f2328', link: '#0969da',
    code: '#cf222e', quote: '#59636e', meta: '#818b98', html: '#116329', escape: '#953800',
  }),
]

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> =>
  Object.fromEntries(xs.map((x) => [x.id, x]))

const BUILTIN_CODE: Record<string, SyntaxPalette> = byId([
  ...BUILTIN_THEME_LIST.map(portCode), ...EXTRA_CODE,
])
const BUILTIN_MD: Record<string, MarkdownPalette> = byId([
  ...BUILTIN_THEME_LIST.map(portMarkdown), ...EXTRA_MARKDOWN,
])

/** The palettes ouRGeo ships. Never mutated. */
export const BUILTIN_CODE_THEMES: Readonly<Record<string, SyntaxPalette>> = BUILTIN_CODE
export const BUILTIN_MARKDOWN_THEMES: Readonly<Record<string, MarkdownPalette>> = BUILTIN_MD

/** The LIVE registries — shipped palettes plus the user's. See the note on
 *  `THEMES` in `themes.ts`: same shape, same reason, same single writer. */
export const CODE_THEMES: Record<string, SyntaxPalette> = { ...BUILTIN_CODE }
export const MARKDOWN_THEMES: Record<string, MarkdownPalette> = { ...BUILTIN_MD }

/** Shipped-only lists. `codeThemeList()` / `markdownThemeList()` are the live
 *  ones; these exist because the picker draws its "Built in" group from them
 *  and the palette tests assert on what ships, not on what a user has made. */
export const CODE_THEME_LIST: SyntaxPalette[] = Object.values(BUILTIN_CODE)
export const MARKDOWN_THEME_LIST: MarkdownPalette[] = Object.values(BUILTIN_MD)

export function codeThemeList(): SyntaxPalette[] {
  return Object.values(CODE_THEMES)
}

export function markdownThemeList(): MarkdownPalette[] {
  return Object.values(MARKDOWN_THEMES)
}

/** Replace every user palette with these, in one pass. Idempotent, and a
 *  shipped id can never be shadowed — see `registerCustomThemes`. */
export function registerCustomEditorThemes(
  code: SyntaxPalette[], md: MarkdownPalette[],
): void {
  for (const id of Object.keys(CODE_THEMES)) {
    if (!(id in BUILTIN_CODE)) delete CODE_THEMES[id]
  }
  for (const id of Object.keys(MARKDOWN_THEMES)) {
    if (!(id in BUILTIN_MD)) delete MARKDOWN_THEMES[id]
  }
  for (const p of code) if (!(p.id in BUILTIN_CODE)) CODE_THEMES[p.id] = p
  for (const p of md) if (!(p.id in BUILTIN_MD)) MARKDOWN_THEMES[p.id] = p
}

/** Resolve an id, falling back to the app theme's default and finally to Dark,
 *  so a stale or hand-edited `theme.json` can never leave the editor unstyled. */
export function resolveCodeTheme(systemId: string, codeId: string): SyntaxPalette {
  const sys = THEMES[systemId] ?? THEMES.dark
  return CODE_THEMES[codeId] ?? CODE_THEMES[sys.defaultCodeTheme] ?? CODE_THEMES.dark
}

export function resolveMarkdownTheme(systemId: string, mdId: string): MarkdownPalette {
  const sys = THEMES[systemId] ?? THEMES.dark
  return MARKDOWN_THEMES[mdId] ?? MARKDOWN_THEMES[sys.defaultMarkdownTheme] ?? MARKDOWN_THEMES.dark
}

/** The palettes as CSS custom properties, for the surfaces Monaco does not
 *  paint: highlight.js (Visual-mode chunks, AI chat code blocks) and Visual
 *  mode's prose. Values are complete colours, not the bare HSL triples the
 *  `--geo-*` vars use — the palettes are ports of themes authored in hex and
 *  every consumer only needs `color:`. For alpha, use `color-mix()`. */
export function editorThemeVars(
  code: SyntaxPalette, md: MarkdownPalette,
): Record<string, string> {
  return {
    '--ourgeo-code-fg': code.fg,
    '--ourgeo-code-comment': code.comment,
    '--ourgeo-code-keyword': code.keyword,
    '--ourgeo-code-constant': code.constant,
    '--ourgeo-code-string': code.string,
    '--ourgeo-code-number': code.number,
    '--ourgeo-code-operator': code.operator,
    '--ourgeo-code-fn': code.fn,
    '--ourgeo-code-tag': code.tag,
    '--ourgeo-code-delimiter': code.delimiter,
    '--ourgeo-code-error': code.error,
    '--ourgeo-md-text': md.text,
    '--ourgeo-md-heading': md.heading,
    '--ourgeo-md-emphasis': md.emphasis,
    '--ourgeo-md-link': md.link,
    '--ourgeo-md-code': md.code,
    '--ourgeo-md-quote': md.quote,
    '--ourgeo-md-meta': md.meta,
    '--ourgeo-md-html': md.html,
    '--ourgeo-md-escape': md.escape,
  }
}

/** Sibling of `applyTheme` — kept separate so `themes.ts` needs no dependency
 *  on the editor registries and its one-argument contract (which the plot
 *  popout relies on) stays intact. */
export function applyEditorTheme(systemId: string, codeId: string, mdId: string): void {
  const vars = editorThemeVars(
    resolveCodeTheme(systemId, codeId),
    resolveMarkdownTheme(systemId, mdId),
  )
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
}
