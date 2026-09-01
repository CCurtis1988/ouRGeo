import { describe, it, expect, beforeEach } from 'vitest'
import {
  THEMES, BUILTIN_THEMES, registerCustomThemes, themeList,
} from './themes'
import {
  CODE_THEMES, MARKDOWN_THEMES, BUILTIN_CODE_THEMES,
  registerCustomEditorThemes, codeThemeList, buildMonacoTheme,
  resolveCodeTheme,
} from './editor-themes'
import {
  normalizeHex, hexToHslTriple, hslTripleToHex, luminance, contrastRatio, shade,
  slugify, uniqueThemeId,
  systemThemeToDef, systemColorsFromDef, systemThemeFromTemplate,
  codeThemeFromTemplate, markdownThemeFromTemplate,
  installBundle, buildThemeFile, classifyThemeFile, parseThemeFile,
  exportSystemTheme, exportCodeTheme, exportMarkdownTheme,
  validateImageDataUri, base64Bytes, BACKGROUND_SPEC, ICON_SPEC,
  CODE_COLOR_KEYS, MD_COLOR_KEYS, SYSTEM_COLOR_KEYS, CHROME_KEYS,
  EMPTY_BUNDLE,
  type CustomSystemTheme, type ThemeKind,
} from './custom-themes'

const KINDS: ThemeKind[] = ['system', 'code', 'markdown']

const sampleSystem = (): CustomSystemTheme =>
  systemThemeFromTemplate('arctic', 'Slate Blue', 'my-slate-blue')

// A 1×1 transparent PNG. Small enough that the size cap is never the thing
// under test unless a test says so.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4' +
  'nGNgAAIAAAUAAY27m/MAAAAASUVORK5CYII='

/** Every test that touches the registries must put them back — they are module
 *  singletons, and a leaked custom theme would show up in another file's
 *  `Object.values(THEMES)` as an extra entry with no obvious source. */
beforeEach(() => {
  installBundle(EMPTY_BUNDLE)
})

describe('colour conversion', () => {
  it('normalises three-digit and six-digit hex, and refuses everything else', () => {
    expect(normalizeHex('#a33')).toBe('#aa3333')
    expect(normalizeHex('AABBCC')).toBe('#aabbcc')
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc')
    expect(normalizeHex('  #4493f8 ')).toBe('#4493f8')
    // Eight digits carry alpha, which `vars` triples and Monaco rules cannot
    // represent — refusing beats silently dropping the channel.
    expect(normalizeHex('#4493f880')).toBeNull()
    expect(normalizeHex('rgb(1,2,3)')).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex(42)).toBeNull()
    expect(normalizeHex(null)).toBeNull()
  })

  it('round-trips hex through the HSL triple within a colour step', () => {
    const samples = [
      '#0f1117', '#4493f8', '#ededed', '#ffffff', '#000000',
      '#ff0066', '#3fb950', '#8b949e', '#f4a83a',
    ]
    for (const hex of samples) {
      const back = hslTripleToHex(hexToHslTriple(hex))
      const channels = (h: string): number[] =>
        [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
      const a = channels(hex)
      const b = channels(back)
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(a[i] - b[i]), `${hex} -> ${back}`).toBeLessThanOrEqual(2)
      }
    }
  })

  it('emits a bare triple, because globals.css composes it with alpha', () => {
    // `hsl(var(--geo-accent) / 0.4)` only works on "H S% L%" — a hex or an
    // hsl() wrapper here invalidates the whole declaration.
    expect(hexToHslTriple('#4493f8')).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/)
    expect(hexToHslTriple('#000000')).toBe('0 0% 0%')
    expect(hexToHslTriple('#ffffff')).toBe('0 0% 100%')
  })

  it('measures luminance and contrast the way the studio warns on them', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it('shades towards white and black', () => {
    expect(shade('#000000', 1)).toBe('#ffffff')
    expect(shade('#ffffff', -1)).toBe('#000000')
    expect(shade('#808080', 0)).toBe('#808080')
  })
})

