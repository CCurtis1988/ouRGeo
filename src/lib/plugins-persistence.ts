import { createJsonFileStore } from '@/lib/persistence'
import type { StoreOrigin } from '@/lib/plugins/types'

// Which plugins are switched on, and which one was mid-activation when the app
// last went down.
//
// Separate from the plugin folders themselves on purpose: the folders are the
// plugins, and this file is the user's decisions about them. Deleting it turns
// everything off and loses nothing else. It is NOT session-scoped — it must
// never be added to the `will-quit` cleanup in electron/main/index.ts.

const store = createJsonFileStore('plugins.json', 'Plugins')

export interface PluginPrefs {
  /** id → enabled. Absent means "never decided", which reads as disabled:
   *  a plugin that arrives on disk has not been consented to yet. */
  enabled: Record<string, boolean>
  /** Last explicitly approved permission set. New permissions on an update
   * require re-enabling; an old enabled flag cannot grant context sharing. */
  permissionGrants?: Record<string, string[]>
  /**
   * The plugin whose `activate` was running when this file was last written.
   *
   * Cleared the moment activation returns. If it is still here at startup, that
   * plugin took the application down with it — and without this, the user is
   * left with an app that crashes on launch and the only way to fix it is
   * inside the app that crashes on launch.
   */
  activating?: string | null
  /**
   * id → what the plugin store recorded when it installed that plugin.
   *
   * A CACHE of each plugin's `.ourgeo-store.json`, so the update poll needs no
   * directory scan. The sidecar is the authority; losing this file costs one
   * scan and nothing else, which is what keeps the promise in the header above
   * true.
   */
  store?: Record<string, StoreOrigin>
}

const EMPTY: PluginPrefs = { enabled: {}, activating: null, store: {} }

export async function loadPluginPrefs(): Promise<PluginPrefs> {
  const data = await store.read<Partial<PluginPrefs>>()
  return {
    enabled: (data.enabled && typeof data.enabled === 'object') ? data.enabled as Record<string, boolean> : {},
    permissionGrants: data.permissionGrants && typeof data.permissionGrants === 'object' && !Array.isArray(data.permissionGrants)
      ? Object.fromEntries(Object.entries(data.permissionGrants).filter(([id]) => /^[a-z][a-z0-9-]{0,63}$/.test(id)).map(([id, grants]) => [id, Array.isArray(grants) && grants.length <= 16 && grants.every(grant => typeof grant === 'string') ? grants : []]))
      : {},
    activating: typeof data.activating === 'string' ? data.activating : null,
    // Reconstructed field by field rather than spread, so a hand-edited file
    // cannot smuggle in a key nothing reads. That is also why every field has
    // to be listed HERE as well as in the interface: `savePluginPrefs` writes
    // this object whole, so a field the loader forgets is a field the next
    // enable/disable deletes.
    store: (data.store && typeof data.store === 'object')
      ? data.store as Record<string, StoreOrigin>
      : {},
  }
}

export async function savePluginPrefs(prefs: PluginPrefs): Promise<void> {
  await store.write(prefs)
}

/** Write the crash marker before calling into a plugin, and clear it after.
 *  Both are `merge`, so a concurrent enable/disable is not clobbered. */
export async function markActivating(id: string | null): Promise<void> {
  await store.merge({ activating: id })
}

export const EMPTY_PREFS = EMPTY
