// Writing environments to an .RData file on the user's computer.
//
// Lifted out of the Environment panel because the same operation is offered
// from three places now — the panel's Export button, the menu on an
// environment's group, and the menu on an environment's ROW inside .GlobalEnv
// (which is where a child environment lives). Three copies of it would be
// three chances for the console echo to stop matching the file.

import { rClient } from '@/lib/r-client'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { exportCode, exportedNames, panelEnvironments, userOnlyView } from '@/lib/environments'

/**
 * Ask for a path, write the environments to it, and echo the R that did it.
 *
 * `excludeSystem` because ouRGeo's own functions are source()d into
 * .GlobalEnv: without it every export of the global environment carries a
 * hundred handler functions the user never wrote and cannot use.
 *
 * The console gets the real `save()` for a single environment — naming the
 * objects, so what was written is on the record and re-runnable. Several
 * environments merge into one file, which no single R call does, so that case
 * is a comment saying so rather than a line that would not run.
 */
export async function exportEnvironments(envNames: string[]): Promise<void> {
  if (envNames.length === 0) return
  const filePath = await window.electronAPI.dialog.saveRData()
  if (!filePath) return

  const { environments, envPlacement, userFilterActive, rdataLoadedNames, systemNames } =
    useEnvironmentStore.getState()
  const panel = panelEnvironments(environments, envPlacement)
  const visible = userFilterActive ? userOnlyView(panel, rdataLoadedNames) : panel
  const rdataNames = [...new Set(envNames.flatMap((en) => rdataLoadedNames[en] ?? []))]
  const log = (line: string): void =>
    useSessionStore.getState().addConsoleEntry('input', line)

  if (envNames.length === 1) {
    const env = visible.find((e) => e.name === envNames[0])
    const names = env ? exportedNames(env, systemNames) : []
    log(env && names.length > 0
      ? exportCode(env, names, filePath)
      : `# Export ${envNames[0]} → "${filePath}" (nothing to write)`)
  } else {
    log(`# Export environments ${envNames.join(', ')} → "${filePath}"`)
  }

  const res = await rClient.envSave(envNames, filePath, rdataNames, true)
  if (!res.success) {
    useSessionStore.getState().addConsoleEntry('error', res.error ?? 'Export failed')
  }
}
