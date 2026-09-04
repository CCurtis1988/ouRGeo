// The two menu items an environment carries wherever it is drawn: where the
// panel lists it, and whether the console works inside it.
//
// Shared because it appears on both of them: on the group of a promoted
// environment, and on the ROW of a child one inside .GlobalEnv. Whichever the
// user is looking at, the way to the other is the same menu in the same place.

import { DEFAULT_PLACEMENT, GLOBAL_ENV, type EnvPlacement } from '@/lib/environments'
import { useEnvironmentStore } from '@/store/environment'
import { setWorkingEnv, workingEnv } from '@/lib/working-env'
import type { ContextMenuItem } from '../ui/context-menu'

// Where the panel LISTS it. Deliberately not "parent" and "child": in R those
// words name the enclosure `new.env(parent = …)` sets, and every environment
// ouRGeo makes has the same one (.GlobalEnv). Borrowing them for a display
// setting promised a difference in behaviour that does not exist — a user made
// one of each and quite reasonably expected them to act differently.
const CHOICES: [EnvPlacement, string][] = [
  ['promoted', 'Beside .GlobalEnv'],
  ['child', 'Inside .GlobalEnv'],
]

/**
 * `current` marks the state with a bullet, the way the database submenu marks
 * an open database — the ContextMenu has no checkable item, and a menu that
 * offers two choices without saying which one you are in is a menu you have to
 * guess at.
 */
export function placementMenu(
  envName: string, current: EnvPlacement = DEFAULT_PLACEMENT,
): ContextMenuItem {
  return {
    label: 'Show',
    submenu: CHOICES.map(([value, label]) => ({
      // A figure space, not two spaces: HTML collapses runs of whitespace,
      // so plain spaces would leave the unmarked row jammed against the
      // edge while the marked one sits a character in.
      label: `${current === value ? '• ' : '\u2007 '}${label}`,
      onClick: () => useEnvironmentStore.getState().setEnvPlacement(envName, value),
    })),
  }
}

/**
 * Run code inside this environment, instead of in .GlobalEnv.
 *
 * The answer to "why can't I just type `x * a`?" — see `working-env.ts`. Not
 * offered for a package environment: its bindings are locked, so the first
 * assignment would fail and there is nothing else the user would be there for.
 */
export function workHereItem(envName: string): ContextMenuItem {
  const active = workingEnv() === envName
  if (envName === GLOBAL_ENV) {
    return {
      label: 'Work in .GlobalEnv',
      disabled: active,
      onClick: () => setWorkingEnv(GLOBAL_ENV),
    }
  }
  return active
    ? { label: `Stop working in ${envName}`, onClick: () => setWorkingEnv(GLOBAL_ENV) }
    : { label: 'Work in this environment', onClick: () => setWorkingEnv(envName) }
}
