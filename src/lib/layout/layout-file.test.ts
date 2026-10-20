import { describe, it, expect } from 'vitest'
import { buildLayoutFile, parseLayoutFile, layoutFileName, LAYOUT_FILE_VERSION } from './layout-file'
import { defaultLayout, type LayoutState } from './model'
import { panelInfoList } from './panel-meta'

const layout = (): LayoutState => defaultLayout(panelInfoList())

describe('a workspace layout as a file', () => {
  it('round-trips what it wrote', () => {
    const text = buildLayoutFile([{ name: 'Mapping', layout: layout() }])
    const parsed = parseLayoutFile(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.presets).toHaveLength(1)
      expect(parsed.presets[0].name).toBe('Mapping')
      expect(parsed.presets[0].layout.zones).toBeTruthy()
    }
  })

  it('carries several arrangements in one file', () => {
    const text = buildLayoutFile([
      { name: 'Mapping', layout: layout() },
      { name: 'Writing', layout: layout() },
    ])
    const parsed = parseLayoutFile(text)
    expect(parsed.ok && parsed.presets.map((p) => p.name)).toEqual(['Mapping', 'Writing'])
  })

  it('reads ouRGeo’s own layout.json, which has no envelope', () => {
    // The user's most likely mis-pick is also a real arrangement, so it is
    // read rather than refused — under a name, since the file has none.
    const parsed = parseLayoutFile(JSON.stringify({ layout: layout(), presets: [] }))
    expect(parsed.ok && parsed.presets[0].name).toBe('Imported layout')
  })

  it('names the file it was actually given', () => {
    const theme = parseLayoutFile(JSON.stringify({ ourgeoTheme: { kind: 'system' }, themes: [] }))
    expect(theme.ok).toBe(false)
    if (!theme.ok) expect(theme.error).toMatch(/theme file/)

    const selected = parseLayoutFile(JSON.stringify({ themeId: 'dark', codeThemeId: 'dark' }))
    expect(selected.ok).toBe(false)
    if (!selected.ok) expect(selected.error).toMatch(/theme\.json/)

    const plugin = parseLayoutFile(JSON.stringify({ manifestVersion: 1, contributes: {} }))
    expect(plugin.ok).toBe(false)
    if (!plugin.ok) expect(plugin.error).toMatch(/plugin manifest/)
  })

  it('refuses a format from the future rather than half-reading it', () => {
    const parsed = parseLayoutFile(JSON.stringify({
      ourgeoLayout: { version: LAYOUT_FILE_VERSION + 1 },
      presets: [{ name: 'x', layout: layout() }],
    }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(/Update ouRGeo/)
  })

  it('drops an arrangement from an older layout version, and says so', () => {
    const stale = { ...layout(), version: 0 }
    const parsed = parseLayoutFile(buildLayoutFile([{ name: 'Old', layout: stale }]))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(/different version/)
  })

  it('refuses what is not JSON at all', () => {
    expect(parseLayoutFile('not json').ok).toBe(false)
    expect(parseLayoutFile('{}').ok).toBe(false)
  })

  it('makes a filename out of a name', () => {
    expect(layoutFileName('Mapping & Writing')).toBe('mapping-writing')
    expect(layoutFileName('   ')).toBe('layout')
  })
})

it('accepts version-one flat arrangements for migration without forgetting placement', () => {
  const old = { ...layout(), version: 1 }
  const parsed = parseLayoutFile(buildLayoutFile([{ name: 'Old arrangement', layout: old }]))
  expect(parsed.ok && parsed.presets[0].layout.zones).toEqual(old.zones)
})
