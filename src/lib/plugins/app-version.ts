/** Existing plugin minimum-version policy shared with native contributions. */
export function checkAppVersion(need: string, appVersion: string): string | null {
  const want = need.trim().replace(/^[>=^~\s]+/, '')
  const parse = (v: string): number[] => v.split(/[.-]/).slice(0, 3).map(n => Number(n) || 0)
  const a = parse(want), b = parse(appVersion)
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return null
    if ((b[i] ?? 0) < (a[i] ?? 0)) return `This plugin needs ouRGeo ${want} or newer; this is ${appVersion}.`
  }
  return null
}
