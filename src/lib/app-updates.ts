export const UPDATE_PAGE = 'https://ourgeo.dev/ourgeo-download.html'
export const UPDATE_NOTES = 'https://ourgeo.dev/ourgeo-versions.html'
export type InstallerFormat = 'AppImage' | 'deb' | 'exe' | 'dmg'
export interface UpdateDownload { version: string; format: InstallerFormat; fileName: string; url: string }
export interface UpdatePreferences { automatic: boolean; skippedVersion: string | null }
export type InstallationKind = 'development' | 'appimage' | 'deb' | 'windows' | 'mac' | 'linux' | 'unsupported'
export interface AppUpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'unavailable' | 'development' | 'error'
  currentVersion: string
  latestVersion: string | null
  platform: string
  arch: string
  installation: InstallationKind
  downloads: UpdateDownload[]
  preferences: UpdatePreferences
  checkedAt: string | null
  message: string | null
}
export function parseAppVersion(value: string): { parts: number[]; prerelease: boolean } | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return null
  const parts = match.slice(1, 4).map(Number)
  return parts.every(Number.isSafeInteger) ? { parts, prerelease: !!match[4] } : null
}
/** Published installers are stable. Equal-core prereleases still need the
 * stable installer; an ahead-of-release development build is never downgraded. */
export function isNewerInstaller(latest: string, current: string): boolean {
  const a = parseAppVersion(latest), b = parseAppVersion(current)
  if (!a || !b || a.prerelease) return false
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i]
  return b.prerelease
}

/** The official site publishes installer cards independently of source notes.
 * Only enabled download anchors and exact first-party installer filenames count;
 * prose, source-release versions, coming-soon cards and external links do not. */
export function publishedInstallers(html: string): UpdateDownload[] {
  const downloads = new Map<string, UpdateDownload>()
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attributes = match[1]
    if (!/(?:^|\s)class\s*=\s*["'][^"']*\bdownload-card\b[^"']*["']/i.test(attributes) || /\baria-disabled\s*=\s*["']true["']/i.test(attributes)) continue
    const href = /(?:^|\s)href\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2]
    if (!href) continue
    let url: URL
    try { url = new URL(href.replace(/&amp;/g, '&'), UPDATE_PAGE) } catch { continue }
    if (url.origin !== new URL(UPDATE_PAGE).origin || url.pathname !== '/download.php' || url.hash || [...url.searchParams.keys()].length !== 1) continue
    const fileName = url.searchParams.get('file') ?? ''
    const file = /^ouRGeo-(\d+\.\d+\.\d+)\.(AppImage|deb|exe|dmg)$/.exec(fileName)
    if (!file || !parseAppVersion(file[1])) continue
    downloads.set(fileName, { version: file[1], format: file[2] as InstallerFormat, fileName, url: `${new URL(UPDATE_PAGE).origin}/download.php?file=${encodeURIComponent(fileName)}` })
  }
  return [...downloads.values()]
}
export function compatibleInstallers(downloads: UpdateDownload[], installation: InstallationKind, arch: string): UpdateDownload[] {
  // Existing unqualified filenames on the site are the documented x64 builds.
  // Never offer one to ARM just because an AppImage is distro-independent.
  if (arch !== 'x64') return []
  const formats: Partial<Record<InstallationKind, InstallerFormat[]>> = { appimage: ['AppImage'], deb: ['deb'], linux: ['AppImage'], windows: ['exe'], mac: ['dmg'] }
  return downloads.filter(file => formats[installation]?.includes(file.format))
}
export function latestInstallers(downloads: UpdateDownload[]): UpdateDownload[] {
  let latest: string | null = null
  for (const file of downloads) if (!latest || isNewerInstaller(file.version, latest)) latest = file.version
  return downloads.filter(file => file.version === latest)
}
export function updateInstructions(format: InstallerFormat, fileName: string): string[] {
  const common = ['Save your current project and any work you want to keep.', 'When the download finishes, close ouRGeo before replacing or installing it.']
  if (format === 'AppImage') return [...common, `Replace your previous AppImage with ${fileName}. Mark the new file executable using Properties → Permissions, then open it.`, 'If you use a launcher shortcut, point it to the new AppImage.']
  if (format === 'deb') return [...common, `Open ${fileName} in your system’s package installer, or run sudo apt install ./"${fileName}" from its download folder.`, 'Open ouRGeo from your application menu after installation finishes.']
  if (format === 'exe') return [...common, `Run ${fileName} and follow the installer, using the same installation location.`, 'Open ouRGeo after the installer finishes.']
  return [...common, `Open ${fileName} and drag ouRGeo into Applications, replacing the previous app.`, 'Open ouRGeo from Applications.']
}
