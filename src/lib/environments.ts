// What the Environment panel shows, and where an object is allowed to go.
//
// R keeps a user's own environments as ordinary objects in `.GlobalEnv` —
// `myenv <- new.env()` puts an environment *inside* the global environment,
// and that is genuinely where it lives. The panel used to draw it that way and
// only that way: one more row among the data frames, expandable, three levels
// in.
//
// That is not always how anyone thinks about it. An environment the user made
// is often a PLACE — somewhere to keep a stage of the work — and a place is a
// sibling of .GlobalEnv, not a thing sitting in it. So `placement` is the
// user's answer, per environment, and it is one or the other:
//
//   promoted  — a group of its own beside .GlobalEnv, and no row. The
//               default: an environment is usually made to BE somewhere, and
//               a place three levels into a tree does not read as one.
//   child     — the row inside .GlobalEnv, where R actually keeps it.
//
// Never both. An environment listed twice is a panel inviting the user to
// wonder whether there are two of them.
//
// NONE of this is R's `parent`. `new.env(parent = …)` sets an environment's
// ENCLOSURE — where R keeps looking when a name is not found inside it — and
// every environment ouRGeo creates has .GlobalEnv there, so they all behave
// identically. `placement` decides where the PANEL draws one. The two settings
// were briefly labelled "parent" and "child", which promised a difference in
// behaviour that does not exist; a user made one of each, saw ouRGeo emit the
// same `new.env(parent = .GlobalEnv)` twice, and asked what it had done.
//
// Either way it is a place they can act on: `moveTargets` and `loadTargets`
// offer a child environment exactly as they offer a promoted one, and both
// carry the same operations — export, copy, rename, delete — from whichever
// of the two the panel is drawing.
//
// Promotion happens HERE, in the renderer, and deliberately not in
// `/env/list`. `!isSearchPath` is read in a dozen places to mean "an
// environment whose objects can be named directly in generated R" — dataset
// pickers, the toolbox, the AI's context block, the completion index. A user
// environment's objects CANNOT: they are `myenv$roads`, not `roads`. Promoting
// server-side would have quietly offered every one of them to every picker
// under a name that does not resolve.

import type { REnvironmentInfo, RObjectInfo } from '@/lib/r-client'

export const GLOBAL_ENV = '.GlobalEnv'

/** How the panel lists one of the user's environments — one or the other. */
export type EnvPlacement = 'promoted' | 'child'

/** Beside .GlobalEnv. What an environment gets unless the user moves it —
 *  including one made by typing `new.env()` into the console. */
export const DEFAULT_PLACEMENT: EnvPlacement = 'promoted'

/** Sparse: only the environments the user moved off the default. */
export type EnvPlacements = Record<string, EnvPlacement>

export function placementOf(placements: EnvPlacements, name: string): EnvPlacement {
  return placements[name] ?? DEFAULT_PLACEMENT
}

export interface PanelEnv extends REnvironmentInfo {
  /** Made by the user: an environment object living in .GlobalEnv. */
  isUserEnv?: boolean
  /** Where that object lives, so the panel can say so. */
  parentEnv?: string
  /** How this one is listed: `child` is a row inside .GlobalEnv, `promoted` a
   *  group beside it. Absent for .GlobalEnv and the search path. */
  placement?: EnvPlacement
  /**
   * Names lifted OUT of this environment's listing — the promoted
   * environments now shown beside it instead.
   *
   * An export still writes them (`save()` on .GlobalEnv writes every object in
   * it, environments included), so `exportedNames` adds them back. Without
   * this the console echoed a `save(list = …)` that named fewer objects than
   * the file it wrote.
   */
  hoisted?: string[]
}

/**
 * Every place in the session: .GlobalEnv, then the user's own environments,
 * then the search path. A child environment is in this list too — it is a
 * place objects can be moved to and a file can be loaded into, whatever the
 * panel draws — but it is NOT drawn as a group; see `treeEnvironments`.
 *
 * An environment nested deeper — inside a list, or inside another environment —
 * is left where it is. Only the top level of .GlobalEnv can be promoted,
 * because that is the only level at which `myenv` is a name the user can type.
 */
export function panelEnvironments(
  environments: REnvironmentInfo[], placements: EnvPlacements = {},
): PanelEnv[] {
  const global = environments.find((e) => e.name === GLOBAL_ENV)
  if (!global) return environments

  const places: PanelEnv[] = []
  const kept: RObjectInfo[] = []
  const hoisted: string[] = []
  for (const obj of global.objects) {
    if (obj.isEnvironment) {
      const placement = placementOf(placements, obj.name)
      places.push({
        name: obj.name,
        isSearchPath: false,
        isUserEnv: true,
        parentEnv: GLOBAL_ENV,
        placement,
        // `children` is absent when the walk refused to recurse (an
        // environment that is .GlobalEnv itself, or a cycle). An empty group
        // is the honest answer there — not a missing one.
        objects: obj.children ?? [],
      })
      // A child keeps its row and gets no group; a promoted one gets the
      // group and loses the row. One or the other, never both.
      if (placement === 'child') kept.push(obj)
      else hoisted.push(obj.name)
    } else {
      kept.push(obj)
    }
  }

  const rest = environments.filter((e) => e.name !== GLOBAL_ENV)
  return [{ ...global, objects: kept, hoisted }, ...places, ...rest]
}

