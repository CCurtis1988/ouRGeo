// Reading a manifest, and refusing one.
//
// Follows `classifyThemeFile` in custom-themes.ts, for the same reasons and
// with the same discipline:
//
//  * A refusal names the FIELD and the way out. "contributes.actions[1].run is
//    missing" is something a model can act on; "invalid plugin" is not.
//  * One bad contribution is dropped, not the whole plugin. A manifest with a
//    good connector and a malformed tool installs the connector and warns —
//    `salvage()` in custom-themes, applied to a manifest.
//  * A `manifestVersion` from the future is refused rather than half-read. A
//    partially-understood plugin still registers things, so nothing looks
//    broken, and the user is left with a feature that quietly does the wrong
//    part of what it says on the tin.

import {
  MANIFEST_VERSION, PERMISSIONS,
  type PluginManifest, type PluginPermission, type PluginContributions,
} from './types'
import { serviceSpec } from './service-policy'

export interface ManifestResult {
  ok: boolean
  manifest?: PluginManifest
  error?: string
  /** Contributions that were dropped, each with a reason. Shown in the Plugin
   *  Manager and handed back to the assistant by `plugin:validate`. */
  warnings: string[]
}

// No minimum length beyond one character: an arbitrary floor is a rule a
// plugin author trips over for no benefit.
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+].*)?$/

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * Parse and validate a manifest.
 *
 * `appVersion` is checked against `ourgeoVersion` here rather than at load
 * time, so the refusal can name both numbers — a plugin that needs a newer
 * ouRGeo is a different problem from a broken one, and telling them apart is
 * the difference between "update ouRGeo" and "this plugin is wrong".
 */
export function readManifest(text: string, appVersion: string): ManifestResult {
  const warnings: string[] = []

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, warnings, error: `${MANIFEST_FILE_HINT} is not valid JSON: ${(e as Error).message}` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, warnings, error: `${MANIFEST_FILE_HINT} must contain a JSON object.` }
  }
  const m = raw as Record<string, unknown>

  const version = typeof m.manifestVersion === 'number' ? m.manifestVersion : MANIFEST_VERSION
  if (version > MANIFEST_VERSION) {
    return {
      ok: false, warnings,
      error: `This plugin needs manifest format ${version}; this ouRGeo reads ${MANIFEST_VERSION}. Update ouRGeo.`,
    }
  }

  const id = str(m.id)
  if (!id) return { ok: false, warnings, error: '"id" is required — a short lowercase name like "noaa-tides".' }
  if (!ID_RE.test(id)) {
    return {
      ok: false, warnings,
      error: `"id" must be lowercase letters, digits and hyphens, starting with a letter — got "${id}". ` +
        'It prefixes everything the plugin contributes, so it has to be safe in an action id.',
    }
  }

  const name = str(m.name)
  if (!name) return { ok: false, warnings, error: '"name" is required — what the user sees in the Plugin Manager.' }

  const pluginVersion = str(m.version)
  if (!pluginVersion) return { ok: false, warnings, error: '"version" is required, e.g. "1.0.0".' }
  if (!VERSION_RE.test(pluginVersion)) {
    return { ok: false, warnings, error: `"version" must look like "1.0.0" — got "${pluginVersion}".` }
  }

  const need = str(m.ourgeoVersion)
  if (need) {
    const problem = checkAppVersion(need, appVersion)
    if (problem) return { ok: false, warnings, error: problem }
  }

  // Permissions: an unknown one is dropped with a warning rather than refused.
  // A plugin written against a later ouRGeo that asks for a permission this one
  // has never heard of is still perfectly usable for everything else it does.
  const permissions: PluginPermission[] = []
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) {
      return { ok: false, warnings, error: '"permissions" must be a list, e.g. ["network", "r"].' }
    }
    for (const p of m.permissions) {
      if (PERMISSIONS.includes(p as PluginPermission)) permissions.push(p as PluginPermission)
      else warnings.push(`Ignored unknown permission "${String(p)}". Known: ${PERMISSIONS.join(', ')}.`)
    }
  }

  const main = m.main === undefined ? undefined : str(m.main)
  if (m.main !== undefined && !main) {
    return { ok: false, warnings, error: '"main" must be a path relative to the plugin folder, e.g. "main.ts".' }
  }
  if (main && (main.startsWith('/') || main.includes('..'))) {
    return {
      ok: false, warnings,
      error: `"main" must stay inside the plugin folder — got "${main}".`,
    }
  }

  const contributes = readContributions(m.contributes, warnings)
  let service: PluginManifest['service']
  if (m.service !== undefined) {
    if (!permissions.includes('service')) return { ok: false, warnings, error: 'A background service needs the "service" permission.' }
    try { service = serviceSpec(m.service) }
    catch (error) { return { ok: false, warnings, error: (error as Error).message } }
  }

  if (!main && isEmpty(contributes)) {
    return {
      ok: false, warnings,
      error: 'This plugin contributes nothing and has no "main". Add something under "contributes", ' +
        'or an entry point.',
    }
  }

  return {
    ok: true,
    warnings,
    manifest: {
      id, name, version: pluginVersion,
      ourgeoVersion: need ?? undefined,
      description: str(m.description) ?? undefined,
      author: str(m.author) ?? undefined,
      homepage: str(m.homepage) ?? undefined,
      permissions,
      main: main ?? undefined,
      service,
      contributes,
      manifestVersion: version,
    },
  }
}

