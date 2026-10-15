import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { validateSkills } from '../../../../src/lib/context/skills'
import { pluginPermissionsApproved } from '../../../../src/lib/plugins/permission-policy'
import { checkAppVersion } from '../../../../src/lib/plugins/app-version'
import type { PublicProviderContribution, ProviderContributionRef } from '../../../../src/lib/context/providers/contributions'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import { MNEMOSYNE_LOCAL_CANDIDATE } from '../runtime-catalogue'

function boundedFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > 131072) throw new Error('Review a bounded regular plugin descriptor.'); return readFileSync(fd, 'utf8') }
  finally { closeSync(fd) }
}
/** Native registration reads installed descriptors and current explicit
 * grants. Renderer strings and plugin self-assertions cannot certify profiles. */
export class PluginProviderContributions {
  private watchers: FSWatcher[] = []
  private rootWatcher?: FSWatcher
  private observationHealthy = true
  constructor(private data: string, private appVersion: string) {}
  private descriptors(pluginId: string): PublicProviderContribution[] {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(pluginId)) throw new Error('Choose an installed plugin.')
    const root = join(this.data, 'plugins'), dir = join(root, pluginId)
    if (lstatSync(root).isSymbolicLink() || lstatSync(dir).isSymbolicLink() || realpathSync(dir) !== resolve(dir)) throw new Error('Keep provider descriptors inside the installed plugin directory.')
    const raw = boundedFile(join(dir, 'ourgeo-plugin.json')), manifest = JSON.parse(raw), prefs = JSON.parse(boundedFile(join(this.data, 'plugins.json')))
    if (manifest.id !== pluginId || prefs.enabled?.[pluginId] !== true || !manifest.permissions?.includes('memory-provider') || !pluginPermissionsApproved(manifest.permissions, prefs.permissionGrants?.[pluginId])
      || manifest.ourgeoVersion && (typeof manifest.ourgeoVersion !== 'string' || checkAppVersion(manifest.ourgeoVersion, this.appVersion))) throw new Error('Enable this compatible plugin with its separate memory-provider permission.')
    const context = validateSkills(manifest.context)
    const manifestSha256 = createHash('sha256').update(raw).digest('hex')
    return (context.providers ?? []).map(item => ({ ...item, pluginId, manifestSha256, available: process.platform === 'linux' && process.arch === 'x64' && item.profileId === MNEMOSYNE_LOCAL_CANDIDATE.id }))
  }
  list(): PublicProviderContribution[] {
    if (!this.observationHealthy) return []
    try { return readdirSync(join(this.data, 'plugins')).sort().slice(0, 100).flatMap(id => { try { return this.descriptors(id) } catch { return [] } }).slice(0, 256) }
    catch { return [] }
  }
  require(ref: ProviderContributionRef): PublicProviderContribution {
    if (!this.observationHealthy) throw new Error('Provider monitoring failed. Reopen ouRGeo before reviewing contributed profiles.')
    if (!ref || Object.keys(ref).some(key => !['pluginId', 'id', 'manifestSha256'].includes(key)) || typeof ref.id !== 'string' || typeof ref.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.manifestSha256)) throw new Error('Refresh and review this installed provider contribution.')
    const item = this.descriptors(ref.pluginId).find(item => item.id === ref.id && item.manifestSha256 === ref.manifestSha256 && item.available)
    if (!item) throw new Error('PROVIDER_UNCERTIFIED: update or enable this plugin and choose a host-reviewed profile.')
    return item
  }
  eligible(connection: MemoryConnection): boolean {
    if (!connection.contribution) return true
    try { return this.require(connection.contribution).profileId === connection.runtimeId && connection.location === 'managed-local' }
    catch { return false }
  }
  observe(changed: () => void): void {
    this.close()
    this.observationHealthy = true
    const failed = (): void => { this.observationHealthy = false; changed() }
    const install = (): void => {
      if (this.rootWatcher) { this.watchers = this.watchers.filter(item => item !== this.rootWatcher); this.rootWatcher.close(); this.rootWatcher = undefined }
      try { this.rootWatcher = watch(join(this.data, 'plugins'), { recursive: true, persistent: false }, changed); this.rootWatcher.on('error', failed); this.watchers.push(this.rootWatcher) } catch { /* Parent observes installation of a previously absent folder. */ }
    }
    const parent = watch(this.data, { persistent: false }, (_event, file) => { if (file === 'plugins') install(); if (file === 'plugins.json' || file === 'plugins') changed() })
    parent.on('error', failed); this.watchers.push(parent)
    install()
  }
  close(): void { for (const watcher of this.watchers.splice(0)) watcher.close(); this.rootWatcher = undefined }
}
