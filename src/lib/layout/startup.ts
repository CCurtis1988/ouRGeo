import { defaultLayout, normalize, type LayoutState, type PanelMeta } from './model'
import { alignTerminalMode } from '@/lib/terminal/placement'
import type { TerminalPlacement } from '@/lib/terminal-preferences-persistence'

/** Preferences seed a new arrangement; an existing arrangement owns its modes.
 * Reapplying Terminal's tab preference to an old split also rearranged Project
 * Files on migration, even though its only job was to join the Console's zone. */
export function startupLayout(stored: LayoutState | null, panels: PanelMeta[], terminal: TerminalPlacement): LayoutState {
  const normalised = normalize(stored ?? defaultLayout(panels), panels)
  return stored ? normalised : alignTerminalMode(normalised, terminal, false)
}
