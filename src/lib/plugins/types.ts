// What a plugin is.
//
// ouRGeo cannot be edited in place once it is installed: the renderer ships as
// one minified bundle inside a read-only asar, and there is no compiler on the
// user's machine to rebuild it. Changing ouRGeo itself will always mean cloning
// the repository. A plugin is the other route — new capabilities, added while
// the app is running, by a user who is talking to the assistant rather than
// writing TypeScript.
//
// ── Four kinds of contribution, in order of preference ─────────────────────
//
// 1. DECLARATIVE (JSON). A connector, a toolbox tool, an action, a docs topic.
//    No code at all, so there is nothing to sandbox and nothing to trust — and
//    a weak model writing JSON against a schema succeeds far more often than
//    one writing JavaScript against an API it has to remember.
// 2. R. A file of helper functions sourced into the live session. The most
//    honest kind: R is what the whole application emits and what the user
//    already reads in the console.
// 3. JAVASCRIPT (or TypeScript, compiled on the way in). The escape hatch, for
//    the things a schema cannot express — a bespoke filter dialect, an XML
//    capabilities document, a panel with its own UI.
//
// The ordering is not a style preference. Kinds 1 and 2 are data the user can
// read; kind 3 is code that runs with the renderer's privileges, and it is the
// only one that needs the consent flow in the Plugin Manager.

import type { ZoneId } from '@/lib/layout/model'
import type { Tier, ParamDef } from '@/lib/ai-actions/types'
import type { ApiCategory, ApiServer } from '@/lib/api-connectors/types'
import type { FieldDef } from '@/components/toolbox/tools'

/** Bumped when a manifest can no longer be read as written. */
export const MANIFEST_VERSION = 1

export const MANIFEST_FILE = 'ourgeo-plugin.json'

/**
 * What a plugin says it needs.
 *
 * Declared, shown to the user before they enable it, and enforced by the host
 * API — a plugin without `network` has no `ctx.http` at all, rather than a
 * `ctx.http` that refuses. The list is deliberately coarse: a permission the
 * user cannot evaluate is not consent, and "may reach the internet" is a
 * question anyone can answer.
 *
 * There is no `filesystem` permission because there is no filesystem in the
 * renderer API. R operations remain visible in the console. The separate
 * `service` permission grants native system access to a declared background
 * process and is shown explicitly when enabling the plugin.
 */
export type PluginPermission = 'network' | 'r' | 'ui' | 'service'

export const PERMISSIONS: PluginPermission[] = ['network', 'r', 'ui', 'service']

export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  network: 'Fetch from the internet',
  r: 'Run R in your session',
  ui: 'Open dialogs and change the workspace',
  service: 'Run an isolated background service with native system access',
}

// ── Declarative contributions ──────────────────────────────────────────────

/** A docs topic, served to the assistant by `ourgeo_docs`. This is how a
 *  plugin teaches the assistant about itself rather than hoping it guesses. */
export interface DocsSpec {
  topic: string
  /** One line for the topic listing. */
  summary: string
  body: string
}

/** An action the assistant can run. `run` is declarative in all three forms,
 *  so an action never requires the plugin to ship JavaScript. */
export type ActionRunSpec =
  /** Run R, with `{param}` placeholders filled from the arguments. Echoed to
   *  the console like every other operation in ouRGeo. */
  | { kind: 'r'; code: string }
  /** Run existing actions in order, so a plugin can name a workflow without
   *  reimplementing any of it. */
  | { kind: 'sequence'; steps: { id: string; params?: Record<string, unknown> }[] }
  /** Call a named export of the plugin's `main`. Requires code; the last resort. */
  | { kind: 'js'; export: string }

export interface ActionSpec {
  /** Bare name — the loader namespaces it as `<plugin-id>:<name>`. */
  name: string
  summary: string
  params?: ParamDef[]
  tier?: Tier
  run: ActionRunSpec
}

/** A geoprocessing tool. `rTemplate` is the tool's whole implementation:
 *  `{fieldId}` placeholders, quoted per the field's type. */
