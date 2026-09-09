/**
 * The files a clean exit deletes.
 *
 * ouRGeo's userData directory holds two kinds of state, and the difference is
 * invisible from a filename:
 *
 * - **Preferences** — `theme.json`, `layout.json`, `plugins.json`,
 *   `ai-preferences.json` and the rest. Kept for ever. A user who moved a
 *   panel yesterday expects it there today.
 * - **Session-scoped** — this list. Written while the app runs so a renderer
 *   reload or a crash does not cost the user their work, and deleted by the
 *   `will-quit` handler so the next launch starts clean. A crash never reaches
 *   `will-quit`, which is what leaves these behind for recovery.
 *
 * `session.json` is deliberately in NEITHER: it holds scratch's open code
 * tabs, and those are the one thing ouRGeo keeps across restarts on purpose.
 *
 * The list lives here, in a module a test can read, rather than inline in
 * `electron/main/index.ts`, because an omission is silent in exactly the way
 * that matters: a file left off it survives a clean exit, and the symptom is
 * yesterday's state appearing in a session the user expected to be fresh —
 * with nothing on screen to explain it. That is the same argument that moved
 * the permission allowlist into `app-permissions.ts`, and it is made for the
 * same reason: this list had already been wrong once.
 */
export const SESSION_SCOPED_FILES: readonly string[] = [
  'plots.json',
  'spatial-layers.json',
  'spatial-ui.json',
  'console.json',
  'object-tabs.json',
  /**
   * Scratch's AI conversations.
   *
   * Scratch is the workspace ouRGeo always launches into and cannot save in
   * place, so a conversation worth keeping is a reason to Save As — after
   * which the chats live in the `.ourgeoproj` and are kept for good. What this
   * file buys is the middle: a reload or a crash does not throw away the
   * conversation the user is in the middle of having.
   */
  'ai-chats.json',
]
