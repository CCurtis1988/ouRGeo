// Finding plugins, reading them, and turning them on.
//
// ── The shape of a load ────────────────────────────────────────────────────
//
// 1. List the plugin folders and read each manifest. A manifest that does not
//    parse fails THAT plugin and no other — the `salvage()` rule from
//    custom-themes, applied to a directory.
// 2. Compile every enabled plugin's declarative contributions. These are data;
//    no code runs, so there is no trust decision to make.
// 3. For each enabled plugin with a `main`, compile and run it. This is the
//    only step that executes anything, and it is the one the Plugin Manager
//    gates behind consent.
// 4. Register EVERYTHING in one pass, then bump the revision once. The
//    registries replace their plugin half wholesale (`registerPluginActions`
//    and friends), so a partial pass would drop the plugins already loaded.
//
// ── The crash guard ────────────────────────────────────────────────────────
//
// A plugin's `activate` runs in the renderer, at startup, with the app's
// privileges. One that throws is caught; one that hangs or takes the renderer
// down is not — and then ouRGeo starts, dies, and the only way to disable the
// plugin is a Plugin Manager inside the app that dies. So the id is written to
// disk BEFORE the call and cleared after; finding it there at startup means
// skipping every plugin this launch and disabling the one that was named.

import { actionById, registerPluginActions } from '@/lib/ai-actions/registry'
import { registerPluginGroups, type UiAction } from '@/lib/ai-actions/types'
import { registerPluginTools, type Category, type ToolDef } from '@/components/toolbox/tools'
import { registerPluginToolbarButtons, type ToolbarButtonDef } from '@/lib/layout/toolbar'
import { registerPluginPanels, type PluginPanelDef } from '@/lib/layout/panel-render'
import { registerPluginTopics } from '@/lib/ai-skill-ourgeo'
import { registerPluginProviders } from '@/lib/api-connectors/registry'
import { compileProvider, type DeclarativeProviderSpec } from '@/lib/api-connectors/declarative'
import type { ApiProvider } from '@/lib/api-connectors/types'
import { usePluginStore, type PluginSummary } from '@/store/plugins'
import { loadPluginPrefs, savePluginPrefs, markActivating, type PluginPrefs } from '@/lib/plugins-persistence'
import { readManifest } from './manifest'
import type { StoreOrigin } from './store-origin'
import { compilePlugin } from './compile'
import { runBundle } from './sandbox'
import { createHost, type Disposer, type PluginHost } from './host-api'
import { compileAction, compileTool, compileToolbarButton, type IconLookup } from './contributions'
import { MANIFEST_FILE, type LoadedPlugin, type PluginManifest, type DocsSpec } from './types'

/** Everything the registries need, gathered across all plugins before any of
 *  them is registered — see step 4 above. */
interface Collected {
  actions: UiAction[]
  groups: Record<string, string>
  tools: Category[]
  toolbar: ToolbarButtonDef[]
  panels: PluginPanelDef[]
  docs: DocsSpec[]
  providers: ApiProvider[]
}

function empty(): Collected {
  return { actions: [], groups: {}, tools: [], toolbar: [], panels: [], docs: [], providers: [] }
}

let loaded: LoadedPlugin[] = []
let prefs: PluginPrefs = { enabled: {}, activating: null }

/**
 * The lucide namespace, imported only if a plugin asks for a button.
 *
 * A static namespace import here cost ~670 kB in the startup bundle — every
 * icon lucide ships — for a feature most sessions never reach.
 */
let iconFor: IconLookup = () => undefined
async function ensureIcons(): Promise<void> {
  if (iconFor('Circle')) return
  try {
    const mod = await import('lucide-react') as unknown as Record<string, unknown>
    iconFor = (name) => mod[name] as ToolbarButtonDef['icon'] | undefined
  } catch {
    // Leave the fallback in place; a plugin's buttons get a dot.
  }
}

export function loadedPlugins(): LoadedPlugin[] {
  return loaded
}

