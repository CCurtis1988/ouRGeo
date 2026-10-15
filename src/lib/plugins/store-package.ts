// Turning a plugin folder into the thing the store distributes.
//
// A plugin installed from the store ships ONE built file, not the author's
// sources — see "Protecting an author's code" in CLAUDE.md for exactly how far
// that goes and where it stops. This module is that build.
//
// What comes out is two archives, because they answer two different questions:
//
//   plugin.ourgeoplugin   what a user downloads. The manifest, one minified
//                         module, and the R files R has to read. No sources.
//   source.zip            what a MODERATOR reads. The folder as it stands.
//                         Never public: only the author and staff can fetch it,
//                         enforced by a storage policy rather than by this app.
//
// The source archive is not a courtesy. A moderator asked to test and approve a
// single minified line is performing theatre, and a review gate with no content
// is worse than none — it tells users a plugin was checked when it was not.

import { bundleForDistribution } from './compile'
import { MANIFEST_FILE, type PluginManifest } from './types'

/** Extra files copied verbatim if the author has them. */
const COPIED = ['README.md', 'readme.md', 'LICENSE', 'LICENSE.md', 'LICENCE', 'CHANGELOG.md']

/** Source extensions that must never reach the distributable. */
const SOURCE_RE = /\.(ts|tsx|jsx|mts|cts)$/

export interface DistResult {
  ok: boolean
  /** Path → contents, ready to be zipped. */
  files?: Record<string, string>
  error?: string
  warnings: string[]
}

/**
 * Build the distributable file tree for one installed plugin.
 *
 * Reads the folder the way `loader.ts`'s `runMain` does, so what gets built is
 * what would have run.
 */
export async function buildDistFiles(manifest: PluginManifest): Promise<DistResult> {
  const id = manifest.id
  const warnings: string[] = []

  let names: string[]
  try {
    names = await window.electronAPI.plugins.listFiles(id)
  } catch (e) {
    return { ok: false, error: `Could not read the plugin's files: ${msg(e)}`, warnings }
  }

  const out: Record<string, string> = {}
  const dist: PluginManifest = { ...manifest }

  // ── The code ─────────────────────────────────────────────────────────────
  if (manifest.main) {
    const sources: Record<string, string> = {}
    for (const name of names) {
      if (!/\.(ts|tsx|js|jsx|mjs|json)$/.test(name)) continue
      try {
        sources[name] = await window.electronAPI.plugins.readFile(`${id}/${name}`)
      } catch (e) {
        return { ok: false, error: `Could not read "${name}": ${msg(e)}`, warnings }
      }
    }
    if (sources[manifest.main] === undefined) {
      return {
        ok: false,
        warnings,
        error: `"main" points at "${manifest.main}", which is not in the plugin folder.`,
      }
    }

    const built = await bundleForDistribution({ files: sources, entry: manifest.main })
    if (!built.ok || !built.code) {
      return { ok: false, error: built.error ?? 'The plugin failed to compile.', warnings }
    }
    out['main.js'] = built.code
    dist.main = 'main.js'
  } else if (!manifest.contributes && !manifest.context?.skills.length && !manifest.context?.sources?.length) {
    return {
      ok: false,
      warnings,
      error: 'This plugin has neither an entry point nor any contributions, so there is nothing to publish.',
    }
  }

  // ── The R library ────────────────────────────────────────────────────────
  //
  // Verbatim, and it has to be: R sources these files, so there is no built
  // form of them. The docs say so rather than implying the store hides
  // everything.
  for (const rel of manifest.contributes?.rLibrary ?? []) {
    if (!names.includes(rel)) {
      warnings.push(`"${rel}" is listed in rLibrary but is not in the plugin folder; it was skipped.`)
      continue
    }
    try {
      out[rel] = await window.electronAPI.plugins.readFile(`${id}/${rel}`)
    } catch (e) {
      return { ok: false, error: `Could not read "${rel}": ${msg(e)}`, warnings }
    }
  }

  // ── Anything a reader expects to find ────────────────────────────────────
  // Context-only plugins have no compiled entry point. Their declared Markdown
  // is still executable guidance/evidence and must survive store round trips.
  for (const rel of new Set([...(manifest.context?.skills ?? []).flatMap(skill => [skill.bodyFile, ...(skill.sections ?? []).map(section => section.bodyFile)]), ...(manifest.context?.sources ?? []).map(source => source.bodyFile)])) {
    try { out[rel] = await window.electronAPI.plugins.readFile(`${id}/${rel}`) }
    catch (error) { return { ok: false, error: `Could not package context resource "${rel}": ${msg(error)}`, warnings } }
  }
  // Background services are native JavaScript and web assets, not renderer
  // inputs. Preserve every declared file so installed packages are complete.
  for (const rel of manifest.service?.files ?? []) {
    try { out[rel] = await window.electronAPI.plugins.readFile(`${id}/${rel}`) }
    catch (error) { return { ok: false, error: `Could not package service asset "${rel}": ${msg(error)}`, warnings } }
  }

  for (const rel of COPIED) {
    if (!names.includes(rel) || out[rel] !== undefined) continue
    try {
      out[rel] = await window.electronAPI.plugins.readFile(`${id}/${rel}`)
    } catch { /* a missing README is not a reason to fail a submission */ }
  }

  out[MANIFEST_FILE] = `${JSON.stringify(dist, null, 2)}\n`

  // The invariant, checked rather than assumed. It is the one thing an author
  // is promised, and a bug that broke it would publish their sources silently.
  const leaked = Object.keys(out).filter((k) => SOURCE_RE.test(k))
  if (leaked.length) {
    return {
      ok: false,
      warnings,
      error: `Refusing to publish: the built package still contains source files (${leaked.join(', ')}). ` +
        'This is a bug in ouRGeo, not in your plugin — please report it.',
    }
  }

  if (!manifest.main) {
    warnings.push(
      'This plugin is declarative, so its contributions travel as readable JSON in the manifest. ' +
      'Only an entry point is compiled.',
    )
  }

  return { ok: true, files: out, warnings }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
