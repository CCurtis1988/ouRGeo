// Every GUI action in one place.
//
// The registry is the whole point of the design: the assistant discovers what
// it can do by searching this, rather than by carrying ninety tool definitions
// in its context. It is also what the permissions dialog enumerates and what
// the integrity test walks, so an action that is not here does not exist.
//
// It is LIVE. Plugins contribute actions while the app runs, and a registry
// captured at module load could never hold one — the same failure `valuesAt`
// exists to prevent one level down (see the comment in types.ts), where a
// theme the assistant had just built was rejected by an enum evaluated before
// it existed. So `ALL_ACTIONS` is a function, not an array, and the lookup map
// is rebuilt whenever the plugin set changes.

import { uiActions } from './ui'
import { editorActions } from './editor'
import { projectActions } from './project'
import { dataActions } from './data'
import { environmentActions, packagesActions } from './environment'
import { helpActions } from './help'
import { mapActions } from './map'
import { drawActions } from './draw'
import { plotsActions, sessionActions, settingsActions } from './session'
import { themeActions } from './theme'
import { layoutActions } from './layout'
import { pluginActions } from './plugin'
import { connectorActions } from './connector'
import { terminalActions } from './terminal'
import { chatActions } from './chat'
import { GROUP_LABELS, describeAction, groupLabel, type UiAction } from './types'
import { resolveTier, type Switches } from './permissions'

const BUILTIN: UiAction[] = [
  ...uiActions,
  ...editorActions,
  ...projectActions,
  ...dataActions,
  ...environmentActions,
  ...packagesActions,
  ...helpActions,
  ...mapActions,
  ...drawActions,
  ...plotsActions,
  ...sessionActions,
  ...settingsActions,
  ...themeActions,
  ...layoutActions,
  ...pluginActions,
  ...connectorActions,
  ...terminalActions,
  ...chatActions,
]

/** The actions ouRGeo ships. The integrity test walks these, not the live set:
 *  a plugin's ids follow different rules and are checked separately. */
export const BUILTIN_ACTIONS: readonly UiAction[] = BUILTIN

const BUILTIN_IDS = new Set(BUILTIN.map((a) => a.id))

let live: UiAction[] = BUILTIN
let byId = new Map(BUILTIN.map((a) => [a.id, a]))

/** The live list — shipped first, then whatever plugins registered.
 *  Call this, don't cache it: the set changes when a plugin is enabled. */
export function actionList(): UiAction[] {
  return live
}

/** Every action id, for the permissions dialog and tests. */
export function actionIds(): string[] {
  return live.map((a) => a.id)
}

/**
 * Replace every plugin-contributed action with `actions`, in one pass.
 *
 * Idempotent by rebuilding rather than diffing, exactly like
 * `registerCustomThemes`: the plugin store re-registers the whole set after
 * every enable/disable/reload, so an action whose plugin is gone has to leave.
 * A shipped id is never shadowed — a plugin claiming `map:addLayer` is dropped
 * rather than allowed to replace it, because the user would have no way to
 * tell that the button and the assistant had stopped agreeing.
 */
export function registerPluginActions(actions: UiAction[]): void {
  const kept: UiAction[] = []
  const seen = new Set<string>()
  for (const a of actions) {
    if (BUILTIN_IDS.has(a.id) || seen.has(a.id)) continue
    seen.add(a.id)
    kept.push(a)
  }
  live = kept.length === 0 ? BUILTIN : [...BUILTIN, ...kept]
  byId = new Map(live.map((a) => [a.id, a]))
}

export function actionById(id: string): UiAction | undefined {
  const want = id.trim()
  return byId.get(want) ?? live.find((a) => a.id.toLowerCase() === want.toLowerCase())
}

export function actionsInGroup(group: string): UiAction[] {
  return live.filter((a) => a.group === group)
}

/** Search over id, summary and group label. An empty query matches everything. */
export function searchActions(query: string, group?: string): UiAction[] {
  const q = query.trim().toLowerCase()
  const g = (group ?? '').trim().toLowerCase()
  return live.filter((a) => {
    if (g && a.group !== g && !groupLabel(a.group).toLowerCase().includes(g)) return false
    if (!q) return true
    return a.id.toLowerCase().includes(q)
      || a.summary.toLowerCase().includes(q)
      || groupLabel(a.group).toLowerCase().includes(q)
  })
}

/** Full listing of matched actions, tiers resolved against the user's overrides. */
export function listActions(query: string, group?: string, switches?: Switches): string {
  // An action behind a switch the user has not turned on is not listed at all.
  // Discovering a capability and then being refused it costs the model a turn
  // and the user a confusing sentence; `buildToolGuidance` states the switch
  // positions up front instead.
  const hits = searchActions(query, group)
    .filter((a) => !a.requires || (switches && switches[a.requires]))
  if (hits.length === 0) {
    return `No actions match. Groups: ${Object.entries(GROUP_LABELS).map(([id, l]) => `${id} (${l})`).join(', ')}.`
  }
  const byGroup = new Map<string, UiAction[]>()
  for (const a of hits) {
    const list = byGroup.get(a.group) ?? []
    list.push(a)
    byGroup.set(a.group, list)
  }
  const out: string[] = []
  for (const [group, actions] of byGroup) {
    out.push(`## ${groupLabel(group)}`)
    for (const a of actions) out.push(describeAction(a, resolveTier(a)))
  }
  return out.join('\n')
}

/**
 * Just the ids, by group — the compact index carried in the system prompt.
 *
 * Cheap enough to include on every request (~400 tokens), and it means the
 * model usually knows the id it wants without a discovery round trip; it only
 * calls `list_ui_actions` when it needs the parameters.
 *
 * Walks `GROUP_LABELS`, so shipped groups come first and a plugin's group is
 * appended — the model reads the application it was shipped before it reads
 * what has been bolted on.
 */
export function actionIndex(): string {
  const out: string[] = []
  for (const group of Object.keys(GROUP_LABELS)) {
    const ids = actionsInGroup(group).map((a) => a.id)
    if (ids.length > 0) out.push(`${groupLabel(group)}: ${ids.join(', ')}`)
  }
  return out.join('\n')
}