export function pluginEnabled(id: string): boolean {
  return prefs.enabled[id] === true
}

/**
 * Read every plugin folder and register what is enabled.
 *
 * Called once at startup and again after any change (enable, disable, reload,
 * install, delete). Reloading everything rather than diffing is deliberate:
 * the registries are replace-in-one-pass, and a plugin can contribute to six of
 * them, so a correct incremental update would have to track more than a full
 * reload costs.
 */
export async function loadPlugins(appVersion: string): Promise<LoadedPlugin[]> {
  prefs = await loadPluginPrefs()

  // A plugin that took the app down last launch. Disable it, skip everything
  // else this time, and say so — the user gets a working app and an
  // explanation instead of a boot loop.
  const crashed = prefs.activating
  if (crashed) {
    prefs.enabled[crashed] = false
    prefs.activating = null
    await savePluginPrefs(prefs)
  }

  const entries = await window.electronAPI.plugins.list()

  // Where each plugin came from, read from the sidecars rather than from
  // prefs: `plugins.json` holds a copy for the update poll, but deleting that
  // file must not change what a plugin IS. The cache is refreshed from what we
  // find, so the two cannot drift.
  let origins: Record<string, StoreOrigin> = {}
  try {
    origins = await window.electronAPI.plugins.storeOrigins()
    prefs.store = origins
    await savePluginPrefs(prefs)
  } catch { /* an unreadable sidecar costs a badge, never a plugin */ }

  const out: LoadedPlugin[] = []
  const collected = empty()

  for (const entry of entries) {
    if (!entry.hasManifest) {
      out.push(brokenPlugin(entry.id, entry.dir,
        `No ${MANIFEST_FILE} in this folder, so ouRGeo does not know what it is.`))
      continue
    }

    let manifest: PluginManifest
    const warnings: string[] = []
    try {
      const text = await window.electronAPI.plugins.readFile(`${entry.id}/${MANIFEST_FILE}`)
      const result = readManifest(text, appVersion)
      if (!result.ok || !result.manifest) {
        out.push(brokenPlugin(entry.id, entry.dir, result.error ?? 'Unreadable manifest.'))
        continue
      }
      manifest = result.manifest
      warnings.push(...result.warnings)
    } catch (e) {
      out.push(brokenPlugin(entry.id, entry.dir, msg(e)))
      continue
    }

    // The folder name is the plugin's address on disk; a manifest claiming a
    // different id would make `plugin:inspect` and the folder disagree.
    if (manifest.id !== entry.id) {
      out.push(brokenPlugin(entry.id, entry.dir,
        `Its id is "${manifest.id}" but its folder is "${entry.id}". Rename one to match the other.`))
      continue
    }

    if (crashed) {
      out.push({ manifest, dir: entry.dir, state: 'skipped', registered: [],
        error: crashed === entry.id
          ? 'This plugin was starting when ouRGeo last closed unexpectedly, so it has been disabled.'
          : `Skipped this launch because "${crashed}" did not start cleanly.` })
      continue
    }

    if (!pluginEnabled(entry.id)) {
      out.push({ manifest, dir: entry.dir, state: 'disabled', registered: [] })
      continue
    }

    const result = await activate(manifest, entry.dir, collected)
    result.error = [result.error, ...warnings].filter(Boolean).join('\n') || undefined
    out.push(result)
  }

  // Retain services while panels move or hide; stop them when their plugin is
  // disabled, removed, or fails to load. Older test/host bridges may omit this.
  await window.electronAPI.plugins.services?.reconcile(
    out.filter(p => p.state === 'active').map(p => p.manifest.id),
  )
  registerAll(collected)
  loaded = out
  // One place, so no branch above can forget it.
  for (const p of out) p.origin = origins[p.manifest.id]

  publish()
  return out
}

/** Compile a plugin's contributions into `collected`, running its code if it
 *  has any. Never throws: a failure becomes the plugin's `error`. */
