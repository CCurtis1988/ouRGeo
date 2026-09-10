// Installing, updating and removing a store plugin.
//
// One path, shared by the store dialog, the Plugin Manager and the assistant's
// actions, so all three produce the same result and the same console line. That
// is the same argument `add-spatial-layer.ts` and `save-edits.ts` make: a
// second copy of a workflow is a second answer to the same question.
//
// **What arrives is switched OFF**, always. That invariant is the whole trust
// model: a download is not consent, and the Plugin Manager's enable switch is
// where the user decides that code from a stranger may run. Installing from a
// file has always worked this way; installing from the store must not be the
// exception, because the store is the route that makes it easy.

import { install as installVersion, storeErrorMessage } from './client'
import { reloadPlugins, setPluginEnabled, loadedPlugins } from '@/lib/plugins/loader'
import { checkAppVersion } from '@/lib/plugins/manifest'
import { APP_VERSION } from '@/components/settings/versionHistory'
import { useSessionStore } from '@/store/session'
import type { StoreOrigin } from '@/lib/plugins/store-origin'

export interface InstallOutcome {
  ok: boolean
  origin?: StoreOrigin
  error?: string
}

/**
 * Note what the store did, in the console.
 *
 * Rule 0 does not bind — installing a plugin runs no R, so there is no R to
 * echo — but its corollary does, the one the web tools and the voice engine
 * follow: anything that reaches the network on the user's behalf is written
 * where they can read it afterwards. A plugin arriving on their machine is
 * exactly that.
 */
function note(text: string): void {
  useSessionStore.getState().addConsoleEntry('info', text)
}

/**
 * Install a version, or say why not.
 *
 * The compatibility check happens BEFORE the download rather than after the
 * load: an incompatible plugin that installs and then fails looks like a broken
 * plugin, when what actually happened is that ouRGeo is too old.
 */
export async function installFromStore(
  slug: string,
  versionId: string,
  opts: { version?: string; ourgeoVersion?: string | null; name?: string } = {},
): Promise<InstallOutcome> {
  if (opts.ourgeoVersion) {
    const problem = checkAppVersion(opts.ourgeoVersion, APP_VERSION)
    if (problem) return { ok: false, error: problem }
  }

  try {
    const origin = await installVersion(slug, versionId)
    await reloadPlugins(APP_VERSION)
    note(
      `Installed "${origin.name}" ${origin.version} from the plugin store. ` +
      'It is switched off — turn it on in Settings → Plugins when you are ready.',
    )
    return { ok: true, origin }
  } catch (e) {
    return { ok: false, error: storeErrorMessage(e) }
  }
}

/**
 * Update an installed plugin.
 *
 * Deliberately NOT silent, and deliberately not automatic. An update replaces
 * code the user already decided to trust with code they have not seen, so it is
 * offered and never applied on their behalf — the same reason `plugin:enable`
 * is the one confirm-tier plugin action.
 *
 * Whether it stays enabled is the user's earlier decision, kept: they trusted
 * this plugin, and a version bump from the same author through the same review
 * is not a new question. Re-disabling on every update would train people to
 * click the switch without reading it.
 */
export async function updateFromStore(
  slug: string,
  versionId: string,
  opts: { ourgeoVersion?: string | null } = {},
): Promise<InstallOutcome> {
  const wasEnabled = loadedPlugins().some(
    (p) => p.manifest.id === slug && p.state === 'active',
  )

  if (opts.ourgeoVersion) {
    const problem = checkAppVersion(opts.ourgeoVersion, APP_VERSION)
    if (problem) return { ok: false, error: problem }
  }

  try {
    const origin = await installVersion(slug, versionId)
    if (wasEnabled) await setPluginEnabled(slug, true, APP_VERSION)
    else await reloadPlugins(APP_VERSION)
    note(`Updated "${origin.name}" to ${origin.version} from the plugin store.`)
    return { ok: true, origin }
  } catch (e) {
    return { ok: false, error: storeErrorMessage(e) }
  }
}

/**
 * Switch off a plugin whose installed version has been revoked, and say why.
 *
 * Shaped like the crash guard in `loader.ts`, which is the existing precedent
 * for "ouRGeo turned this off for you, here is the reason". A revoked version
 * is one that WAS approved and is on people's machines; quietly delisting it
 * from the store would leave every existing install running.
 */
export async function disableRevoked(slug: string, name: string): Promise<void> {
  await setPluginEnabled(slug, false, APP_VERSION)
  note(
    `"${name}" has been withdrawn from the plugin store since you installed it, so ouRGeo has ` +
    'switched it off. Its page on ourgeo.dev says more; you can remove it in Settings → Plugins.',
  )
}