export interface ToolSpec {
  name: string
  label: string
  description: string
  /** A shipped category id to append to, or a new one this plugin declares. */
  category: string
  categoryLabel?: string
  fields: FieldDef[]
  rTemplate: string
  output?: 'raster' | 'spatial' | 'table'
}

export interface ToolbarButtonSpec {
  name: string
  label: string
  /** A lucide icon name, e.g. "Waves". Unknown names fall back to a dot rather
   *  than failing the plugin — a missing icon is not worth losing a feature. */
  icon: string
  /** Exactly one of these. */
  action?: string
  panel?: string
}

export interface PanelSpec {
  name: string
  label: string
  defaultZone?: ZoneId
  min?: number
  /** Named export of `main` returning a React element. Panels need code. */
  export: string
}

/** A Web-API connector written as data. See api-connectors/declarative.ts for
 *  what each field means and which providers it can and cannot express. */
export interface ConnectorSpec {
  name: string
  label: string
  category: ApiCategory
  description: string
  /** The API's own documentation, for the connector's Help button. */
  docsUrl?: string
  servers: ApiServer[]
  cascade: unknown[]
  metadata: unknown
  import: unknown
  [key: string]: unknown
}

export interface PluginContributions {
  connectors?: ConnectorSpec[]
  toolboxTools?: ToolSpec[]
  actions?: ActionSpec[]
  toolbarButtons?: ToolbarButtonSpec[]
  panels?: PanelSpec[]
  docs?: DocsSpec[]
  /** Files, relative to the plugin directory, sourced into the R session. */
  rLibrary?: string[]
  // Themes and saved layouts are NOT contributable. Both already have a first
  // class import path a plugin gains nothing over — `.ourgeotheme.json` through
  // the Theme Studio, a preset through `layout:savePreset` — and both would
  // need to answer "what happens to the user's own when the plugin is removed",
  // which neither registry is built to answer. A manifest key that is accepted
  // and then ignored is worse than one that does not exist.
}

export interface PluginManifest {
  /** Lowercase, hyphenated. Namespaces everything the plugin contributes, so
   *  two plugins can both have a "buffer" tool. */
  id: string
  name: string
  version: string
  /** Semver range the plugin needs, e.g. ">=1.11.0". Refused with a sentence
   *  naming both versions when the running app is older. */
  ourgeoVersion?: string
  description?: string
  author?: string
  homepage?: string
  permissions?: PluginPermission[]
  /** Entry point, relative to the plugin directory. `.ts`/`.tsx` are compiled
   *  on load; omit it entirely for a declarative-only plugin. */
  main?: string
  /** Node service run by Electron, with a private IPC handshake and lifecycle. */
  service?: { entry: string; files: string[] }
  contributes?: PluginContributions
  /** Manifest format version, not the plugin's own. */
  manifestVersion?: number
}

// ── Where a plugin came from ───────────────────────────────────────────────

// `StoreOrigin` lives in its own module and is re-exported here.
//
// This file imports from the layout model, the action types, the connector
// types and the toolbox — i.e. most of the renderer. `electron/main/plugins.ts`
// needs the origin record and must not drag any of that into the node
// tsconfig, which is the same split `panel-meta.ts` and `panel-render.ts`
// exist for.
export { STORE_ORIGIN_FILE, type StoreOrigin } from './store-origin'
import type { StoreOrigin } from './store-origin'

// ── Loaded state ───────────────────────────────────────────────────────────

export type PluginState =
  /** Enabled and activated without error. */
  | 'active'
  /** Installed but switched off. Contributes nothing. */
  | 'disabled'
  /** Enabled, but the manifest or the code failed. `error` says how. */
  | 'failed'
  /** Enabled and would have run, but ouRGeo skipped every plugin this launch
   *  because one of them took the app down last time. */
  | 'skipped'

export interface LoadedPlugin {
  manifest: PluginManifest
  /** Absolute path to the plugin's directory. */
  dir: string
  state: PluginState
  /** The whole message, never truncated — a clipped stack is a bug report
   *  nobody can act on. */
  error?: string
  /** What it actually registered, for the Plugin Manager's summary. */
  registered: string[]
  /** Set when this plugin came from the plugin store. */
  origin?: StoreOrigin
}
