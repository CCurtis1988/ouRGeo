import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useTerminalStore } from '@/store/terminal'
import { useThemeStore } from '@/store/theme'
import { buildTerminalTheme } from '@/lib/terminal/theme'
import { registerSink } from '@/lib/terminal/sessions'
import { THEMES } from '@/lib/themes'
import { resolveCodeTheme } from '@/lib/editor-themes'
import '@xterm/xterm/css/xterm.css'

// One shell, drawn.
//
// ── Bytes do not go through React ──────────────────────────────────────────
//
// A pty emits data tens of times a second and a busy command far more often
// than that. Nothing here puts output into a store or into state: the sink
// writes straight into xterm's buffer, and the only things that reach React
// are the four facts the tab strip draws (title, cwd, alive, bell). This is
// the same rule the voice level meter needed, and the same failure it avoids —
// a panel re-rendering sixty times a second for the length of a `cat`.
//
// ── Every view stays mounted ───────────────────────────────────────────────
//
// A hidden tab keeps its Terminal instance rather than unmounting it. That is
// what preserves a running program's screen, the scrollback and the viewport
// across a tab switch; recreating on activation would replay from main's ring
// and land the user at the bottom of a screen they were reading the middle of.
// The cost is that a hidden element measures zero, so `fit()` must run when
// the tab becomes visible rather than only on resize.

interface Props {
  id: string
  active: boolean
}

