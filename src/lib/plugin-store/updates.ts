// Is anything the user installed from the store out of date, or withdrawn?
//
// One batched call, once per session, on the first open of the Plugin Manager
// or the store — not at startup.
//
// Startup was the obvious place and is the wrong one twice over: it spends a
// network round trip on every launch for an answer most launches do not need,
// and it puts a message in front of someone who opened ouRGeo to do something
// else. The badge belongs where a person goes to look at their plugins, which
// is exactly where this fires.
//
// The exception is a REVOKED version, and it is not an update at all. That is a
// version which was approved, is running on this machine, and has since been
// withdrawn — so it is switched off the moment we learn of it, with a line in
// the console saying why. Shaped after the crash guard in `loader.ts`, the
// existing precedent for "ouRGeo turned this off for you, here is the reason".

import { updates as fetchUpdates, storeErrorMessage } from './client'
import { disableRevoked } from './install'
import { loadedPlugins } from '@/lib/plugins/loader'
import { usePluginStoreBrowser } from '@/store/pluginStore'
import { markChecked } from '@/lib/plugin-store-persistence'

/** In flight or finished, per session. Nothing here is worth repeating. */
let checked: Promise<void> | null = null

/**
 * Poll once, and never twice.
 *
 * Memoised through the promise rather than a boolean, because two dialogs can
 * open in the same tick and a boolean set after the await lets both through —
 * the same de-duplication `ensureSession` in the terminal store needed, for the
 * same reason.
 */
export function ensureUpdateCheck(): Promise<void> {
  if (!checked) {
    checked = run().catch(() => { /* offline is not an error worth showing here */ })
  }
  return checked
}

/** For a manual Refresh: the user asked, so ask again. */
export function recheckUpdates(): Promise<void> {
  checked = run().catch(() => undefined)
  return checked
}

async function run(): Promise<void> {
  const fromStore = loadedPlugins()
    .filter((p) => p.origin)
    .map((p) => ({ slug: p.origin!.slug, version: p.origin!.version, name: p.manifest.name }))

  if (fromStore.length === 0) return

  let rows
  try {
    rows = await fetchUpdates(fromStore.map(({ slug, version }) => ({ slug, version })))
  } catch (e) {
    // Deliberately swallowed at the boundary above; kept here so a developer
    // reading a console has something to go on.
    console.warn('[Plugin Store] update check failed:', storeErrorMessage(e))
    throw e
  }

  usePluginStoreBrowser.getState().setUpdates(rows)
  await markChecked()

  for (const row of rows) {
    if (row.installedStatus !== 'revoked') continue
    const plugin = fromStore.find((p) => p.slug === row.slug)
    await disableRevoked(row.slug, plugin?.name ?? row.slug)
  }
}

/** Reset between tests, and after a sign-out changes what is visible. */
export function resetUpdateCheck(): void {
  checked = null
}
