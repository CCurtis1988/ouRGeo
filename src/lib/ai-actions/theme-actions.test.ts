import { describe, it, expect, beforeEach, vi } from 'vitest'
import { actionById, listActions } from './registry'
import { validateArgs, type Args } from './types'
import { THEMES } from '@/lib/themes'
import { CODE_THEMES } from '@/lib/editor-themes'
import { EMPTY_BUNDLE, installBundle } from '@/lib/custom-themes'
import { useCustomThemeStore } from '@/store/custom-themes'
import { useThemeStore } from '@/store/theme'

// The theme actions drive the real registries and the real store, because that
// is the only way to check the thing that matters: that a theme the assistant
// made is installed, selectable, and indistinguishable from a shipped one.
// Only Electron is stubbed.

const files = new Map<string, string>()

/**
 * Run an action the way `run_ui_action` does — **validation first**.
 *
 * That order is the whole point. `validateArgs` gates the call before `run`
 * ever executes, so an action whose handler accepts a value its parameter enum
 * does not is refused at the boundary, and no amount of correctness in the
 * handler is reachable. Calling `action.run` directly in a test hides exactly
 * the bug that shipped: `ui:theme` resolved a user's theme perfectly well and
 * was never given the chance.
 */
const run = async (id: string, args: Args = {}): Promise<string> => {
  const action = actionById(id)
  if (!action) throw new Error(`no action ${id}`)
  const invalid = validateArgs(action, args)
  if (invalid) return `FAILED: ${invalid}`
  const res = await action.run(args)
  return `${res.ok ? '' : 'FAILED: '}${res.message}${res.data ? `\n${String(res.data)}` : ''}`
}

