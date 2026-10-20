import { refreshWorkingDir } from '@/lib/working-dir'
import { rClient } from './r-client'
import { rehydrateRasterLayers } from './raster-layers'
import { wsClient } from './ws-client'
import { useSessionStore } from '../store/session'
import { useEnvironmentStore } from '../store/environment'
import { useEditorStore } from '../store/editor'
import { enableDirtyTracking } from './project-persistence'

/**
 * Drop restored data-viewer/function-editor tabs whose backing R object no
 * longer exists — keeps them after a reload (R alive, objects present) but
 * cleans them up on a fresh start or R restart (objects gone).
 */
export async function pruneStaleObjectTabs(): Promise<void> {
  try {
    const res = await rClient.listEnvironments()
    if (!res.success) return
    const names = new Set<string>()
    for (const env of res.environments) {
      if (!env.isSearchPath) for (const o of env.objects) names.add(o.name)
    }
    useEditorStore.getState().pruneObjectTabs(names)
  } catch {
    /* leave tabs as-is if we can't reach R */
  }
}

/**
 * Re-connects rClient and wsClient to the (possibly new) R port after a restart.
 * Safe to call multiple times; does not re-register WS message/status handlers
 * (those are registered once in App.tsx and survive reconnects).
 */
export async function reconnectToR(options: { unexpected?: boolean } = {}): Promise<void> {
  const { setRStatus, setRPort, addConsoleEntry } = useSessionStore.getState()

  setRStatus('connecting')

  try {
    await rClient.connect()
    const port = rClient.port

    if (!port) {
      setRStatus('error')
      addConsoleEntry('error', 'R restart failed: could not get new port.')
      return
    }

    setRPort(port)

    let healthy = false
    for (let i = 0; i < 30; i++) {
      healthy = await rClient.health()
      if (healthy) break
      await new Promise((r) => setTimeout(r, 1000))
    }

    if (!healthy) {
      setRStatus('error')
      addConsoleEntry('error', 'R server did not become healthy after restart.')
      return
    }

    setRStatus('ready')
    const sessionResult = await rClient.initSession()
    if (sessionResult.systemNames?.length) {
      useEnvironmentStore.getState().addRdataLoadedNames('.GlobalEnv', sessionResult.systemNames)
      useEnvironmentStore.getState().setSystemNames(sessionResult.systemNames)
    }
    addConsoleEntry('info', 'R session ready.')
    enableDirtyTracking()
    // A restart is a fresh R process, so its directory is R's default again.
    void refreshWorkingDir()

    // Reconnect WebSocket to the new port (connect() handles closing the old socket)
    wsClient.connect(port)

    // R crashed and came back: a named project's objects return from the last
    // checkpoint (docs/project-persistence-spec.md §3.4) before stale tabs are
    // judged, or every data viewer would close over an object about to return.
    if (options.unexpected) {
      const { restoreAfterRRestart } = await import('./project-persistence')
      await restoreAfterRRestart()
    }

    // R is a fresh process after a restart — drop any object tabs whose object
    // no longer exists so the UI doesn't show dead data-viewer tabs.
    void pruneStaleObjectTabs()

    // Fresh process also means the raster tile registrations are gone —
    // re-register surviving raster map layers, dropping orphans.
    void rehydrateRasterLayers()
  } catch (err) {
    setRStatus('error')
    addConsoleEntry('error', `R reconnect failed: ${String(err)}`)
  }
}
