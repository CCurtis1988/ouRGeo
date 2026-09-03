import { createJsonFileStore } from '@/lib/persistence'

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
  /**
   * The plugin whose `activate` was running when this file was last written.
   *
   * Cleared the moment activation returns. If it is still here at startup, that
   * plugin took the application down with it — and without this, the user is
   * left with an app that crashes on launch and the only way to fix it is
   * inside the app that crashes on launch.
   */
  activating?: string | null
}

const EMPTY: PluginPrefs = { enabled: {}, activating: null }

export async function loadPluginPrefs(): Promise<PluginPrefs> {
  const data = await store.read<Partial<PluginPrefs>>()
  return {
    enabled: (data.enabled && typeof data.enabled === 'object') ? data.enabled as Record<string, boolean> : {},
    activating: typeof data.activating === 'string' ? data.activating : null,
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