/** A 1×1 PNG, base64 without the data: prefix — what `readBinary` returns. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4' +
  'nGNgAAIAAAUAAY27m/MAAAAASUVORK5CYII='

beforeEach(() => {
  files.clear()
  installBundle(EMPTY_BUNDLE)
  useCustomThemeStore.setState({ ...EMPTY_BUNDLE, loaded: true })
  useThemeStore.setState({
    current: 'dark', codeTheme: 'dark', markdownTheme: 'dark', revision: 0,
  })
  vi.stubGlobal('document', { documentElement: { dataset: {}, style: { setProperty: vi.fn(), removeProperty: vi.fn() }, classList: { toggle: vi.fn() } } })
  vi.stubGlobal('window', {
    electronAPI: {
      app: { getDataPath: vi.fn(async () => '/data') },
      file: {
        read: vi.fn(async (p: string) => {
          const v = files.get(p)
          if (v === undefined) throw new Error('ENOENT')
          return v
        }),
        write: vi.fn(async (p: string, c: string) => { files.set(p, c) }),
        readBinary: vi.fn(async (p: string) => {
          if (!files.has(p)) throw new Error('ENOENT')
          return files.get(p) as string
        }),
      },
    },
  })
})

const create = async (kind: string, name: string, template: string): Promise<string> => {
  await run('theme:create', { kind, name, template })
  const s = useCustomThemeStore.getState()
  const list = kind === 'system' ? s.system : kind === 'code' ? s.code : s.markdown
  return list[list.length - 1].id
}

describe('theme:list', () => {
  it('names the shipped themes on all three axes and marks the ones in use', async () => {
    const out = await run('theme:list')
    expect(out).toContain('* dark — Dark')
    expect(out).toContain('Code themes (ui:codeTheme):')
    expect(out).toContain('monokai — Monokai')
    expect(out).toContain('Markdown themes (ui:markdownTheme):')
  })

  it("includes a theme the assistant just made, and says it is the user's", async () => {
    const id = await create('system', 'Warm Night', 'arctic')
    const out = await run('theme:list')
    expect(out).toContain(`${id} — Warm Night (the user's own)`)
  })
})

// The bug a user's local model hit, verbatim: it built a whole theme, tried to
// switch to it, was told the theme "must be one of: dark, bespin, …", and
// concluded — correctly, from what it could see — that switching to a theme it
// had just made was impossible and the user would have to click a button.
//
// `validateArgs` runs BEFORE the handler, so the fixed enum was the whole story
// and the handler's live-registry lookup was unreachable. Every assertion here
// goes through `run`, which validates first.
describe('switching to a theme that did not exist at build time', () => {
  it('accepts a theme the assistant just created', async () => {
    const id = await create('system', 'Half-Life 2', 'volcanic')
    const out = await run('ui:theme', { theme: id })
    expect(out).not.toContain('FAILED')
    expect(out).not.toContain('must be one of')
    expect(useThemeStore.getState().current).toBe(id)
  })

  it('accepts the theme by the NAME the assistant gave it', async () => {
    // A model that just named a theme reaches for the name before the slug.
    const id = await create('system', 'Half-Life 2', 'volcanic')
    expect(await run('ui:theme', { theme: 'Half-Life 2' })).not.toContain('FAILED')
    expect(useThemeStore.getState().current).toBe(id)
    // …and is forgiving about how it is written.
    useThemeStore.setState({ current: 'dark' })
    expect(await run('ui:theme', { theme: 'half life 2' })).not.toContain('FAILED')
    expect(useThemeStore.getState().current).toBe(id)
  })

  it('does the same for code and markdown palettes', async () => {
    const code = await create('code', 'HL2 Syntax', 'gruvboxDark')
    const md = await create('markdown', 'HL2 Prose', 'prose')
    expect(await run('ui:codeTheme', { theme: code })).not.toContain('FAILED')
    expect(await run('ui:markdownTheme', { theme: 'HL2 Prose' })).not.toContain('FAILED')
    expect(useThemeStore.getState().codeTheme).toBe(code)
    expect(useThemeStore.getState().markdownTheme).toBe(md)
  })

  it('still refuses a theme that genuinely is not there', async () => {
    const out = await run('ui:theme', { theme: 'no-such-theme' })
    expect(out).toContain('FAILED')
    expect(useThemeStore.getState().current).toBe('dark')
  })

  it('still takes "default" on the two palette switches', async () => {
    const id = await create('system', 'Mine', 'dark')
    await run('theme:configure', { id, codeTheme: 'monokai' })
    await run('ui:theme', { theme: id })
    await run('ui:codeTheme', { theme: 'nord' })
    expect(await run('ui:codeTheme', { theme: 'default' })).not.toContain('FAILED')
    expect(useThemeStore.getState().codeTheme).toBe('monokai')
  })

  // The other half of the report: the model could not SEE the new theme, because
  // `list_ui_actions` renders the same enum it validates against.
  it('lists the new theme where the assistant looks for its options', async () => {
    const id = await create('system', 'Half-Life 2', 'volcanic')
    const listing = listActions('ui:theme')
    expect(listing).toContain(id)
    expect(listing).toContain('dark')
  })

  it('creates and switches in one call when asked to', async () => {
    const out = await run('theme:create', {
      kind: 'system', name: 'Half-Life 2', template: 'volcanic', apply: true,
    })
    expect(out).toContain('switched to it')
    const id = useCustomThemeStore.getState().system[0].id
    expect(useThemeStore.getState().current).toBe(id)
  })

  it('takes the template by name too', async () => {
    expect(await run('theme:create', { kind: 'system', name: 'X', template: 'Neon Lights' }))
      .toContain('copy of Neon Lights')
  })
})

describe('theme:inspect', () => {
  it('reports every colour and the contrast pairs that matter', async () => {
    const out = await run('theme:inspect', { kind: 'system', id: 'dark' })
    expect(out).toContain('ships with ouRGeo')
    expect(out).toContain('interface colours:')
    expect(out).toContain('editor surface:')
    expect(out).toMatch(/text on panel \d+\.\d:1/)
  })

  it('judges a palette against the app theme it will be read on', async () => {
    const out = await run('theme:inspect', { kind: 'code', id: 'monokai' })
    expect(out).toContain("Dark's editor background")
    expect(out).toContain('comment')
  })

  it('flags a low ratio rather than reporting it silently', async () => {
    const id = await create('code', 'Faint', 'dark')
    // A comment the same colour as the editor background it sits on.
    await run('theme:setColors', {
      kind: 'code', id, colors: { comment: THEMES.dark.editorChrome.panel },
    })
    const out = await run('theme:inspect', { kind: 'code', id })
    expect(out).toContain('LOW — aim for 4.5:1')
  })
})

describe('theme:create', () => {
  it('installs a real theme that ui:theme can then switch to', async () => {
    const id = await create('system', 'Warm Night', 'arctic')
    expect(THEMES[id]?.label).toBe('Warm Night')
    expect(THEMES[id]?.custom).toBe(true)
    // The point of the whole exercise: a made theme is an ordinary theme.
    expect(await run('ui:theme', { theme: id })).toContain(id)
    expect(useThemeStore.getState().current).toBe(id)
  })

  it('leaves the template untouched', async () => {
    const before = JSON.stringify(THEMES.arctic)
    const id = await create('system', 'Mine', 'arctic')
    await run('theme:setColors', { kind: 'system', id, colors: { accent: '#ff0000' } })
    expect(JSON.stringify(THEMES.arctic)).toBe(before)
  })

  it('refuses a template from the wrong axis, and says so', async () => {
    // `prose` is a markdown palette; asking for it as an app theme is the
    // mistake a model makes when it has one flat list of names in its head.
    const out = await run('theme:create', { kind: 'system', name: 'X', template: 'prose' })
    expect(out).toContain('FAILED')
    expect(out).toContain('theme:list')
    expect(out).toContain('cannot be the template')
  })

  it('can be started from another theme the user made', async () => {
    const first = await create('system', 'One', 'forest')
    const second = await create('system', 'Two', first)
    expect(THEMES[second].label).toBe('Two')
    // The scene generator only knows the shipped drawings, so the ancestry
    // has to collapse to a shipped id however long the chain gets.
    expect(THEMES[second].basedOn).toBe('forest')
  })
})

describe('theme:setColors', () => {
  it('moves only the colours it was given', async () => {
    const id = await create('system', 'Warm', 'dark')
    const before = { ...(useCustomThemeStore.getState().system[0].colors) }
    await run('theme:setColors', { kind: 'system', id, colors: { accent: '#e8905a' } })
    const after = useCustomThemeStore.getState().system[0].colors
    expect(after.accent).toBe('#e8905a')
    expect(after.panel).toBe(before.panel)
    expect(after.fg).toBe(before.fg)
  })

  it('writes the interface and the editor surface separately', async () => {
    const id = await create('system', 'Warm', 'dark')
    await run('theme:setColors', {
      kind: 'system', id,
      colors: { panel: '#221a14' },
      chrome: { panel: '#1a130e' },
    })
    const t = useCustomThemeStore.getState().system[0]
    // Six names exist in both sets; a flat map could not have said which.
    expect(t.colors.panel).toBe('#221a14')
    expect(t.chrome.panel).toBe('#1a130e')
    expect(THEMES[id].editorChrome.panel).toBe('#1a130e')
  })

  it('reports the contrast back so the model can check its own work', async () => {
    const id = await create('system', 'Warm', 'dark')
    const out = await run('theme:setColors', { kind: 'system', id, colors: { fg: '#1a1a1a' } })
    expect(out).toMatch(/text on panel \d+\.\d:1 \(LOW/)
  })

  it('refuses a shipped theme and names the way out', async () => {
    const out = await run('theme:setColors', { kind: 'system', id: 'dark', colors: { accent: '#ff0000' } })
    expect(out).toContain('FAILED')
    expect(out).toContain('ships with ouRGeo')
    expect(out).toContain('theme:duplicate')
    expect(THEMES.dark.palette.accent).toBe('#4493f8')
  })

  // Monaco's defineTheme throws on a bad colour, deep in the editor, with no
  // stack pointing back here. The model has to be told at the tool boundary.
  it('refuses a colour name or a malformed hex, and says what a colour looks like', async () => {
    const id = await create('code', 'Mine', 'nord')
    const out = await run('theme:setColors', { kind: 'code', id, colors: { keyword: 'blue' } })
    expect(out).toContain('FAILED')
    expect(out).toContain('keyword')
    expect(out).toContain('#rrggbb')
    expect(CODE_THEMES[id].keyword).toBe(CODE_THEMES.nord.keyword)
  })

  it('accepts three-digit hex', async () => {
    const id = await create('code', 'Mine', 'nord')
    await run('theme:setColors', { kind: 'code', id, colors: { keyword: '#a33' } })
    expect(CODE_THEMES[id].keyword).toBe('#aa3333')
  })

  it('refuses an unknown colour name, listing the real ones', async () => {
    const id = await create('code', 'Mine', 'nord')
    const out = await run('theme:setColors', { kind: 'code', id, colors: { background: '#000000' } })
    expect(out).toContain('FAILED')
    expect(out).toContain('"background"')
    expect(out).toContain('comment')   // the valid list is quoted back
  })

  it('refuses "chrome" on a palette, which has no surface of its own', async () => {
    const id = await create('code', 'Mine', 'nord')
    const out = await run('theme:setColors', { kind: 'code', id, chrome: { panel: '#000000' } })
    expect(out).toContain('FAILED')
    expect(out).toContain('no surface of its own')
  })

  it('takes the colours as a JSON string too, since models write those', async () => {
    const id = await create('code', 'Mine', 'nord')
    await run('theme:setColors', { kind: 'code', id, colors: '{"string":"#c0ffee"}' })
    expect(CODE_THEMES[id].string).toBe('#c0ffee')
  })
})

describe('theme:configure', () => {
  it('sets the palettes an app theme defaults to', async () => {
    const id = await create('system', 'Warm', 'dark')
    await run('theme:configure', { id, codeTheme: 'monokai', markdownTheme: 'prose' })
    expect(THEMES[id].defaultCodeTheme).toBe('monokai')
    // Switching to it applies both, which is the point of naming them.
    await run('ui:theme', { theme: id })
    expect(useThemeStore.getState().codeTheme).toBe('monokai')
    expect(useThemeStore.getState().markdownTheme).toBe('prose')
  })

  it('refuses a palette or basemap that does not exist', async () => {
    const id = await create('system', 'Warm', 'dark')
    expect(await run('theme:configure', { id, codeTheme: 'nope' })).toContain('No code theme')
    const bad = await run('theme:configure', { id, basemap: 'nope' })
    expect(bad).toContain('No basemap')
    expect(bad).toContain('carto-dark-matter')
  })

  it('sets the basemap the map opens with', async () => {
    const id = await create('system', 'Warm', 'dark')
    await run('theme:configure', { id, basemap: 'carto-positron' })
    expect(THEMES[id].defaultBasemap).toBe('carto-positron')
  })

  it('clamps nothing silently — an impossible opacity is refused', async () => {
    const id = await create('system', 'Warm', 'dark')
    expect(await run('theme:configure', { id, backdropOpacity: 4 })).toContain('between 0 and 1')
  })

  it('refuses a call that would change nothing', async () => {
    const id = await create('system', 'Warm', 'dark')
    expect(await run('theme:configure', { id })).toContain('Nothing to change')
  })
})

describe('theme:setImage', () => {
  it('embeds the picture in the theme rather than pointing at the file', async () => {
    const id = await create('system', 'Warm', 'dark')
    files.set('/pics/ridge.png', PNG_B64)
    const out = await run('theme:setImage', { id, slot: 'backdrop', path: '/pics/ridge.png' })
    expect(out).not.toContain('FAILED')
    // An exported theme has to carry its artwork, so a path is never stored.
    expect(THEMES[id].backgroundImage).toBe(`data:image/png;base64,${PNG_B64}`)
    expect(out).toContain('15% opacity')
  })

  it('sets the picker card separately from the backdrop', async () => {
    const id = await create('system', 'Warm', 'dark')
    files.set('/pics/card.png', PNG_B64)
    await run('theme:setImage', { id, slot: 'card', path: '/pics/card.png' })
    expect(THEMES[id].iconImage).toBeTruthy()
    expect(THEMES[id].backgroundImage).toBeNull()
  })

  it('refuses a file type the app cannot paint', async () => {
    const id = await create('system', 'Warm', 'dark')
    files.set('/pics/scan.tiff', PNG_B64)
    const out = await run('theme:setImage', { id, slot: 'backdrop', path: '/pics/scan.tiff' })
    expect(out).toContain('FAILED')
    expect(out).toContain('png')
  })

  it('refuses a card image over the cap, in the units the message uses', async () => {
    const id = await create('system', 'Warm', 'dark')
    files.set('/pics/huge.png', 'A'.repeat(2 * 1024 * 1024))
    const out = await run('theme:setImage', { id, slot: 'card', path: '/pics/huge.png' })
    expect(out).toContain('FAILED')
    expect(out).toContain('exceeds')
    expect(out).toContain('1.0 MB')
  })

  it('says so when the file is not there', async () => {
    const id = await create('system', 'Warm', 'dark')
    expect(await run('theme:setImage', { id, slot: 'backdrop', path: '/nope.png' }))
      .toContain('Could not read')
  })

  it('clears an image, and says the generated scene comes back', async () => {
    const id = await create('system', 'Warm', 'dark')
    files.set('/pics/ridge.png', PNG_B64)
    await run('theme:setImage', { id, slot: 'backdrop', path: '/pics/ridge.png' })
    const out = await run('theme:setImage', { id, slot: 'backdrop', clear: true })
    expect(THEMES[id].backgroundImage).toBeNull()
    expect(out).toContain('generated scene')
  })
})

describe('theme:duplicate and theme:delete', () => {
  it('copies a shipped theme into an editable one', async () => {
    const out = await run('theme:duplicate', { kind: 'system', id: 'volcanic', name: 'My Volcanic' })
    expect(out).toContain('editable')
    const id = useCustomThemeStore.getState().system[0].id
    expect(THEMES[id].label).toBe('My Volcanic')
    expect(THEMES[id].editorChrome).toEqual(THEMES.volcanic.editorChrome)
    // And now it CAN be edited, which the original could not.
    expect(await run('theme:setColors', { kind: 'system', id, colors: { accent: '#00ff00' } }))
      .not.toContain('FAILED')
  })

  it('deletes, and gets off the theme first if it is in use', async () => {
    const id = await create('system', 'Warm', 'forest')
    await run('ui:theme', { theme: id })
    expect(useThemeStore.getState().current).toBe(id)
    await run('theme:delete', { kind: 'system', id })
    expect(THEMES[id]).toBeUndefined()
    // Falls back to what it was built from, not to a dangling id.
    expect(useThemeStore.getState().current).toBe('forest')
  })

  it('refuses to delete a shipped theme', async () => {
    const out = await run('theme:delete', { kind: 'system', id: 'dark' })
    expect(out).toContain('FAILED')
    expect(THEMES.dark).toBeDefined()
  })

  it('is a confirm-tier action, because it cannot be undone', () => {
    expect(actionById('theme:delete')?.tier).toBe('confirm')
  })
})

describe('theme files', () => {
  it('round-trips a theme through a file', async () => {
    const id = await create('system', 'Warm Night', 'arctic')
    await run('theme:setColors', { kind: 'system', id, colors: { accent: '#e8905a' } })
    const out = await run('theme:export', { kind: 'system', id, path: '/out/warm.ourgeotheme.json' })
    expect(out).toContain('/out/warm.ourgeotheme.json')

    await run('theme:delete', { kind: 'system', id })
    expect(THEMES[id]).toBeUndefined()

    const back = await run('theme:import', { path: '/out/warm.ourgeotheme.json' })
    expect(back).toContain('Warm Night')
    const restored = useCustomThemeStore.getState().system[0]
    expect(restored.colors.accent).toBe('#e8905a')
  })

  // The reason the file format declares its own kind: a code palette and a
  // markdown palette are both a flat map of colour names, so the payload alone
  // cannot say which list a file belongs in.
  it('refuses a file meant for another axis, naming what it actually is', async () => {
    const id = await create('system', 'Warm Night', 'arctic')
    await run('theme:export', { kind: 'system', id, path: '/out/warm.ourgeotheme.json' })
    const out = await run('theme:import', { path: '/out/warm.ourgeotheme.json', kind: 'code' })
    expect(out).toContain('FAILED')
    expect(out).toContain('App theme file')
    expect(out).toContain('Warm Night')
    expect(out).toContain('App Themes')
  })

  it('accepts any axis when the caller does not insist', async () => {
    const id = await create('code', 'My Nord', 'nord')
    await run('theme:export', { kind: 'code', id, path: '/out/nord.ourgeotheme.json' })
    await run('theme:delete', { kind: 'code', id })
    expect(await run('theme:import', { path: '/out/nord.ourgeotheme.json' }))
      .toContain('My Nord')
  })

  it('refuses to export a shipped theme, pointing at duplicate', async () => {
    const out = await run('theme:export', { kind: 'system', id: 'dark', path: '/out/x.json' })
    expect(out).toContain('FAILED')
    expect(out).toContain('theme:duplicate')
  })

  it('says so when the file is missing or is not a theme file', async () => {
    expect(await run('theme:import', { path: '/nope.json' })).toContain('Could not read')
    files.set('/x.json', '{"hello":"world"}')
    expect(await run('theme:import', { path: '/x.json' })).toContain('not an ouRGeo theme file')
  })
})
