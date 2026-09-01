// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'

// The design rests on one fact about Monaco: Monarch appends a language
// postfix to every token (`.r`, `.md`), and the theme trie walks a token's dot
// segments from the HEAD, falling back to the nearest ancestor that exists. So
// `keyword.md` splits headings from R keywords — but `keyword.table.header.md`
// resolves keyword -> table -> header and never reaches `keyword.md`. Every
// multi-segment markdown token therefore needs its own full-path rule, and a
// forgotten one is invisible: prose silently takes a code colour, for one
// construct, in one place.
//
// So this runs Monaco's real tokenizer over fixtures that exercise the whole
// markdown vocabulary, then resolves every emitted token through a faithful
// re-implementation of the trie and asserts which palette it landed in.

import { THEMES } from './themes'
import { CODE_THEMES, MARKDOWN_THEMES, buildMonacoTheme } from './editor-themes'

type Monaco = typeof import('monaco-editor')
let monaco: Monaco

const RMD = [
  '---',
  'title: Test',
  '---',
  '',
  '# Heading One',
  'Setext',
  '======',
  '',
  'Some **bold** and *em* and `inline` and a [link](http://x) plus \\* escape.',
  '',
  '> a blockquote',
  '',
  '<!-- an html comment -->',
  '',
  '<span class="x">raw html</span>',
  '',
  '***',
  '',
  '| a | b |',
  '|---|:-:|',
  '| 1 | 2 |',
  '',
  '- bullet',
  '',
  '```{r setup}',
  "#' @param pts an sf object",
  'buf <- st_buffer(pts, 250)  # trailing',
  'if (TRUE) "s" else 0x1F',
  '```',
  '',
  '```',
  'plain fence body',
  '```',
].join('\n')

const R_SRC = [
  "#' @param pts an sf object",
  'buf <- st_buffer(pts, dist = 250)  # a comment',
  'if (nrow(buf) > 0) ok <- TRUE else "none"',
  'hex <- 0x1F; v <- c(1, 2)',
].join('\n')

/** Every distinct token type the tokenizer emits for a source. */
function tokenTypes(src: string, languageId: string): string[] {
  const seen = new Set<string>()
  for (const line of monaco.editor.tokenize(src, languageId)) {
    for (const t of line) seen.add(t.type)
  }
  return [...seen]
}

// ── Monaco's ThemeTrieElement, faithfully ─────────────────────────────────
// Reproduced rather than imported: it lives in editor/common internals, which
// are not part of the public surface. Both halves matter — `insert` seeds a new
// child with its PARENT's rule (which is what makes `keyword` a fallback for
// `keyword.r`), and `match` returns the current node's rule when a segment has
// no child.
interface Node { rule: string | undefined; children: Map<string, Node> }

function split(token: string): [string, string] {
  const i = token.indexOf('.')
  return i === -1 ? [token, ''] : [token.slice(0, i), token.slice(i + 1)]
}

function insert(node: Node, token: string, fg: string | undefined): void {
  if (token === '') { node.rule = fg; return }
  const [head, tail] = split(token)
  let child = node.children.get(head)
  if (!child) { child = { rule: node.rule, children: new Map() }; node.children.set(head, child) }
  insert(child, tail, fg)
}

function match(node: Node, token: string): string | undefined {
  if (token === '') return node.rule
  const [head, tail] = split(token)
  const child = node.children.get(head)
  return child ? match(child, tail) : node.rule
}

function trieFor(codeId: string, mdId: string): Node {
  const { rules } = buildMonacoTheme(THEMES.dark, CODE_THEMES[codeId], MARKDOWN_THEMES[mdId])
  const root: Node = { rule: undefined, children: new Map() }
  // Monaco sorts lexicographically before inserting, so a parent is always in
  // place before its children clone its rule.
  for (const r of [...rules].sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0))) {
    insert(root, r.token, r.foreground)
  }
  return root
}

const strip = (h: string): string => h.replace('#', '')
const CODE_ID = 'monokai'
const MD_ID = 'vivid'
const codeColours = new Set(Object.entries(CODE_THEMES[CODE_ID])
  .filter(([k]) => !['id', 'label', 'isDark'].includes(k))
  .map(([, v]) => strip(v as string)))
const mdColours = new Set(Object.entries(MARKDOWN_THEMES[MD_ID])
  .filter(([k]) => !['id', 'label', 'isDark'].includes(k))
  .map(([, v]) => strip(v as string)))

/** Whitespace and the default token carry no colour by design. */
const isColoured = (type: string): boolean =>
  type !== '' && !type.startsWith('white')

beforeAll(async () => {
  // jsdom lacks a couple of editor-shell APIs Monaco's contributions touch at
  // import time. Neither is used by the tokenizer.
  const doc = document as unknown as Record<string, unknown>
  doc.queryCommandSupported ??= () => false
  const win = window as unknown as Record<string, unknown>
  win.matchMedia ??= () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  })

  monaco = await import('monaco-editor')
  const { registerRMarkdownLanguage } = await import('./markdown/rmarkdown-monarch')
  registerRMarkdownLanguage(monaco)

  // R is contributed lazily, so `TokenizationRegistry.get('r')` is null in this
  // environment and a chunk body would be delegated to nothing. Installing the
  // grammar synchronously is what makes the embedded half of this test real.
  const r = await import('monaco-editor/esm/vs/basic-languages/r/r.js')
  monaco.languages.register({ id: 'r' })
  monaco.languages.setMonarchTokensProvider('r', r.language)
}, 60_000)

describe('token coverage', () => {
  it('the fixtures emit both postfixes', () => {
    const types = tokenTypes(RMD, 'rmarkdown')
    expect(types.some((t) => t.endsWith('.md'))).toBe(true)
    expect(types.some((t) => t.endsWith('.r'))).toBe(true)
  })

  it('every token an .R file emits resolves to the code palette', () => {
    for (const type of tokenTypes(R_SRC, 'r').filter(isColoured)) {
      const got = match(trieFor(CODE_ID, MD_ID), type)
      expect(got, `${type} unresolved`).toBeDefined()
      expect(codeColours.has(got as string), `${type} -> ${got}`).toBe(true)
    }
  })

  it('every token an .Rmd emits resolves, and to the right palette', () => {
    const trie = trieFor(CODE_ID, MD_ID)
    const types = tokenTypes(RMD, 'rmarkdown').filter(isColoured)
    expect(types.length).toBeGreaterThan(8)

    for (const type of types) {
      const got = match(trie, type)
      expect(got, `${type} unresolved`).toBeDefined()
      if (type.endsWith('.md')) {
        // Prose. A miss here means a markdown construct is wearing a code
        // colour — exactly the failure the full-path rules exist to prevent.
        expect(mdColours.has(got as string), `${type} -> ${got} is not a markdown colour`).toBe(true)
      } else if (type.endsWith('.r')) {
        // Chunk bodies follow the CODE theme, by design.
        expect(codeColours.has(got as string), `${type} -> ${got} is not a code colour`).toBe(true)
      }
    }
  })

  it('a heading and an R keyword in the same document get different colours', () => {
    const trie = trieFor(CODE_ID, MD_ID)
    expect(match(trie, 'keyword.md')).toBe(strip(MARKDOWN_THEMES[MD_ID].heading))
    expect(match(trie, 'keyword.r')).toBe(strip(CODE_THEMES[CODE_ID].keyword))
    expect(match(trie, 'keyword.table.header.md')).toBe(strip(MARKDOWN_THEMES[MD_ID].heading))
  })
})
