import { createJsonFileStore } from '@/lib/persistence'

// What the plugin store remembers between sessions.
//
// A PREFERENCE, deliberately — it must never be added to the `will-quit`
// cleanup in electron/main/index.ts. The thing it holds is a dismissal, and a
// dismissal that reset every launch would nag for ever, which is the same
// failure as a setting that silently reverts.
//
// It holds no catalogue and no plugin data. Those are cheap to fetch and go
// stale the moment an author publishes, and a cached store is a store showing
// yesterday's answer with nothing on screen to say so.

const store = createJsonFileStore('plugin-store.json', 'Plugin Store')

export interface PluginStorePrefs {
  /**
   * slug → the version whose update the user said no to.
   *
   * Keyed by the version rather than by the slug alone, so a LATER update is
   * offered again. "Not this one" is what a person means; "never tell me about
   * this plugin again" is not something they have been asked.
   */
  dismissed: Record<string, string>
  /** Epoch ms of the last successful poll, so a session need not repeat it. */
  lastCheck?: number
}

const EMPTY: PluginStorePrefs = { dismissed: {}, lastCheck: 0 }

export async function loadStorePrefs(): Promise<PluginStorePrefs> {
  const data = await store.read<Partial<PluginStorePrefs>>()
  return {
    dismissed: (data.dismissed && typeof data.dismissed === 'object')
      ? data.dismissed as Record<string, string>
      : {},
    lastCheck: typeof data.lastCheck === 'number' ? data.lastCheck : 0,
  }
}

/** `merge`, so a dismissal and a poll timestamp cannot clobber each other. */
export async function dismissUpdate(slug: string, version: string): Promise<void> {
  const prefs = await loadStorePrefs()
  await store.merge({ dismissed: { ...prefs.dismissed, [slug]: version } })
}

export async function markChecked(): Promise<void> {
  await store.merge({ lastCheck: Date.now() })
}

export const EMPTY_STORE_PREFS = EMPTY
