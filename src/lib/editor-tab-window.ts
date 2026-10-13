export const EDITOR_TAB_WIDTH = 180

/** Keep every large-workspace tab reachable without laying out one DOM button
 * per buffer. Overscan preserves nearby click/drag targets while scrolling. */
export function editorTabWindow(count: number, offset: number, viewport: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(count, Math.floor(Math.max(0, offset) / EDITOR_TAB_WIDTH) - 3))
  return { start, end: Math.max(start, Math.min(count, Math.ceil((Math.max(0, offset) + Math.max(EDITOR_TAB_WIDTH, viewport)) / EDITOR_TAB_WIDTH) + 3)) }
}
