import { createJsonFileStore } from '@/lib/persistence'
import type { EnvPlacement, EnvPlacements } from '@/lib/environments'

const store = createJsonFileStore('environment-preferences.json', 'Environment Prefs')

export interface EnvironmentPreferences {
  /**
   * How each of the user's environments is listed in the panel.
   *
   * SPARSE, like `actionTiers`: only the environments moved off the shipped
   * default. An environment name is not unique to a session — open the same
   * project tomorrow and `scratch` is `scratch` again — so remembering the
   * choice is the point; remembering the ones nobody changed is just a file
   * that grows forever.
   */
  envPlacement: EnvPlacements
}

const PLACEMENTS: EnvPlacement[] = ['promoted', 'child']

export async function loadEnvironmentPreferences(): Promise<EnvironmentPreferences> {
  const data = await store.read<{ envPlacement?: unknown }>()
  const raw = data.envPlacement
  if (typeof raw !== 'object' || raw === null) return { envPlacement: {} }
  const envPlacement: EnvPlacements = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (PLACEMENTS.includes(value as EnvPlacement)) envPlacement[name] = value as EnvPlacement
  }
  return { envPlacement }
}

export async function saveEnvironmentPreferences(
  prefs: EnvironmentPreferences,
): Promise<void> {
  // `write`, not `merge`: the map IS the value, and a merge would keep an
  // entry the user has just reset to the default.
  await store.write(prefs)
}