/**
 * The panel with the eye ON — only the user's places, holding only their own
 * objects.
 *
 * `hidden` is the store's `rdataLoadedNames`: per environment, the names that
 * are not the user's work — ouRGeo's own source()d functions, and anything
 * restored from a file that said so.
 *
 * The second filter is the one worth knowing about. A user's environment is
 * still an OBJECT in its parent, so if the parent hides that object the group
 * has to go too — otherwise ouRGeo's own `server` environment, which lives in
 * .GlobalEnv and was correctly hidden while it was a row, comes back as a
 * top-level group the moment environments are listed beside it.
 */
export function userOnlyView(
  environments: PanelEnv[], hidden: Record<string, string[]>,
): PanelEnv[] {
  return environments
    .filter((e) => !e.isSearchPath)
    .filter((e) => !e.isUserEnv || !(hidden[e.parentEnv ?? GLOBAL_ENV] ?? []).includes(e.name))
    .map((e) => {
      const h = new Set(hidden[e.name] ?? [])
      if (h.size === 0) return e
      return {
        ...e,
        objects: e.objects.filter((o) => !h.has(o.name)),
        // Hidden applies to a hoisted name too, or an export of .GlobalEnv
        // would echo ouRGeo's own `server` environment while the file (written
        // with excludeSystem) leaves it out.
        hoisted: e.hoisted?.filter((n) => !h.has(n)),
      }
    })
}

/**
 * The groups the panel draws, in order.
 *
 * A child environment is drawn by the row it lives on, inside .GlobalEnv, so
 * it is not a group as well — that is the whole of the difference between the
 * two placements. It stays in `environments` for everything else: Move To,
 * Load, the Export list.
 */
export function treeEnvironments(environments: PanelEnv[]): PanelEnv[] {
  return environments.filter((e) => e.placement !== 'child')
}

/** Environments the user keeps their own objects in. */
export function isUserPlace(env: PanelEnv): boolean {
  return env.name === GLOBAL_ENV || env.isUserEnv === true
}

/**
 * Where an object may be moved or copied to.
 *
 * With the panel's filter on — the eye hiding what is not the user's — the list
 * is what the panel is showing: .GlobalEnv and the user's own environments,
 * however each of them is listed. Turning the filter off is the user saying
 * they want the whole session, so the list becomes every environment, package
 * environments included. Writing into one of those usually fails (bindings in
 * an attached package are locked), which is why the move reports what R said
 * instead of doing nothing.
 */
export function moveTargets(
  environments: PanelEnv[], from: string, showAll: boolean,
): string[] {
  return environments
    .filter((e) => (showAll ? true : isUserPlace(e)))
    .map((e) => e.name)
    .filter((n) => n !== from)
}

/** Environments a `.RData` file can be loaded into. */
export function loadTargets(environments: PanelEnv[]): PanelEnv[] {
  return environments.filter(isUserPlace)
}

/**
 * The objects an Export would write for one environment.
 *
 * ouRGeo's own functions are `source()`d into .GlobalEnv, so a plain
 * `save(list = ls(.GlobalEnv))` writes about a hundred of them into the user's
 * file. The server excludes them (`excludeSystem`); this is the same set, so
 * the R echoed to the console names exactly what the file will hold — which is
 * why the environments lifted out of the listing are counted back in.
 */
export function exportedNames(env: PanelEnv, systemNames: string[]): string[] {
  const system = new Set(env.name === GLOBAL_ENV ? systemNames : [])
  return [...env.objects.map((o) => o.name), ...(env.hoisted ?? [])]
    .filter((n) => !system.has(n))
}

/** The `save()` an Export runs, for the console — real R, not a comment. */
export function exportCode(env: PanelEnv, names: string[], filePath: string): string {
  const p = filePath.replace(/\\/g, '/')
  const list = names.map((n) => `"${n}"`).join(', ')
  return `save(list = c(${list}), file = "${p}", envir = ${env.name})`
}

/**
 * The `list2env()` a "Make Copy" runs on an environment.
 *
 * `copy <- original` would be a second NAME for the same environment —
 * environments are references, so every later edit through one would show up in
 * the other. The panel said copy and produced an alias.
 */
export function duplicateCode(
  name: string, newName: string, home = GLOBAL_ENV, toHome = home,
): string {
  const path = (h: string, n: string): string => (h === GLOBAL_ENV ? n : `${h}$${n}`)
  const src = path(home, name)
  return `${path(toHome, newName)} <- list2env(as.list(${src}, all.names = TRUE), parent = parent.env(${src}))`
}
