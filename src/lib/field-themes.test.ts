import { describe, expect, it } from 'vitest'
import { FIELD_THEME_LIST } from './field-themes'
import { THEMES } from './themes'
import { CODE_THEMES, MARKDOWN_THEMES } from './editor-themes'
import { contrastRatio, hslTripleToHex, shade } from './custom-themes'
import { themeDefaultBasemap } from './basemaps'
import { backgroundGalleryBase } from './theme-backgrounds'

describe('Field collection', () => {
  it('adds all thirteen website palettes without replacing the existing Forest', () => {
    expect(FIELD_THEME_LIST.map(theme => theme.id)).toEqual([
      'field-dev', 'field-slate', 'field-basalt', 'field-forest', 'field-trout',
      'field-high-alpine', 'field-wood', 'field-sextant', 'field-glacier',
      'field-field-notes', 'field-rainproof', 'field-albany', 'field-linen',
    ])
    expect(FIELD_THEME_LIST.filter(theme => !theme.isDark)).toHaveLength(5)
    expect(THEMES.forest.id).toBe('forest')
    expect(THEMES['legacy-forest'].basedOn).toBe('forest')
    for (const theme of FIELD_THEME_LIST) {
      expect(THEMES[theme.id]).toBe(theme)
      expect(backgroundGalleryBase(theme.id)).toBe(theme.id)
      expect(themeDefaultBasemap(theme.id)).toBe(theme.isDark ? 'carto-dark-matter' : 'carto-voyager')
    }
  })

  it('keeps interface text and filled button labels readable in every palette', () => {
    for (const theme of FIELD_THEME_LIST) {
      const hex = (key: string): string => hslTripleToHex(theme.vars[`--geo-${key}`])
      for (const background of [hex('bg'), hex('panel')]) {
        for (const key of ['fg', 'muted', 'accent']) {
          expect(contrastRatio(hex(key), background), `${theme.id}: ${key}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      for (const fill of ['accent', 'accent-hover']) {
        expect(contrastRatio(hex('on-accent'), hex(fill)), `${theme.id}: ${fill} label`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('provides complete code and prose defaults readable over the photograph extremes', () => {
    for (const theme of FIELD_THEME_LIST) {
      const code = CODE_THEMES[theme.defaultCodeTheme], markdown = MARKDOWN_THEMES[theme.defaultMarkdownTheme]
      expect(code.label).toBe(`${theme.label} · Field`)
      expect(markdown.isDark).toBe(theme.isDark)
      // The image is a faint layer over the panel. Bound every possible pixel
      // with white at 18% for dark themes and black at 35% for light themes.
      const background = shade(theme.editorChrome.panel, theme.isDark ? 0.18 : -0.35)
      for (const [key, colour] of Object.entries(code)) {
        if (typeof colour === 'string' && colour.startsWith('#')) {
          expect(contrastRatio(colour, background), `${theme.id}: code ${key}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      for (const [key, colour] of Object.entries(markdown)) {
        if (typeof colour === 'string' && colour.startsWith('#')) {
          expect(contrastRatio(colour, background), `${theme.id}: markdown ${key}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})
