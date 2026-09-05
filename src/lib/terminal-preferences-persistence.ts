import { createJsonFileStore } from '@/lib/persistence'

// How the terminal is set up, kept between sessions.
//
// A PREFERENCE, so it sits on the same side of the userData split as
// `theme.json` and `layout.json` and must never join the `will-quit` delete
// list. What is deliberately NOT here: which terminal tabs were open, and
// anything that was in them. A terminal is a live process — restoring a dead
// tab that looks alive is worse than starting clean — and terminal output is
// exactly the sort of thing rule 22 keeps out of files on disk.

const store = createJsonFileStore('terminal-preferences.json', 'Terminal Prefs')

/**
 * Where the Terminal panel sits relative to the R console.
 *
 * A remembered choice that ACTS when it changes, not a live binding: the user
 * can drag the panel anywhere afterwards and ouRGeo leaves it there. A setting
 * that re-asserted itself would undo that drag on the next launch, which is the
 * opposite of a workspace the user controls.
 */
export type TerminalPlacement = 'tab' | 'split'

export interface TerminalPreferences {
  placement: TerminalPlacement
  /** Shell profile id, or null for "whatever this machine's best is". */
  profileId: string | null
  fontSize: number
  /** Lines of scrollback per session. */
  scrollback: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  /** Konsole's habit, and a surprise to everyone else — hence off. */
  copyOnSelect: boolean
  /** Open new terminals in R's working directory rather than the home one. */
  followRWorkingDir: boolean
}

const DEFAULTS: TerminalPreferences = {
  placement: 'tab',
  profileId: null,
  fontSize: 12,
  scrollback: 10_000,
  cursorStyle: 'block',
  cursorBlink: true,
  copyOnSelect: false,
  followRWorkingDir: true,
}

export const TERMINAL_PREFERENCE_DEFAULTS: Readonly<TerminalPreferences> = DEFAULTS

const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

/** Read the file defensively: a hand-edited or half-written one must load as
 *  defaults rather than put a NaN font size into xterm, which throws. */
export async function loadTerminalPreferences(): Promise<TerminalPreferences> {
  const data = await store.read<Record<string, unknown>>()
  return {
    placement: data.placement === 'split' ? 'split' : 'tab',
    profileId: typeof data.profileId === 'string' && data.profileId.length > 0
      ? data.profileId
      : null,
    fontSize: num(data.fontSize, DEFAULTS.fontSize, 8, 32),
    scrollback: num(data.scrollback, DEFAULTS.scrollback, 100, 200_000),
    cursorStyle: data.cursorStyle === 'underline' || data.cursorStyle === 'bar'
      ? data.cursorStyle
      : 'block',
    cursorBlink: bool(data.cursorBlink, DEFAULTS.cursorBlink),
    copyOnSelect: bool(data.copyOnSelect, DEFAULTS.copyOnSelect),
    followRWorkingDir: bool(data.followRWorkingDir, DEFAULTS.followRWorkingDir),
  }
}

export async function saveTerminalPreferences(
  patch: Partial<TerminalPreferences>,
): Promise<void> {
  await store.merge(patch as Record<string, unknown>)
}