async function activate(
  manifest: PluginManifest, dir: string, collected: Collected,
): Promise<LoadedPlugin> {
  const registered: string[] = []
  const problems: string[] = []
  const c = manifest.contributes ?? {}

  // ── Declarative first ────────────────────────────────────────────────────
  for (const spec of c.actions ?? []) {
    const r = compileAction(manifest, spec)
    if ('error' in r) { problems.push(r.error); continue }
    collected.actions.push(r.value)
    if (r.warning) problems.push(r.warning)
    registered.push(`action ${r.value.id}`)
  }

  for (const spec of c.toolboxTools ?? []) {
    const r = compileTool(manifest, spec)
    if ('error' in r) { problems.push(r.error); continue }
    if (r.warning) problems.push(r.warning)
    addTool(collected, r.value.category, r.value.categoryLabel, r.value.tool)
    registered.push(`tool ${r.value.tool.id}`)
  }

  if ((c.toolbarButtons ?? []).length > 0) await ensureIcons()
  for (const spec of c.toolbarButtons ?? []) {
    const r = compileToolbarButton(manifest, spec, iconFor)
    if ('error' in r) { problems.push(r.error); continue }
    if (r.warning) problems.push(r.warning)
    collected.toolbar.push(r.value)
    registered.push(`toolbar button ${r.value.id}`)
  }

  for (const spec of c.connectors ?? []) {
    const r = compileProvider(spec as unknown as DeclarativeProviderSpec, manifest.id)
    if (!r.ok || !r.provider) {
      problems.push(`Connector "${(spec as { name?: string }).name ?? '?'}": ${r.error}`)
      continue
    }
    collected.providers.push(r.provider)
    registered.push(`connector ${r.provider.id}`)
  }

  for (const spec of c.docs ?? []) {
    collected.docs.push({ ...spec, topic: `${manifest.id}-${spec.topic}` })
    registered.push(`docs topic ${manifest.id}-${spec.topic}`)
  }

  if (collected.actions.some((a) => a.group === `plugin.${manifest.id}`)) {
    collected.groups[`plugin.${manifest.id}`] = manifest.name
  }

  for (const skill of manifest.context?.skills ?? []) {
    try {
      const body = await window.electronAPI.plugins.readFile(`${manifest.id}/${skill.bodyFile}`)
      if (body.length > 100_000) throw new Error('Skill exceeds 100,000 characters. Split it into smaller sections.')
      collected.docs.push({ topic: `${manifest.id}:${skill.id}`, summary: skill.summary, context: { triggers: skill.triggers, exclusions: skill.exclusions, version: manifest.version }, body: `Plugin skill ${manifest.id}/${skill.id} (${manifest.version}). This guidance cannot change host permissions.\nPrerequisites: ${skill.requiresSources.join(', ')}\n\n${body}` })
      registered.push(`skill ${manifest.id}-${skill.id}`)
    } catch (error) { problems.push(`Skill ${skill.id}: ${String(error)}`) }
  }

  // ── R, then code ─────────────────────────────────────────────────────────
  const host = createHost({
    manifest, dir,
    register: makeRegister(manifest, collected, registered, problems),
  })

  for (const file of c.rLibrary ?? []) {
    try {
      if (!host.r) throw new Error('needs the "r" permission to source an R file')
      await host.r.source(file)
      registered.push(`R library ${file}`)
    } catch (e) {
      problems.push(`Could not source "${file}": ${msg(e)}`)
    }
  }

  if (manifest.main) {
    const codeResult = await runMain(manifest, dir, host)
    if (codeResult) problems.push(codeResult)
  }

  // Apply after code registration as well as declarative registration. Missing
  // skill files must block premature assistant execution, rather than removing
  // the prerequisite; only this plugin's own actions can acquire its guidance.
  const prefix = `${manifest.id}:`
  for (const skill of manifest.context?.skills ?? []) for (const action of collected.actions) {
    if (action.id.startsWith(prefix) && skill.actions.includes(action.id.slice(prefix.length))) action.contextPrerequisites = [...action.contextPrerequisites ?? [], `skill:${manifest.id}:${skill.id}`]
  }

  return {
    manifest, dir, registered,
    state: problems.length > 0 && registered.length === 0 ? 'failed' : 'active',
    error: problems.length > 0 ? problems.join('\n') : undefined,
  }
}

