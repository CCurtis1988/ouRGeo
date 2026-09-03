// Running a plugin's code.
//
// ── What this is, and what it is not ───────────────────────────────────────
//
// It is a SOFT sandbox. The bundle runs inside a function whose parameters
// shadow the identifiers a plugin has no business touching — `electronAPI`
// above all, but also `require`, `process`, `fetch` and the storage APIs — so
// the only way out is the `ourgeo` object it is handed. That stops accidents
// and casual reach-arounds. It does not stop a determined author: the code
// still runs in the renderer's realm, and `({}).constructor.constructor` walks
// straight back out to the real global scope. No amount of shadowing changes
// that; only a Worker or a cross-origin frame would, and neither can touch the
// DOM or the stores, which is most of what a panel plugin is for.
//
// So the real control is CONSENT, and it lives in the Plugin Manager: a plugin
// with code arrives disabled, and enabling it shows what it contributes and
// what it asked for. That is the same bargain ouRGeo already asks users to
// make every time it tells them to run `install.packages()` — and it should be
// described to them in exactly those terms, rather than implying a safety this
// does not provide.
//
// A DECLARATIVE plugin never reaches this module at all. That is the reason
// the manifest can express connectors, tools, actions and docs as data: the
// common cases then carry no trust decision whatsoever.

import { BUNDLE_GLOBAL, HOST_GLOBAL } from './compile'
import type { PluginHost } from './host-api'

/**
 * Names blanked out for the duration of the call.
 *
 * `electronAPI` is the one that matters — it is the whole main-process surface,
 * including unrestricted `file.write`. The rest are the routes a plugin might
 * take by habit rather than by intent: network calls that skip the permission
 * check and the console log, and storage that is not scoped to the plugin.
 */
const SHADOWED = [
  'electronAPI',
  'require', 'process', 'module', 'exports', 'global', '__dirname', '__filename',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'importScripts', 'open', 'postMessage',
]

export interface RunResult {
  ok: boolean
  /** The entry module's exports. */
  exports?: Record<string, unknown>
  error?: string
}

/**
 * Evaluate a compiled bundle and return its exports.
 *
 * `new Function` rather than a blob-URL module import, for one reason: a module
 * has no parameter list, so there is nowhere to hang the shadowed names. The
 * CSP already permits `'unsafe-eval'`, so this needs no relaxation.
 */
export function runBundle(code: string, host: PluginHost): RunResult {
  try {
    const factory = new Function(
      ...SHADOWED,
      HOST_GLOBAL,
      `"use strict";\n${code}\n;return typeof ${BUNDLE_GLOBAL} === 'undefined' ? {} : ${BUNDLE_GLOBAL};`,
    )
    const exports = factory(...SHADOWED.map(() => undefined), host) as Record<string, unknown>
    return { ok: true, exports: exports ?? {} }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}`.trim() : String(e) }
  }
}

/** The names a plugin cannot see, for the Plugin Manager to show and for the
 *  docs to quote rather than describe from memory. */
export const SHADOWED_NAMES: readonly string[] = SHADOWED
