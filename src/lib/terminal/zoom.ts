// Ctrl+= / Ctrl+- while a terminal has the keyboard.
//
// In every terminal that exists, that pair is font size. Scaling the whole
// interface instead is not what the user meant, and it is the kind of wrong
// answer that makes an embedded terminal feel embedded.
//
// It cannot be decided inside the terminal, which is why this is a module and
// not a key handler. `electron/main/index.ts` intercepts Ctrl+± in
// `before-input-event` and calls `preventDefault`, so the keystroke never
// reaches the focused element at all — the renderer only ever sees the
// `ui:zoom` message. `EditorLayout` asks here first, and falls through to the
// UI scale when the answer is no.

import { useTerminalStore } from '@/store/terminal'

const MIN = 8
const MAX = 32

/** Whether the keyboard is inside a terminal right now. `.xterm` is xterm's
 *  own container class, and its textarea is what actually holds focus. */
export function terminalHasFocus(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  return !!el && !!el.closest?.('.xterm')
}

/** Change the terminal font size, or report that this keystroke was not ours.
 *  Returns false when no terminal has focus, which is the caller's signal to
 *  do what it would have done anyway. */
export function zoomFocusedTerminal(direction: 'in' | 'out'): boolean {
  if (!terminalHasFocus()) return false
  const store = useTerminalStore.getState()
  const next = Math.min(MAX, Math.max(MIN, store.prefs.fontSize + (direction === 'in' ? 1 : -1)))
  if (next !== store.prefs.fontSize) store.setPrefs({ fontSize: next })
  // True even when already at a limit: the keystroke WAS the terminal's, and
  // falling through at the end of the range would rescale the whole interface
  // instead — the surprise being worse for happening only at the extremes.
  return true
}