export function TerminalView({ id, active }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  const themeId = useThemeStore((s) => s.current)
  const codeThemeId = useThemeStore((s) => s.codeTheme)
  const revision = useThemeStore((s) => s.revision)
  const fontSize = useTerminalStore((s) => s.prefs.fontSize)
  const scrollback = useTerminalStore((s) => s.prefs.scrollback)
  const cursorStyle = useTerminalStore((s) => s.prefs.cursorStyle)
  const cursorBlink = useTerminalStore((s) => s.prefs.cursorBlink)
  const copyOnSelect = useTerminalStore((s) => s.prefs.copyOnSelect)

  // Read through refs inside the mount effect, so changing a preference
  // restyles the live terminal (the effects below) instead of tearing down the
  // shell and starting a new one.
  const optionsRef = useRef({ fontSize, scrollback, cursorStyle, cursorBlink })
  optionsRef.current = { fontSize, scrollback, cursorStyle, cursorBlink }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const opts = optionsRef.current

    const term = new Terminal({
      // Nerd-font variants first: a modern prompt (starship, powerlevel10k,
      // oh-my-posh) is mostly private-use glyphs, and without a patched font
      // every one of them renders as a replacement box. Anyone who has one
      // installed has it under one of these names; everyone else falls through
      // to the same stack the editor uses.
      fontFamily: [
        '"JetBrainsMono Nerd Font"', '"FiraCode Nerd Font"', '"Hack Nerd Font"',
        '"MesloLGS NF"', '"CaskaydiaCove Nerd Font"',
        '"JetBrains Mono"', '"Fira Code"', '"Cascadia Code"', 'monospace',
      ].join(', '),
      fontSize: opts.fontSize,
      scrollback: opts.scrollback,
      cursorStyle: opts.cursorStyle,
      cursorBlink: opts.cursorBlink,
      // The pane paints its own background; a terminal that painted a second
      // one would draw a box inside the panel it is supposed to fill.
      allowTransparency: false,
      // Without this, a program that has not been told the width wraps at 80
      // columns inside a much wider pane.
      convertEol: false,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    // Powerline glyphs and CJK are two columns wide, and the width table that
    // knows so is the Unicode 11 one; without activating it the cursor drifts
    // a column per glyph on any prompt with an icon in it.
    term.unicode.activeVersion = '11'
    term.loadAddon(new WebLinksAddon((event, uri) => {
      // Ctrl/Cmd-click only: a plain click in a terminal is how you place a
      // selection, and hijacking it would make URLs in output impossible to
      // select. `openExternal` in main already refuses non-web schemes.
      if (!event.ctrlKey && !event.metaKey) return
      void window.electronAPI.shell.openExternal(uri)
    }))

    term.open(host)
    termRef.current = term
    fitRef.current = fit

    // The renderer is loaded after `open`, because it needs the canvas that
    // `open` creates. WebGL is worth the branch — the DOM renderer costs a
    // frame or more on a full-screen redraw — but its context is genuinely
    // lost on some Linux GPU stacks, and an unhandled loss is a blank panel.
    let disposeWebgl: (() => void) | null = null
    void (async () => {
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl')
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          disposeWebgl = null
        })
        term.loadAddon(webgl)
        disposeWebgl = () => webgl.dispose()
      } catch {
        // No WebGL here; the DOM renderer is already running.
      }
    })()

    term.onData((data) => { window.electronAPI.terminal.write(id, data) })
    term.onTitleChange((title) => {
      const s = useTerminalStore.getState()
      // A user's own name outranks the shell's, which retitles on every
      // command in most default prompts and would erase theirs immediately.
      if (!s.sessions.find((x) => x.id === id)?.renamed) s.patchSession(id, { title })
    })
    term.onBell(() => {
      const s = useTerminalStore.getState()
      if (s.activeId !== id) s.patchSession(id, { bell: true })
    })
    // OSC 7 — the directory the shell is in. Best-effort: plenty of shells
    // never emit it, which is why nothing depends on the answer. Registered on
    // xterm's parser rather than matched against raw chunks, because a
    // sequence split across two reads is routine and the parser reassembles it.
    term.parser.registerOscHandler(7, (payload) => {
      const path = decodeURIComponent(payload.replace(/^file:\/\/[^/]*/, ''))
      if (path.startsWith('/')) useTerminalStore.getState().patchSession(id, { cwd: path })
      return false
    })

    // Registered BEFORE the attach: data emitted while that round trip is in
    // flight is sent straight away, and a sink installed after the await would
    // miss it. Buffer until the replay has been written, then go direct.
    let replayed = false
    const early: string[] = []
    const write = (data: string): void => {
      term.write(data, () => window.electronAPI.terminal.ack(id, data.length))
    }
    const unsink = registerSink(id, (data) => {
      if (replayed) write(data)
      else early.push(data)
    })

    let disposed = false
    void window.electronAPI.terminal.attach(id).then((res) => {
      if (disposed) return
      if (res.ok && res.replay) term.write(res.replay)
      replayed = true
      for (const chunk of early) write(chunk)
      early.length = 0
      fit.fit()
      window.electronAPI.terminal.resize(id, term.cols, term.rows)
    })

    // The element's own box, not the window: a panel resizes when a divider
    // moves, when a sibling opens, and when its zone changes mode, none of
    // which fire a window resize.
    const ro = new ResizeObserver(() => {
      if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return
      try {
        fit.fit()
        window.electronAPI.terminal.resize(id, term.cols, term.rows)
      } catch {
        // A fit against a box mid-transition can throw; the next one is fine.
      }
    })
    ro.observe(host)

    return () => {
      disposed = true
      ro.disconnect()
      unsink()
      disposeWebgl?.()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [id])

  // Restyle in place. `theme` is a settable option, so a theme change never
  // costs the user their scrollback — the reason this is a separate effect
  // from the one above rather than another entry in its dependency list.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const system = THEMES[themeId] ?? THEMES.dark
    term.options.theme = buildTerminalTheme(system, resolveCodeTheme(themeId, codeThemeId))
  }, [themeId, codeThemeId, revision])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    term.options.scrollback = scrollback
    term.options.cursorStyle = cursorStyle
    term.options.cursorBlink = cursorBlink
    try {
      fitRef.current?.fit()
      window.electronAPI.terminal.resize(id, term.cols, term.rows)
    } catch { /* not laid out yet */ }
  }, [id, fontSize, scrollback, cursorStyle, cursorBlink])

  // Konsole's habit, and off by default: a selection that silently replaces
  // the clipboard surprises everyone who did not ask for it.
  useEffect(() => {
    const term = termRef.current
    if (!term || !copyOnSelect) return
    const sub = term.onSelectionChange(() => {
      const text = term.getSelection()
      if (text) void navigator.clipboard.writeText(text)
    })
    return () => sub.dispose()
  }, [copyOnSelect])

  // Becoming visible is the moment a hidden terminal has a size at all, so it
  // is the moment to measure. Two frames: one for the display change to apply,
  // one for the pane's own layout to settle around it.
  useEffect(() => {
    if (!active) return
    let raf = 0
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const term = termRef.current
        if (!term) return
        try {
          fitRef.current?.fit()
          window.electronAPI.terminal.resize(id, term.cols, term.rows)
          term.focus()
        } catch { /* not laid out yet */ }
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [active, id])

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden px-2 pb-1"
      data-ourgeo-id="terminal.screen"
      style={{ display: active ? 'block' : 'none' }}
    />
  )
}
