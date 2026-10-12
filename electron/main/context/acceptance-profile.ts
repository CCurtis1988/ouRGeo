import { app, safeStorage } from 'electron'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** Packaged acceptance cannot wrap main before it reads its profile. An
 * explicit, marked synthetic directory is therefore selected before any main
 * handlers initialise. Ordinary launches have no override. */
export function configureContextAcceptanceProfile(profile: string | undefined, setPath: (name: 'userData', path: string) => void): void {
  if (!profile) return
  if (!isAbsolute(profile)) throw new Error('Context acceptance needs an absolute synthetic profile directory.')
  const info = lstatSync(profile), marker = join(profile, '.context-acceptance')
  const markerInfo = lstatSync(marker)
  if (!info.isDirectory() || info.isSymbolicLink() || !markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size > 64
    || readFileSync(marker, 'utf8') !== 'synthetic-context-profile-v1\n'
    || process.platform !== 'win32' && (info.mode & 0o077 || markerInfo.mode & 0o077)) throw new Error('Context acceptance refuses an unmarked or shared profile. Create a new private synthetic test directory.')
  setPath('userData', realpathSync(profile))
}
configureContextAcceptanceProfile(process.env.OURGEO_CONTEXT_TEST_PROFILE, (name, path) => app.setPath(name, path))
if (process.env.OURGEO_CONTEXT_TEST_PROFILE && process.env.OURGEO_CONTEXT_TEST_NO_KEYRING === '1') safeStorage.isEncryptionAvailable = () => false