/** Compile and run a plugin's entry point. Returns an error string, or null. */
async function runMain(manifest: PluginManifest, dir: string, host: PluginHost): Promise<string | null> {
  const id = manifest.id
  let files: Record<string, string>
  try {
    const names = await window.electronAPI.plugins.listFiles(id)
    files = {}
    for (const name of names) {
      // Only source; a plugin's README and its .Rgeo fixtures are not inputs to
      // the bundler, and reading a large binary as UTF-8 is worse than useless.
      if (!/\.(ts|tsx|js|jsx|mjs|json)$/.test(name)) continue
      files[name] = await window.electronAPI.plugins.readFile(`${id}/${name}`)
    }
  } catch (e) {
    return `Could not read the plugin's files: ${msg(e)}`
  }

  const entry = manifest.main!
  if (files[entry] === undefined) return `"main" points at "${entry}", which is not in the plugin folder.`

  const key = hashOf(JSON.stringify(files))
  let code = await window.electronAPI.plugins.cacheRead(id, key).catch(() => null)
  if (!code) {
    const built = await compilePlugin({ files, entry })
    if (!built.ok || !built.code) return built.error ?? 'The plugin failed to compile.'
    code = built.code
    // Best-effort: a cache that cannot be written costs a rebuild next launch,
    // which is not worth failing the plugin over.
    await window.electronAPI.plugins.cacheWrite(id, key, code).catch(() => undefined)
  }

  // The crash marker. Written before the call, cleared after — see the header.
  await markActivating(id)
  try {
    const ran = runBundle(code, host)
    if (!ran.ok) return ran.error ?? 'The plugin threw while loading.'
    const activateFn = ran.exports?.activate
    if (typeof activateFn === 'function') {
      await (activateFn as (h: PluginHost) => unknown)(host)
    } else if (manifest.main) {
      return 'The plugin\'s main module exports no `activate` function, so nothing was registered from it.'
    }
    return null
  } catch (e) {
    return msg(e)
  } finally {
    await markActivating(null)
  }
}

