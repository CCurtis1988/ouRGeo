import { describe, it, expect } from 'vitest'
import { buildTerminalTheme, ANSI_SLOTS, type TerminalTheme } from './theme'
import { BUILTIN_THEMES } from '../themes'
import { BUILTIN_CODE_THEMES, resolveCodeTheme } from '../editor-themes'
import { contrastRatio } from '../custom-themes'

const themes = Object.values(BUILTIN_THEMES)
const codeThemes = Object.values(BUILTIN_CODE_THEMES)

/** Every app theme paired with the code theme it ships with. */
const shipped = themes.map((t) => ({
  system: t,
  code: resolveCodeTheme(t.id, t.defaultCodeTheme),
}))

describe('the palette every shipped combination produces', () => {
  it.each(shipped.map((p) => [p.system.label, p] as const))(
    '%s has sixteen valid six-digit colours',
    (_label, pair) => {
      const theme = buildTerminalTheme(pair.system, pair.code)
      for (const slot of ANSI_SLOTS) {
        // xterm's colour parser throws from inside the Terminal constructor on
        // anything that is not six or eight hex digits, taking the panel with
        // it and leaving no stack that points back at the theme.
        expect(theme[slot], `${String(slot)} of ${pair.system.id}`).toMatch(/^#[0-9a-f]{6}$/)
      }
    },
  )

  it.each(shipped.map((p) => [p.system.label, p] as const))(
    '%s keeps every colour legible on its own background',
    (_label, pair) => {
      const theme = buildTerminalTheme(pair.system, pair.code)
      for (const slot of ANSI_SLOTS) {
        if (slot === 'black') continue // deliberately the low-contrast end
        expect(
          contrastRatio(theme[slot], theme.background),
          `${String(slot)} of ${pair.system.id}`,
        ).toBeGreaterThan(2.4)
      }
    },
  )

  it.each(shipped.map((p) => [p.system.label, p] as const))(
    '%s keeps the six chromatic slots distinguishable from each other',
    (_label, pair) => {
      // The failure this prevents: a palette whose `keyword` and `fn` are both
      // blue collapsing two ANSI slots onto one colour, after which `ls` cannot
      // tell a directory from an executable.
      const theme = buildTerminalTheme(pair.system, pair.code)
      const chromatic = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const
      const seen = new Set(chromatic.map((c) => theme[c]))
      expect(seen.size).toBe(chromatic.length)
    },
  )
})

describe('which theme owns which colour', () => {
  // The invariant editor-themes.test.ts pins for Monaco, restated here because
  // the terminal is the second surface where the two palettes meet — and a code
  // palette that repaints the surface it is drawn on is invisible until someone
  // picks the one combination where the two disagree.
  it('takes the background from the app theme, never from the code theme', () => {
    const system = BUILTIN_THEMES.dark
    const backgrounds = codeThemes.map((c) => buildTerminalTheme(system, c).background)
    expect(new Set(backgrounds).size).toBe(1)
    expect(backgrounds[0]).toBe(system.editorChrome.bg.toLowerCase())
  })

  it('takes the foreground and cursor from the app theme too', () => {
    const system = BUILTIN_THEMES.dark
    const built = codeThemes.map((c) => buildTerminalTheme(system, c))
    expect(new Set(built.map((t) => t.foreground)).size).toBe(1)
    expect(new Set(built.map((t) => t.cursor)).size).toBe(1)
  })

  it('changes the ANSI ramp when the code theme changes', () => {
    // The other half of the promise: switching code theme has to actually
    // recolour `ls`, or the separation above is just a way of ignoring it.
    const system = BUILTIN_THEMES.dark
    const ramps = codeThemes.map((c) => {
      const t = buildTerminalTheme(system, c)
      return ANSI_SLOTS.map((s) => t[s]).join(',')
    })
    expect(new Set(ramps).size).toBeGreaterThan(1)
  })

  it('moves the background when the app theme changes', () => {
    const code = BUILTIN_CODE_THEMES.dark
    const backgrounds = themes.map((t) => buildTerminalTheme(t, code).background)
    expect(new Set(backgrounds).size).toBeGreaterThan(1)
  })
})

describe('a palette with nothing useful in it', () => {
  const grey = {
    ...BUILTIN_CODE_THEMES.dark,
    id: 'grey', label: 'Grey',
    fg: '#cccccc', comment: '#888888', keyword: '#bbbbbb', constant: '#b0b0b0',
    string: '#a8a8a8', number: '#c0c0c0', operator: '#9a9a9a', fn: '#d0d0d0',
    tag: '#b8b8b8', delimiter: '#999999', error: '#a0a0a0',
  }

  it('falls back to the base ramp rather than six shades of grey', () => {
    const theme = buildTerminalTheme(BUILTIN_THEMES.dark, grey)
    const chromatic = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const
    for (const slot of chromatic) {
      // Every one of them came from the fallback, so every one is colourful.
      const hex = theme[slot]
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${slot} is grey`).toBeGreaterThan(30)
    }
  })
})

describe('the surface colours', () => {
  const theme: TerminalTheme = buildTerminalTheme(
    BUILTIN_THEMES.dark, BUILTIN_CODE_THEMES.dark,
  )

  it('punches the character out of a block cursor rather than colouring it', () => {
    expect(theme.cursorAccent).toBe(theme.background)
  })

  it('never makes ANSI black the background itself', () => {
    // A program printing black text would otherwise be invisible — which is not
    // a theoretical concern, it is what a `\033[30m` prompt does.
    expect(theme.black).not.toBe(theme.background)
  })

  it('keeps selection opaque, so it obeys the same six-digit rule', () => {
    expect(theme.selectionBackground).toMatch(/^#[0-9a-f]{6}$/)
  })
})
