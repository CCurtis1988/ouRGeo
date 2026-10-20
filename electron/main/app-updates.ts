import { app, net, shell, BrowserWindow, type IpcMain } from 'electron'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { UPDATE_PAGE, UPDATE_NOTES, publishedInstallers, compatibleInstallers, latestInstallers, isNewerInstaller, parseAppVersion, type AppUpdateStatus, type UpdatePreferences, type InstallerFormat, type InstallationKind } from '../../src/lib/app-updates'

function installationKind(): InstallationKind {
  if (!app.isPackaged) return 'development'
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  if (process.platform !== 'linux') return 'unsupported'
  if (process.env.APPIMAGE) return 'appimage'
  if (process.execPath.toLowerCase().startsWith('/opt/ourgeo/') && existsSync('/var/lib/dpkg/info/ourgeo.list')) return 'deb'
  return 'linux'
}
const defaults = (): UpdatePreferences => ({ automatic: true, skippedVersion: null })
const preferencesPath = () => join(app.getPath('userData'), 'app-updates.json')
async function readPreferences(): Promise<UpdatePreferences> {
  try {
    const raw = JSON.parse(await readFile(preferencesPath(), 'utf8')) as Partial<UpdatePreferences>
    return { automatic: raw.automatic !== false, skippedVersion: typeof raw.skippedVersion === 'string' && parseAppVersion(raw.skippedVersion) ? raw.skippedVersion : null }
  } catch { return defaults() }
}

/** Main owns the release authority and browser destinations. The renderer can
 * choose a format, never supply a download URL or run a downloaded executable. */
export function registerAppUpdates(ipc: IpcMain): void {
  let status: AppUpdateStatus = { state: 'idle', currentVersion: app.getVersion(), latestVersion: null, platform: process.platform, arch: process.arch,
    installation: installationKind(), downloads: [], preferences: defaults(), checkedAt: null, message: null }
  let started = false
  let inFlight: Promise<AppUpdateStatus> | undefined
  let preferenceQueue = Promise.resolve()
  const prefs = async (): Promise<UpdatePreferences> => { await preferenceQueue; return readPreferences() }
  const check = async (mode: unknown): Promise<AppUpdateStatus> => {
    if (mode !== 'startup' && mode !== 'manual') throw new Error('Choose a startup or manual update check.')
    status.preferences = await prefs()
    if (mode === 'startup' && (!status.preferences.automatic || started || !app.isPackaged)) return status
    if (inFlight) return inFlight
    if (mode === 'startup') started = true
    inFlight = (async () => {
      status = { ...status, state: 'checking', message: null }
      try {
        if (!parseAppVersion(status.currentVersion)) throw new Error('The installed version could not be identified. Open the official download page to check manually.')
        const signal = AbortSignal.timeout(12000)
        const response = await net.fetch(UPDATE_PAGE, { signal, credentials: 'omit', headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' } })
        if (!response.ok || new URL(response.url || UPDATE_PAGE).origin !== new URL(UPDATE_PAGE).origin) throw new Error('The official download page is temporarily unavailable. Check your connection and try again.')
        const reader = response.body?.getReader()
        if (!reader) throw new Error('The download page was empty. Try again later.')
        const chunks: Uint8Array[] = []; let size = 0
        try {
          for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1_048_576) throw new Error('The download page could not be read safely. Open the official page to check manually.'); chunks.push(value) }
        } finally { await reader.cancel().catch(() => undefined) }
        const catalogue = publishedInstallers(Buffer.concat(chunks).toString('utf8'))
        if (!catalogue.length) throw new Error('Published installers could not be identified. Open the official download page or try again later.')
        if (!app.isPackaged) { status = { ...status, state: 'development', message: 'You are running ouRGeo from source. Update your checkout through your usual development workflow; installers are for packaged apps.', downloads: [], latestVersion: null, checkedAt: new Date().toISOString() }; return status }
        const downloads = latestInstallers(compatibleInstallers(catalogue, status.installation, status.arch))
        const latestVersion = downloads[0]?.version ?? null
        if (!latestVersion) { status = { ...status, state: 'unavailable', downloads: [], latestVersion: null, checkedAt: new Date().toISOString(), message: 'No compatible installer is currently published for this platform and architecture. Check the download page for availability.' }; return status }
        const available = isNewerInstaller(latestVersion, status.currentVersion)
        if (available) for (const file of downloads) {
          // HEAD validates published availability without downloading a binary or
          // incrementing the website's download counter during startup checks.
          const head = await net.fetch(file.url, { method: 'HEAD', signal, credentials: 'omit' })
          if (!head.ok || new URL(head.url || file.url).origin !== new URL(UPDATE_PAGE).origin) throw new Error('The update installer is temporarily unavailable. Try again later or open the download page.')
        }
        status = { ...status, state: available ? 'available' : 'current', latestVersion, downloads: available ? downloads : [], checkedAt: new Date().toISOString(), message: null }
      } catch (error) { status = { ...status, state: 'error', downloads: [], latestVersion: null, checkedAt: new Date().toISOString(), message: error instanceof Error && /[Tt]ry again|[Cc]heck.*manual|[Oo]pen.*page/.test(error.message) ? error.message : 'Could not check for updates. Check your connection and try again, or open the official download page.' } }
      return status
    })().finally(() => { inFlight = undefined })
    return inFlight
  }
  ipc.handle('updates:status', async () => { const preferences = await prefs(); return { ...status, preferences } })
  ipc.handle('updates:check', (_event, mode: unknown) => check(mode))
  ipc.handle('updates:preferences', async (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Update preferences must be an object.')
    const input = patch as Partial<UpdatePreferences>
    if (Object.keys(input).some(key => !['automatic', 'skippedVersion'].includes(key)) || input.automatic !== undefined && typeof input.automatic !== 'boolean' || input.skippedVersion !== undefined && input.skippedVersion !== null && (typeof input.skippedVersion !== 'string' || !parseAppVersion(input.skippedVersion))) throw new Error('Update preferences are invalid. Choose a valid automatic-check setting or version.')
    const write = async (): Promise<void> => {
      const preferences = { ...await readPreferences(), ...input }
      const path = preferencesPath(), temporary = `${path}.tmp`
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(temporary, JSON.stringify(preferences), { mode: 0o600 }); await rename(temporary, path)
      status = { ...status, preferences }
    }
    const result = preferenceQueue.then(write, write)
    preferenceQueue = result.catch(() => undefined)
    try { await result } catch { throw new Error('Update preferences could not be saved. Check disk space and permissions, then retry.') }
    return status
  })
  ipc.handle('updates:quit', event => { BrowserWindow.fromWebContents(event.sender)?.close() })
  ipc.handle('updates:open', async (_event, destination: unknown) => {
    if (destination === 'downloads') return shell.openExternal(UPDATE_PAGE)
    if (destination === 'notes') return shell.openExternal(UPDATE_NOTES)
    if (status.state !== 'available' || !status.latestVersion || !isNewerInstaller(status.latestVersion, app.getVersion())) throw new Error('Check for updates again before downloading an installer.')
    const file = status.downloads.find(item => item.format === destination as InstallerFormat)
    if (!file) throw new Error('Choose an installer offered for this update.')
    await shell.openExternal(file.url)
  })
}
