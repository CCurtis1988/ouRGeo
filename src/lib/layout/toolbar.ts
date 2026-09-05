// The top toolbar, as data.
//
// Fourteen buttons that were fourteen copy-pasted <Button> blocks differing
// only in icon, handler, title and `data-ourgeo-id`. As JSX their order and
// visibility were facts about the source file; as data they are facts about
// the layout, which is what lets the user (or the assistant) reorder them,
// hide the ones they never press, and get them back.
//
// It is also the single source of truth for the toolbar half of the highlight
// catalogue — `ai-actions/targets.ts` derives its `toolbar.*` entries from
// here, so a button and the thing the assistant points at can no longer drift
// apart. (The bidirectional test in registry.test.ts still checks both against
// the real `data-ourgeo-id` attributes in the source.)

import {
  FolderOpen, Save, SaveAll, Package, Layers, Globe, FolderInput, Circle,
  ImageIcon, Cloud, Bot, Wrench, HelpCircle, Database, SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import type { DialogId } from '@/store/ui'
import type { PanelId } from './model'

/**
 * What a button does, declaratively.
 *
 * `panel` and `dialog` cover twelve of the fourteen; `command` is the escape
 * for the two that are neither (open/save/save-as go through the editor store,
 * recording toggles rather than opens). Keeping them separate rather than
 * giving every button an `onClick` is what makes the array serializable, and
 * therefore what makes a plugin able to contribute one.
 */
export type ToolbarCommand = 'openFile' | 'save' | 'saveAs' | 'record'

export interface ToolbarButtonDef {
  /** Stable id used in the layout file and by `layout:setToolbarButtons`. */
  id: string
  /** The `data-ourgeo-id` on the rendered control, and the highlight target. */
  targetId: string
  /** Tooltip, and the label the assistant uses in prose. */
  label: string
  icon: LucideIcon
  /** Toggles a panel; the button lights up while the panel is open. */
  panel?: PanelId
  /** Opens a dialog. */
  dialog?: DialogId
  /** Anything else — dispatched by the component's small command map. */
  command?: ToolbarCommand
  /**
   * Run a registered action by id. This is how a PLUGIN puts a button on the
   * toolbar: it already had to declare the action, so the button is a pointer
   * to it rather than a second place to put behaviour — and the action's tier
   * still applies, because the click goes through the same registry the
   * assistant does.
   */
  action?: string
}

const BUILTIN: ToolbarButtonDef[] = [
  { id: 'environment', targetId: 'toolbar.environment', label: 'Toggle Environment', icon: Layers, panel: 'environment' },
  { id: 'packages', targetId: 'toolbar.packages', label: 'Toggle Packages', icon: Package, panel: 'packages' },
  { id: 'openFile', targetId: 'toolbar.openFile', label: 'Open File (Ctrl+O)', icon: FolderOpen, command: 'openFile' },
  { id: 'save', targetId: 'toolbar.save', label: 'Save (Ctrl+S)', icon: Save, command: 'save' },
  { id: 'saveAs', targetId: 'toolbar.saveAs', label: 'Save As', icon: SaveAll, command: 'saveAs' },
  { id: 'loadData', targetId: 'toolbar.loadData', label: 'Load Data', icon: FolderInput, dialog: 'load-data' },
  { id: 'databases', targetId: 'toolbar.databases', label: 'Toggle Database Connections', icon: Database, panel: 'databases' },
  { id: 'dataConnector', targetId: 'toolbar.dataConnector', label: 'Data Connector', icon: Cloud, dialog: 'data-connector' },
  { id: 'toolbox', targetId: 'toolbar.toolbox', label: 'Toolbox', icon: Wrench, dialog: 'toolbox' },
  { id: 'ai', targetId: 'toolbar.ai', label: 'AI Assistant', icon: Bot, panel: 'ai' },
  { id: 'record', targetId: 'toolbar.record', label: 'Record Console', icon: Circle, command: 'record' },
  { id: 'terminal', targetId: 'toolbar.terminal', label: 'Toggle Terminal', icon: SquareTerminal, panel: 'terminal' },
  { id: 'spatial', targetId: 'toolbar.spatial', label: 'Toggle Spatial Editor', icon: Globe, panel: 'spatial' },
  { id: 'plots', targetId: 'toolbar.plots', label: 'Toggle Plotting Preview', icon: ImageIcon, panel: 'plots' },
  { id: 'help', targetId: 'toolbar.help', label: 'Help', icon: HelpCircle, panel: 'help' },
]

/** The buttons ouRGeo ships, in their shipped order. */
export const BUILTIN_TOOLBAR: readonly ToolbarButtonDef[] = BUILTIN

const BUILTIN_IDS = new Set(BUILTIN.map((b) => b.id))

let live: ToolbarButtonDef[] = BUILTIN

/** The live list — shipped first, then plugin-contributed. Don't cache it. */
export function toolbarButtons(): ToolbarButtonDef[] {
  return live
}

export function toolbarButtonById(id: string): ToolbarButtonDef | undefined {
  return live.find((b) => b.id === id)
}

/** Replace every plugin-contributed button, in one pass. Shipped ids win. */
export function registerPluginToolbarButtons(buttons: ToolbarButtonDef[]): void {
  const kept: ToolbarButtonDef[] = []
  const seen = new Set<string>()
  for (const b of buttons) {
    if (BUILTIN_IDS.has(b.id) || seen.has(b.id)) continue
    seen.add(b.id)
    kept.push(b)
  }
  live = kept.length === 0 ? BUILTIN : [...BUILTIN, ...kept]
}

/**
 * The buttons to render, in the user's order, with hidden ones dropped.
 *
 * `order` names the ones the user has arranged; anything not in it — a button
 * added by an update, or by a plugin enabled since — is appended in registry
 * order rather than silently disappearing.
 */
export function resolveToolbar(
  order: string[], hidden: string[],
): ToolbarButtonDef[] {
  const all = live
  const hide = new Set(hidden)
  const wanted = order.filter((id) => all.some((b) => b.id === id))
  const rest = all.map((b) => b.id).filter((id) => !wanted.includes(id))
  return [...wanted, ...rest]
    .map((id) => all.find((b) => b.id === id)!)
    .filter((b) => !hide.has(b.id))
}