const MANIFEST_FILE_HINT = 'ourgeo-plugin.json'

function isEmpty(c: PluginContributions): boolean {
  return Object.values(c).every((v) => !Array.isArray(v) || v.length === 0)
}

/**
 * Shape-check each contribution list.
 *
 * Only the fields the loader needs in order to file a contribution under the
 * right registry are checked here; the compilers in Phase 4 validate their own
 * payloads, because they are the ones that know what a valid connector spec is
 * and can say so usefully.
 */
function readContributions(raw: unknown, warnings: string[]): PluginContributions {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('"contributes" must be an object; ignored.')
    return {}
  }
  const c = raw as Record<string, unknown>
  const out: PluginContributions = {}

  const lists: { key: keyof PluginContributions; needs: string[] }[] = [
    { key: 'connectors', needs: ['name', 'label'] },
    { key: 'toolboxTools', needs: ['name', 'label', 'rTemplate'] },
    { key: 'actions', needs: ['name', 'summary', 'run'] },
    { key: 'toolbarButtons', needs: ['name', 'label'] },
    { key: 'panels', needs: ['name', 'label', 'export'] },
    { key: 'docs', needs: ['topic', 'summary', 'body'] },
  ]

  for (const { key, needs } of lists) {
    const value = c[key]
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      warnings.push(`"contributes.${key}" must be a list; ignored.`)
      continue
    }
    const kept: unknown[] = []
    value.forEach((item, i) => {
      if (item === null || typeof item !== 'object') {
        warnings.push(`Dropped contributes.${key}[${i}]: not an object.`)
        return
      }
      const missing = needs.filter((f) => !(f in (item as Record<string, unknown>)))
      if (missing.length > 0) {
        warnings.push(`Dropped contributes.${key}[${i}]: missing ${missing.map((f) => `"${f}"`).join(', ')}.`)
        return
      }
      kept.push(item)
    })
    if (kept.length > 0) {
      // The per-kind types are checked by their compilers; the manifest reader
      // only guarantees these are objects carrying the fields it filed them by.
      ;(out as Record<string, unknown>)[key] = kept
    }
  }

  if (c.rLibrary !== undefined) {
    if (!Array.isArray(c.rLibrary)) {
      warnings.push('"contributes.rLibrary" must be a list of file names; ignored.')
    } else {
      const files = c.rLibrary.filter((f): f is string => {
        if (typeof f !== 'string' || f.trim() === '') {
          warnings.push(`Dropped an rLibrary entry that is not a file name.`)
          return false
        }
        if (f.startsWith('/') || f.includes('..')) {
          warnings.push(`Dropped rLibrary "${f}": must stay inside the plugin folder.`)
          return false
        }
        return true
      })
      if (files.length > 0) out.rLibrary = files
    }
  }

  return out
}

/**
 * Compare a `>=x.y.z` requirement against the running app.
 *
 * Deliberately only `>=` and a bare version. A full semver range parser would
 * be a dependency and a source of its own surprises, and the only question a
 * plugin actually needs to ask is "is ouRGeo new enough".
 */
export function checkAppVersion(need: string, appVersion: string): string | null {
  const want = need.trim().replace(/^[>=^~\s]+/, '')
  const parse = (v: string): number[] => v.split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0)
  const a = parse(want)
  const b = parse(appVersion)
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return null
    if ((b[i] ?? 0) < (a[i] ?? 0)) {
      return `This plugin needs ouRGeo ${want} or newer; this is ${appVersion}.`
    }
  }
  return null
}
