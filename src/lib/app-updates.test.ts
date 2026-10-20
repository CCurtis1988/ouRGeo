import { expect, it } from 'vitest'
import { publishedInstallers, compatibleInstallers, latestInstallers, isNewerInstaller, parseAppVersion, updateInstructions } from './app-updates'
const card = (file: string) => `<a class="download-card" href="download.php?file=${file}" download>Download</a>`
it('compares stable installer versions numerically and never downgrades ahead-of-release builds', () => {
  expect(isNewerInstaller('1.16.10', '1.16.9')).toBe(true)
  expect(isNewerInstaller('2.0.0', '1.99.99')).toBe(true)
  expect(isNewerInstaller('1.16.33', '1.16.33')).toBe(false)
  expect(isNewerInstaller('1.16.2', '1.16.33')).toBe(false)
  expect(isNewerInstaller('1.16.33', '1.16.33-rc.1')).toBe(true)
  expect(isNewerInstaller('1.16.33-rc.1', '1.16.32')).toBe(false)
  for (const invalid of ['1.2', '1.02.3', 'NaN.2.3', '999999999999999999.2.3']) expect(parseAppVersion(invalid)).toBeNull()
})
it('reads only published first-party installer cards, excluding source prose and coming-soon assets', () => {
  const html = `<h1>Current source release 99.0.0</h1>${card('ouRGeo-1.15.6.AppImage')}${card('ouRGeo-1.15.6.deb')}${card('ouRGeo-1.15.6.exe')}<div class="download-card soon">ouRGeo-99.0.0.dmg</div>
  <a class="download-card" aria-disabled="true" href="download.php?file=ouRGeo-99.0.0.dmg">Soon</a>
  <a href="download.php?file=ouRGeo-0.1.0.exe">Historical link</a>`
  expect(publishedInstallers(html).map(item => item.version)).toEqual(['1.15.6', '1.15.6', '1.15.6'])
  expect(compatibleInstallers(publishedInstallers(html), 'windows', 'x64')[0].format).toBe('exe')
  expect(compatibleInstallers(publishedInstallers(html), 'linux', 'x64').map(file => file.format)).toEqual(['AppImage'])
  expect(compatibleInstallers(publishedInstallers(html), 'deb', 'x64')[0].format).toBe('deb')
  expect(compatibleInstallers(publishedInstallers(html), 'mac', 'arm64')).toEqual([])
})
it('refuses arbitrary destinations and malformed filenames rather than launching anything from HTML', () => {
  const links = ['https://evil.test/download.php?file=ouRGeo-9.0.0.exe', 'file:///download.php?file=ouRGeo-9.0.0.exe', 'download.php?file=../ouRGeo-9.0.0.exe', 'download.php?file=ouRGeo-9.0.0.exe&extra=1', 'download.php?file=ouRGeo-9.0.0.exe#fragment']
  expect(publishedInstallers(links.map(href => `<a class="download-card" href="${href}">X</a>`).join(''))).toEqual([])
  expect(publishedInstallers('<a data-class="download-card" data-href="download.php?file=ouRGeo-9.0.0.exe">X</a>')).toEqual([])
  const catalogue = publishedInstallers(card('ouRGeo-1.9.0.exe') + card('ouRGeo-1.10.0.exe') + card('ouRGeo-1.10.0.exe'))
  expect(latestInstallers(catalogue)).toHaveLength(1)
  expect(latestInstallers(catalogue)[0].version).toBe('1.10.0')
})
it('gives platform-specific steps with saving before closing and no automatic install promise', () => {
  expect(updateInstructions('AppImage', 'ouRGeo-2.0.0.AppImage').join(' ')).toContain('executable')
  expect(updateInstructions('deb', 'ouRGeo-2.0.0.deb').join(' ')).toContain('sudo apt install')
  expect(updateInstructions('exe', 'ouRGeo-2.0.0.exe').join(' ')).toContain('same installation location')
  expect(updateInstructions('dmg', 'ouRGeo-2.0.0.dmg').join(' ')).toContain('Applications')
})
