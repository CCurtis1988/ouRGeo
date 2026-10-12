import { describe, it, expect } from 'vitest'
import { THEMES } from './themes'
import {
  CODE_THEMES, MARKDOWN_THEMES, CODE_THEME_LIST, MARKDOWN_THEME_LIST,
  buildMonacoTheme, resolveCodeTheme, resolveMarkdownTheme, editorThemeVars,
} from './editor-themes'

const COLOUR_KEYS_CODE = [
  'fg', 'comment', 'keyword', 'constant', 'string', 'number',
  'operator', 'fn', 'tag', 'delimiter', 'error',
] as const
const COLOUR_KEYS_MD = [
  'text', 'heading', 'emphasis', 'link', 'code', 'quote', 'meta', 'html', 'escape',
] as const

describe('palette data', () => {
  // Monaco's ColorMap.getId THROWS on anything outside
  // /^#?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/ — so a three-digit shorthand like
  // `#a33` typechecks perfectly and crashes defineTheme at runtime, taking the
  // whole editor with it. This test is the only thing standing between a typo
  // in a palette table and a blank editor.
  it('every colour is a six-digit hex', () => {
    for (const p of CODE_THEME_LIST) {
      for (const k of COLOUR_KEYS_CODE) {
        expect(p[k], `${p.id}.${k}`).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
    for (const p of MARKDOWN_THEME_LIST) {
      for (const k of COLOUR_KEYS_MD) {
        expect(p[k], `${p.id}.${k}`).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('registry keys match ids', () => {
    for (const [id, p] of Object.entries(CODE_THEMES)) expect(p.id).toBe(id)
    for (const [id, p] of Object.entries(MARKDOWN_THEMES)) expect(p.id).toBe(id)
  })

  it('ships the ported app themes plus the extra palettes', () => {
    for (const t of Object.values(THEMES).filter(theme => !theme.legacy)) {
      expect(CODE_THEMES).toHaveProperty(t.id)
      expect(MARKDOWN_THEMES).toHaveProperty(t.id)
    }
    expect(CODE_THEME_LIST.length).toBeGreaterThanOrEqual(Object.values(THEMES).filter(theme => !theme.legacy).length + 16)
    expect(MARKDOWN_THEME_LIST.length).toBeGreaterThanOrEqual(Object.values(THEMES).filter(theme => !theme.legacy).length + 6)
  })
})

describe('resolution', () => {
  it('every app theme names defaults that exist', () => {
    for (const t of Object.values(THEMES)) {
      expect(CODE_THEMES[t.defaultCodeTheme], t.id).toBeDefined()
      expect(MARKDOWN_THEMES[t.defaultMarkdownTheme], t.id).toBeDefined()
    }
  })

  it('falls back to the app theme default, then to Dark', () => {
    for (const t of Object.values(THEMES)) {
      expect(resolveCodeTheme(t.id, 'no-such-theme').id).toBe(t.defaultCodeTheme)
      expect(resolveMarkdownTheme(t.id, 'no-such-theme').id).toBe(t.defaultMarkdownTheme)
    }
    // An app theme that no longer exists must not throw either.
    expect(resolveCodeTheme('gone', 'gone').id).toBe(THEMES.dark.defaultCodeTheme)
    expect(resolveMarkdownTheme('gone', 'gone').id).toBe(THEMES.dark.defaultMarkdownTheme)
  })
})

describe('buildMonacoTheme', () => {
  // THE invariant. A code or markdown theme contributes token colours only; the
  // surface the text sits on belongs to the app theme. If this ever fails,
  // switching a syntax palette has started moving the editor background.
  it('colors and base depend only on the app theme', () => {
    const pairs: Array<[string, string]> = [
      ['dark', 'dark'], ['monokai', 'vivid'], ['githubLight', 'ink'],
      ['solarizedDark', 'prose'], ['catppuccinLatte', 'githubMd'],
    ]
    for (const sys of Object.values(THEMES)) {
      const base = buildMonacoTheme(sys, CODE_THEMES.dark, MARKDOWN_THEMES.dark)
      for (const [c, m] of pairs) {
        const other = buildMonacoTheme(sys, CODE_THEMES[c], MARKDOWN_THEMES[m])
        expect(other.colors, `${sys.id}/${c}/${m}`).toEqual(base.colors)
        expect(other.base).toBe(base.base)
      }
      expect(base.base).toBe(sys.isDark ? 'vs-dark' : 'vs')
    }
  })

  // Pinned against what the old mkMonaco() produced, so "the default look is
  // unchanged" is a fact rather than a claim.
  it('keeps the Dark theme chrome byte-for-byte', () => {
    expect(buildMonacoTheme(THEMES.dark, CODE_THEMES.dark, MARKDOWN_THEMES.dark).colors)
      .toEqual({
        'editor.background': '#161b22',
        'editor.foreground': '#ededed',
        'editorLineNumber.foreground': '#8b949e',
        'editorLineNumber.activeForeground': '#ededed',
        'editor.lineHighlightBackground': '#0f1117',
        'editorCursor.foreground': '#4493f8',
        'editor.selectionBackground': '#4493f840',
        'editorGutter.background': '#161b22',
        'scrollbarSlider.background': '#21262d80',
        'editorIndentGuide.background1': '#21262d',
        'editorIndentGuide.activeBackground1': '#8b949e',
      })
  })

  it('emits no rule background, and no duplicate tokens', () => {
    const { rules } = buildMonacoTheme(THEMES.dark, CODE_THEMES.monokai, MARKDOWN_THEMES.vivid)
    for (const rule of rules) {
      expect(rule).not.toHaveProperty('background')
      // Monaco strips the leading '#' itself; ours are already stripped.
      expect(rule.foreground).toMatch(/^[0-9a-fA-F]{6}$/)
    }
    // Monaco sorts rules lexicographically and lets a later duplicate win by
    // array position, so a duplicate token is a silent override.
    const tokens = rules.map((r) => r.token)
    expect(new Set(tokens).size).toBe(tokens.length)
  })

  it('keeps the two palettes on their own tokens', () => {
    const { rules } = buildMonacoTheme(THEMES.dark, CODE_THEMES.monokai, MARKDOWN_THEMES.vivid)
    const at = (t: string): string | undefined => rules.find((r) => r.token === t)?.foreground
    expect(at('keyword')).toBe('f92672')            // Monokai keyword
    expect(at('keyword.md')).toBe('ff7edb')          // Vivid heading
    expect(at('keyword.table.header.md')).toBe('ff7edb')
    expect(at('comment')).toBe('75715e')
    expect(at('comment.md')).toBe('848bbd')          // Vivid quote
  })
})

describe('editorThemeVars', () => {
  it('exposes every palette colour as a CSS custom property', () => {
    const vars = editorThemeVars(CODE_THEMES.nord, MARKDOWN_THEMES.prose)
    expect(vars['--ourgeo-code-keyword']).toBe(CODE_THEMES.nord.keyword)
    expect(vars['--ourgeo-md-heading']).toBe(MARKDOWN_THEMES.prose.heading)
    for (const [k, v] of Object.entries(vars)) {
      expect(k, k).toMatch(/^--ourgeo-(code|md)-[a-z]+$/)
      expect(v, k).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})