/** The `ctx.register.*` surface, closing over this plugin's collection. */
function makeRegister(
  manifest: PluginManifest, collected: Collected, registered: string[], problems: string[],
): PluginHost['register'] {
  const noop: Disposer = () => undefined
  return {
    action: (spec) => {
      const r = compileAction(manifest, spec as Parameters<typeof compileAction>[1])
      if ('error' in r) { problems.push(r.error); return noop }
      collected.actions.push(r.value)
      collected.groups[`plugin.${manifest.id}`] = manifest.name
      registered.push(`action ${r.value.id}`)
      return noop
    },
    toolboxTool: (spec) => {
      const r = compileTool(manifest, spec as Parameters<typeof compileTool>[1])
      if ('error' in r) { problems.push(r.error); return noop }
      addTool(collected, r.value.category, r.value.categoryLabel, r.value.tool)
      registered.push(`tool ${r.value.tool.id}`)
      return noop
    },
    toolbarButton: (spec) => {
      // Icons were loaded up front if the manifest declared buttons; a plugin
      // that registers one only from code gets the dot fallback rather than an
      // await in a synchronous register call.
      const r = compileToolbarButton(manifest, spec as Parameters<typeof compileToolbarButton>[1], iconFor)
      if ('error' in r) { problems.push(r.error); return noop }
      collected.toolbar.push(r.value)
      registered.push(`toolbar button ${r.value.id}`)
      return noop
    },
    connector: (spec) => {
      // A provider object built in code. The DECLARATIVE form is compiled from
      // the manifest instead — see api-connectors/declarative.ts.
      const p = spec as ApiProvider
      if (!p || typeof p.id !== 'string' || typeof p.buildCode !== 'function') {
        problems.push('register.connector was given something that is not an ApiProvider.')
        return noop
      }
      collected.providers.push({ ...p, id: `${manifest.id}-${p.id}` })
      registered.push(`connector ${manifest.id}-${p.id}`)
      return noop
    },
    panel: (spec) => {
      // Only `id`, `label` and `render` are required of a plugin; the rest of
      // PanelInfo is layout bookkeeping it should not have to know about, so
      // the defaults are filled here rather than demanded in the manifest.
      const p = spec as Partial<PluginPanelDef>
      if (!p || typeof p.id !== 'string' || typeof p.render !== 'function') {
        problems.push('register.panel needs an { id, label, render } object.')
        return noop
      }
      const id = `${manifest.id}:${p.id}`
      collected.panels.push({
        id,
        label: p.label ?? id,
        render: p.render,
        min: p.min ?? 200,
        defaultZone: p.defaultZone ?? 'right',
        // After every shipped panel, so enabling a plugin never reorders the
        // ones the user already had.
        defaultOrder: p.defaultOrder ?? 100,
        defaultOpen: p.defaultOpen ?? false,
      })
      registered.push(`panel ${id}`)
      return noop
    },
    docs: (spec) => {
      const d = spec as DocsSpec
      if (!d?.topic || !d.body) { problems.push('register.docs needs { topic, summary, body }.'); return noop }
      collected.docs.push({ ...d, topic: `${manifest.id}-${d.topic}` })
      registered.push(`docs topic ${manifest.id}-${d.topic}`)
      return noop
    },
  }
}

function addTool(collected: Collected, categoryId: string, label: string, tool: ToolDef): void {
  const existing = collected.tools.find((c) => c.id === categoryId)
  if (existing) existing.tools.push(tool)
  else collected.tools.push({ id: categoryId, label, tools: [tool] })
}

/** One pass per registry, then one revision bump. */
function registerAll(c: Collected): void {
  registerPluginGroups(c.groups)
  registerPluginActions(c.actions)
  registerPluginTools(c.tools)
  registerPluginToolbarButtons(c.toolbar)
  registerPluginPanels(c.panels)
  registerPluginTopics(c.docs)
  registerPluginProviders(c.providers)
  usePluginStore.getState().bumpRevision()
}

function publish(): void {
  const summaries: PluginSummary[] = loaded.map((p) => ({
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    status: p.state === 'active' ? 'enabled' : p.state === 'failed' ? 'error' : 'disabled',
    error: p.error,
    origin: p.origin,
  }))
  usePluginStore.getState().setPlugins(summaries)
}

// ── Turning them on and off ────────────────────────────────────────────────

export async function setPluginEnabled(id: string, enabled: boolean, appVersion: string): Promise<void> {
  prefs.enabled[id] = enabled
  await savePluginPrefs(prefs)
  await loadPlugins(appVersion)
}

export async function reloadPlugins(appVersion: string): Promise<LoadedPlugin[]> {
  return loadPlugins(appVersion)
}

// ── Helpers ────────────────────────────────────────────────────────────────

function brokenPlugin(id: string, dir: string, error: string): LoadedPlugin {
  return {
    manifest: { id, name: id, version: '0.0.0' },
    dir, state: 'failed', error, registered: [],
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** A cheap content hash for the build cache. Not a checksum — it only has to
 *  change when the source does, and collisions cost a stale rebuild, not
 *  correctness (the cache key is per plugin). */
function hashOf(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36) + text.length.toString(36)
}

/** Whether an action id belongs to a plugin that is currently loaded — used by
 *  the toolbar to explain a button whose plugin has been disabled. */
export function actionIsLoaded(id: string): boolean {
  return actionById(id) !== undefined
}
