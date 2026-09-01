// Every GUI action in one place.
//
// The registry is the whole point of the design: the assistant discovers what
// it can do by searching this, rather than by carrying ninety tool definitions
// in its context. It is also what the permissions dialog enumerates and what
// the integrity test walks, so an action that is not here does not exist.

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
import { GROUP_LABELS, describeAction, type GroupId, type UiAction } from './types'
import { resolveTier } from './permissions'

export const ALL_ACTIONS: UiAction[] = [
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
]

const BY_ID = new Map(ALL_ACTIONS.map((a) => [a.id, a]))

export function actionById(id: string): UiAction | undefined {
  const want = id.trim()
  return BY_ID.get(want) ?? ALL_ACTIONS.find((a) => a.id.toLowerCase() === want.toLowerCase())
}

export function actionsInGroup(group: GroupId): UiAction[] {
  return ALL_ACTIONS.filter((a) => a.group === group)
}

/** Search over id, summary and group label. An empty query matches everything. */
export function searchActions(query: string, group?: string): UiAction[] {
  const q = query.trim().toLowerCase()
  const g = (group ?? '').trim().toLowerCase()
  return ALL_ACTIONS.filter((a) => {
    if (g && a.group !== g && !GROUP_LABELS[a.group].toLowerCase().includes(g)) return false
    if (!q) return true
    return a.id.toLowerCase().includes(q)
      || a.summary.toLowerCase().includes(q)
      || GROUP_LABELS[a.group].toLowerCase().includes(q)
  })
}

/** Full listing of matched actions, tiers resolved against the user's overrides. */
export function listActions(query: string, group?: string): string {
  const hits = searchActions(query, group)
  if (hits.length === 0) {
    return `No actions match. Groups: ${Object.entries(GROUP_LABELS).map(([id, l]) => `${id} (${l})`).join(', ')}.`
  }
  const byGroup = new Map<GroupId, UiAction[]>()
  for (const a of hits) {
    const list = byGroup.get(a.group) ?? []
    list.push(a)
    byGroup.set(a.group, list)
  }
  const out: string[] = []
  for (const [group, actions] of byGroup) {
    out.push(`## ${GROUP_LABELS[group]}`)
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
 */
export function actionIndex(): string {
  const out: string[] = []
  for (const group of Object.keys(GROUP_LABELS) as GroupId[]) {
    const ids = actionsInGroup(group).map((a) => a.id)
    if (ids.length > 0) out.push(`${GROUP_LABELS[group]}: ${ids.join(', ')}`)
  }
  return out.join('\n')
}