describe('ids', () => {
  it('slugifies to something legible in theme.json', () => {
    expect(slugify('Slate Blue')).toBe('slate-blue')
    expect(slugify('  ¡Hola! 42 ')).toBe('hola-42')
    expect(slugify('***')).toBe('theme')
  })

  it('never collides, and never lands on a shipped id', () => {
    const taken = ['my-slate', 'my-slate-2', ...Object.keys(BUILTIN_THEMES)]
    expect(uniqueThemeId('Slate', taken)).toBe('my-slate-3')
    // The `my-` prefix is what keeps a user theme out of the shipped namespace.
    expect(uniqueThemeId('Dark', [])).toBe('my-dark')
    expect(uniqueThemeId('Dark', []) in BUILTIN_THEMES).toBe(false)
  })
})

describe('systemThemeToDef', () => {
  it('derives vars, palette and swatches from the authored hexes', () => {
    const t = sampleSystem()
    t.colors.accent = '#4493f8'
    t.colors.error = '#f85149'
    const def = systemThemeToDef(t)

    expect(def.custom).toBe(true)
    expect(def.id).toBe(t.id)
    for (const k of Object.keys(def.vars)) {
      expect(def.vars[k], k).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/)
    }
    expect(def.palette.accent).toBe('#4493f8')
    expect(def.palette.error).toBe('#f85149')
    expect(def.swatches).toEqual([t.chrome.bg, t.chrome.accent, t.chrome.fg])
    expect(def.editorChrome).toEqual(t.chrome)
    // Mutating the draft afterwards must not reach the registry entry.
    t.chrome.fg = '#123456'
    expect(def.editorChrome.fg).not.toBe('#123456')
  })

  it('is the inverse of systemColorsFromDef for the shipped themes', () => {
    for (const t of Object.values(BUILTIN_THEMES)) {
      const colors = systemColorsFromDef(t)
      for (const k of SYSTEM_COLOR_KEYS) {
        expect(colors[k], `${t.id}.${k}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('starts a template from a shipped theme without changing it', () => {
    const before = JSON.stringify(THEMES.arctic)
    const t = systemThemeFromTemplate('arctic', 'Mine', 'my-mine')
    expect(t.basedOn).toBe('arctic')
    expect(t.isDark).toBe(THEMES.arctic.isDark)
    expect(t.chrome).toEqual(THEMES.arctic.editorChrome)
    expect(JSON.stringify(THEMES.arctic)).toBe(before)
  })

  it('keeps basedOn on the SHIPPED ancestor through a chain of copies', () => {
    // The scene generator looks up `basedOn` in its own table of shipped
    // drawings — a chain that pointed at another user theme would find none.
    const first = systemThemeFromTemplate('forest', 'One', 'my-one')
    installBundle({ system: [first], code: [], markdown: [] })
    const second = systemThemeFromTemplate('my-one', 'Two', 'my-two')
    expect(second.basedOn).toBe('forest')
  })
})

describe('the registries', () => {
  it('installs user themes and lists them after the shipped ones', () => {
    const t = sampleSystem()
    installBundle({ system: [t], code: [], markdown: [] })
    expect(THEMES[t.id]?.label).toBe('Slate Blue')
    expect(themeList().map((x) => x.id)).toContain(t.id)
    expect(themeList().slice(0, Object.keys(BUILTIN_THEMES).length)
      .map((x) => x.id)).toEqual(Object.keys(BUILTIN_THEMES))
  })

  it('is idempotent — re-registering replaces rather than accumulates', () => {
    const t = sampleSystem()
    installBundle({ system: [t], code: [], markdown: [] })
    const n = themeList().length
    installBundle({ system: [{ ...t, label: 'Renamed' }], code: [], markdown: [] })
    expect(themeList().length).toBe(n)
    expect(THEMES[t.id].label).toBe('Renamed')
  })

  it('drops a user theme rather than let it shadow a shipped id', () => {
    const shipped = JSON.stringify(THEMES.dark)
    registerCustomThemes([{ ...systemThemeToDef(sampleSystem()), id: 'dark' }])
    expect(JSON.stringify(THEMES.dark)).toBe(shipped)
    registerCustomEditorThemes(
      [{ ...CODE_THEMES.monokai, id: 'monokai', label: 'Hijacked' }], [],
    )
    expect(CODE_THEMES.monokai.label).toBe('Monokai')
  })

  it('removes user themes when the bundle no longer holds them', () => {
    const t = sampleSystem()
    installBundle({ system: [t], code: [], markdown: [] })
    installBundle(EMPTY_BUNDLE)
    expect(THEMES[t.id]).toBeUndefined()
    expect(Object.keys(THEMES)).toEqual(Object.keys(BUILTIN_THEMES))
    expect(Object.keys(CODE_THEMES)).toEqual(Object.keys(BUILTIN_CODE_THEMES))
  })

  it('lets an app theme default to a palette the user made', () => {
    const code = codeThemeFromTemplate('nord', 'My Nord', 'my-nord')
    const sys = { ...sampleSystem(), defaultCodeTheme: 'my-nord' }
    installBundle({ system: [sys], code: [code], markdown: [] })
    expect(codeThemeList().map((p) => p.id)).toContain('my-nord')
    expect(resolveCodeTheme(sys.id, 'my-nord').label).toBe('My Nord')
    // …and falls back to that default when the selected id is gone.
    expect(resolveCodeTheme(sys.id, 'deleted').id).toBe('my-nord')
  })

  it('keeps the palettes off the editor surface for a USER app theme too', () => {
    // The invariant `editor-themes.test.ts` asserts for shipped themes. It has
    // to hold for a theme assembled at runtime, or "switching a code theme
    // never moves the background" stops being true the moment a user has one.
    const sys = systemThemeToDef(sampleSystem())
    installBundle({ system: [sampleSystem()], code: [], markdown: [] })
    const base = buildMonacoTheme(sys, CODE_THEMES.dark, MARKDOWN_THEMES.dark)
    const other = buildMonacoTheme(sys, CODE_THEMES.monokai, MARKDOWN_THEMES.vivid)
    expect(other.colors).toEqual(base.colors)
    expect(other.base).toBe(base.base)
    expect(base.colors['editor.background']).toBe(sys.editorChrome.panel)
  })
})

describe('image validation', () => {
  it('accepts the formats Chromium can paint', () => {
    expect(validateImageDataUri(PNG_1PX, ICON_SPEC)).toEqual({ ok: true, uri: PNG_1PX })
  })

  it('refuses a type the app cannot render, naming the ones it can', () => {
    const res = validateImageDataUri('data:image/tiff;base64,AAAA', ICON_SPEC)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('image/tiff')
      expect(res.error).toContain('png')
    }
  })

  it('refuses anything that is not an embedded image', () => {
    expect(validateImageDataUri('/home/me/wallpaper.png', ICON_SPEC).ok).toBe(false)
    expect(validateImageDataUri('https://example.com/a.png', ICON_SPEC).ok).toBe(false)
    expect(validateImageDataUri(null, ICON_SPEC).ok).toBe(false)
  })

  it('enforces the size cap, in the units the message uses', () => {
    const big = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`
    expect(base64Bytes(big)).toBeGreaterThan(ICON_SPEC.maxBytes)
    const res = validateImageDataUri(big, ICON_SPEC)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('1.0 MB')
    // The backdrop cap is looser, so the same file passes there.
    expect(validateImageDataUri(big, BACKGROUND_SPEC).ok).toBe(true)
  })
})

describe('the file format', () => {
  it('round-trips an app theme, artwork and all', () => {
    const t = { ...sampleSystem(), backgroundImage: PNG_1PX, iconImage: PNG_1PX }
    const text = buildThemeFile('system', [exportSystemTheme(t)])
    const res = parseThemeFile(text, 'system')
    expect(res.ok).toBe(true)
    if (!res.ok || res.kind !== 'system') throw new Error('expected a system file')
    expect(res.themes).toHaveLength(1)
    expect(res.themes[0]).toEqual(t)
  })

  it('round-trips a code palette and a markdown palette', () => {
    const code = codeThemeFromTemplate('dracula', 'My Dracula', 'my-dracula')
    const codeRes = parseThemeFile(buildThemeFile('code', [exportCodeTheme(code)]), 'code')
    expect(codeRes.ok).toBe(true)
    if (!codeRes.ok || codeRes.kind !== 'code') throw new Error('expected a code file')
    for (const k of CODE_COLOR_KEYS) expect(codeRes.themes[0][k]).toBe(code[k])
    expect(codeRes.themes[0].custom).toBe(true)

    const md = markdownThemeFromTemplate('prose', 'My Prose', 'my-prose')
    const mdRes = parseThemeFile(buildThemeFile('markdown', [exportMarkdownTheme(md)]), 'markdown')
    expect(mdRes.ok).toBe(true)
    if (!mdRes.ok || mdRes.kind !== 'markdown') throw new Error('expected a markdown file')
    for (const k of MD_COLOR_KEYS) expect(mdRes.themes[0][k]).toBe(md[k])
  })

  it('writes an envelope that names its own kind', () => {
    const parsed = JSON.parse(buildThemeFile('code', [])) as Record<string, unknown>
    expect(parsed.kind).toBe('code')
    expect(parsed.app).toBe('ouRGeo')
    expect(typeof parsed.ourgeoTheme).toBe('number')
  })
})

// The guard the format exists for. A code palette and a markdown palette are
// both a flat map of colour names, so nothing about the PAYLOAD distinguishes
// them; the declared kind is what lets the wrong importer say what the file
// actually is instead of complaining about a missing property.
describe('loading a theme file into the wrong editor', () => {
  const files: Record<ThemeKind, string> = {
    system: buildThemeFile('system', [exportSystemTheme(sampleSystem())]),
    code: buildThemeFile('code', [exportCodeTheme(
      codeThemeFromTemplate('nord', 'My Nord', 'my-nord'))]),
    markdown: buildThemeFile('markdown', [exportMarkdownTheme(
      markdownThemeFromTemplate('ink', 'My Ink', 'my-ink'))]),
  }

  it('accepts each kind in its own list', () => {
    for (const k of KINDS) {
      const res = parseThemeFile(files[k], k)
      expect(res.ok, k).toBe(true)
    }
  })

  it('refuses every other pairing, and says what the file IS', () => {
    const expectations: Record<ThemeKind, [string, string]> = {
      system: ['App theme', 'App Themes'],
      code: ['Code theme', 'Code Themes'],
      markdown: ['Markdown theme', 'Markdown Themes'],
    }
    for (const actual of KINDS) {
      for (const asked of KINDS) {
        if (actual === asked) continue
        const res = classifyThemeFile(files[actual], asked)
        expect(res.ok, `${actual} into ${asked}`).toBe(false)
        if (res.ok) continue
        // It knows which kind it is holding — not merely that it is wrong.
        expect(res.kind).toBe(actual)
        expect(res.error).toContain(expectations[actual][0])
        // …and names the tab that would take it.
        expect(res.error).toContain(expectations[actual][1])
        // The theme's own name is in there, so the user can tell which file
        // they picked without opening it.
        expect(res.error).toMatch(/[“"]/)
      }
    }
  })

  it('reports the count when a file holds several themes', () => {
    const many = buildThemeFile('code', [
      exportCodeTheme(codeThemeFromTemplate('nord', 'A', 'my-a')),
      exportCodeTheme(codeThemeFromTemplate('dracula', 'B', 'my-b')),
    ])
    const res = classifyThemeFile(many, 'system')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('2 themes')
  })

  it('accepts any kind when the caller does not insist', () => {
    for (const k of KINDS) {
      const res = classifyThemeFile(files[k])
      expect(res.ok, k).toBe(true)
      if (res.ok) expect(res.kind).toBe(k)
    }
  })
})

describe('files that are not themes at all', () => {
  const err = (text: string, expected?: ThemeKind): string => {
    const res = classifyThemeFile(text, expected)
    expect(res.ok).toBe(false)
    return res.ok ? '' : res.error
  }

  it('says so for JSON that is not a theme file', () => {
    expect(err('not json at all')).toContain('not valid JSON')
    expect(err('[1,2,3]')).toContain('does not contain an ouRGeo theme')
    expect(err('{"hello":"world"}')).toContain('not an ouRGeo theme file')
  })

  it('recognises the two ouRGeo files most likely to be picked by mistake', () => {
    // theme.json records which themes are SELECTED. It sits in the same
    // app-data folder and opens without complaint, so it earns its own hint.
    expect(err('{"theme":"dark","codeTheme":"nord","uiScale":1}'))
      .toContain('theme.json')
    expect(err('{"ui":{},"databases":[],"name":"x"}'))
      .toContain('project manifest')
  })

  it('refuses a file from a newer ouRGeo instead of half-reading it', () => {
    expect(err('{"ourgeoTheme":99,"kind":"code","themes":[{}]}'))
      .toContain('newer version')
  })

  it('refuses an envelope with no kind, or with nothing in it', () => {
    expect(err('{"ourgeoTheme":1,"themes":[{}]}')).toContain('what kind')
    expect(err('{"ourgeoTheme":1,"kind":"code","themes":[]}')).toContain('no themes')
  })
})

describe('payload validation', () => {
  // Monaco's ColorMap.getId throws on anything that is not six or eight hex
  // digits, and it throws inside defineTheme — taking the editor with it, with
  // no stack that points at the theme file. Every colour is checked here, on
  // the way in, while there is still a user to tell.
  it('refuses a colour Monaco would crash on, and names the field', () => {
    const good = codeThemeFromTemplate('nord', 'My Nord', 'my-nord')
    const bad = { ...exportCodeTheme(good) as Record<string, unknown>, keyword: '#a33x' }
    const res = parseThemeFile(buildThemeFile('code', [bad]), 'code')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('keyword')
      expect(res.error).toContain('My Nord')
    }
  })

  it('accepts three-digit hex from a hand-written file, expanded', () => {
    const good = exportCodeTheme(codeThemeFromTemplate('nord', 'Short', 'my-short')) as Record<string, unknown>
    const res = parseThemeFile(buildThemeFile('code', [{ ...good, keyword: '#a33' }]), 'code')
    expect(res.ok).toBe(true)
    if (res.ok && res.kind === 'code') expect(res.themes[0].keyword).toBe('#aa3333')
  })

  it('names the theme that failed when a file holds several', () => {
    const ok = exportCodeTheme(codeThemeFromTemplate('nord', 'Fine', 'my-fine'))
    const broken = { ...exportCodeTheme(codeThemeFromTemplate('nord', 'Broken', 'my-broken')) as Record<string, unknown> }
    delete broken.string
    const res = parseThemeFile(buildThemeFile('code', [ok, broken]), 'code')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('Broken')
      expect(res.error).toContain('string')
    }
  })

  it('rejects artwork that would not survive the size cap', () => {
    const t = exportSystemTheme(sampleSystem()) as Record<string, unknown>
    t.iconImage = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`
    const res = parseThemeFile(buildThemeFile('system', [t]), 'system')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('exceeds')
  })

  it('fills in what a hand-written file may reasonably omit', () => {
    const t = exportSystemTheme(sampleSystem()) as Record<string, unknown>
    delete t.isDark
    delete t.basedOn
    delete t.backgroundOpacity
    delete t.iconImage
    delete t.defaultBasemap
    const res = parseThemeFile(buildThemeFile('system', [t]), 'system')
    expect(res.ok).toBe(true)
    if (res.ok && res.kind === 'system') {
      const parsed = res.themes[0]
      // Brightness is inferred from the background, so the pickers still sort
      // it into the right group.
      expect(parsed.isDark).toBe(true)
      expect(parsed.basedOn).toBe('dark')
      expect(parsed.backgroundOpacity).toBe(0.15)
      expect(parsed.iconImage).toBeNull()
      for (const k of CHROME_KEYS) expect(parsed.chrome[k]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('clamps an out-of-range opacity rather than refusing the theme', () => {
    const t = exportSystemTheme(sampleSystem()) as Record<string, unknown>
    t.backgroundOpacity = 4
    const res = parseThemeFile(buildThemeFile('system', [t]), 'system')
    expect(res.ok).toBe(true)
    if (res.ok && res.kind === 'system') expect(res.themes[0].backgroundOpacity).toBe(1)
  })
})
