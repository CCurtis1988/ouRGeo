import type { REnvironmentInfo, RObjectInfo } from '@/lib/r-client'
import type { EnvIndex, IndexedFunction, IndexedObject } from './types'

let cache: EnvIndex | null = null

/**
 * Build (and memoize) a flat completion index from the environment store.
 * Re-uses the previous result while the `environments` array reference is
 * unchanged — the store replaces the whole array on every refresh, so identity
 * is a reliable invalidation signal.
 */
export function buildEnvIndex(environments: REnvironmentInfo[]): EnvIndex {
  if (cache && cache.source === environments) return cache

  const objects: IndexedObject[] = []
  const functions: IndexedFunction[] = []
  const packages: string[] = []
  const byName = new Map<string, IndexedObject>()
  const seenFn = new Set<string>()

  for (const env of environments) {
    if (env.isSearchPath) {
      // Package / attached environment: harvest callable exports.
      const pkg = env.name.startsWith('package:') ? env.name.slice('package:'.length) : undefined
      if (pkg) packages.push(pkg)
      for (const obj of env.objects) {
        if (obj.class === 'function' && !seenFn.has(obj.name)) {
          seenFn.add(obj.name)
          functions.push({ name: obj.name, pkg })
        }
      }
      continue
    }

    // User environment (.GlobalEnv, custom envs): objects + user functions.
    for (const obj of env.objects) {
      indexUserObject(obj, env.name, objects, functions, byName, seenFn)
    }
  }

  cache = { source: environments, objects, functions, packages, byName }
  return cache
}

function indexUserObject(
  obj: RObjectInfo,
  envName: string,
  objects: IndexedObject[],
  functions: IndexedFunction[],
  byName: Map<string, IndexedObject>,
  seenFn: Set<string>
): void {
  if (obj.class === 'function') {
    if (!seenFn.has(obj.name)) {
      seenFn.add(obj.name)
      functions.push({ name: obj.name })
    }
    return
  }

  const isDataFrame =
    !!obj.columns ||
    obj.class === 'data.frame' ||
    obj.class === 'tbl_df' ||
    obj.class === 'data.table' ||
    obj.class === 'sf' ||
    obj.class === 'tbl_dbi'

  const entry: IndexedObject = {
    name: obj.name,
    rClass: obj.class,
    envName,
    columns: obj.columns,
    isDataFrame,
    isList: obj.isList,
  }
  objects.push(entry)
  // First definition wins on name clashes across environments (.GlobalEnv first).
  if (!byName.has(obj.name)) byName.set(obj.name, entry)
}
