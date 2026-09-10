import { describe, it, expect, beforeAll } from 'vitest'
import * as esbuild from 'esbuild-wasm'
import { loadBuildOptions, distBuildOptions, HOST_GLOBAL, BUNDLE_GLOBAL } from './compile'

// The two-pass round trip, run for real.
//
// A plugin installed from the store ships ONE minified module, not the
// author's sources. That module is produced by `bundleForDistribution`, and it
// is then compiled AGAIN by `compilePlugin` when the plugin loads — which is
// what lets the store change nothing about the loader.
//
// Everything about that only works if three things hold, and none of them is
// obvious enough to take on trust:
//
//  1. `activate` survives minification and comes back out of the second pass
//     as `__ourgeo_plugin__.activate`. It does, because esbuild never renames
//     the external name in an export clause — but "the minifier will not touch
//     this identifier" is exactly the kind of claim that turns out to be false
//     one version later.
//  2. `__ourgeo_host__` stays a free identifier through both passes. It is
//     unbound, so esbuild leaves it alone; the sandbox supplies it as a wrapper
//     parameter.
//  3. The host shims are left EXTERNAL by the distribution pass. Inlining them
//     would freeze ouRGeo's private ABI into every published artifact, so
//     renaming HOST_GLOBAL would kill every plugin in the store at once, with a
//     ReferenceError thrown inside `new Function` and a stack pointing nowhere
//     near the cause. That is the assertion this file exists for.
//
// It runs the real compiler with the real options and the real resolver
// plugins. What it does NOT go through is `loadEsbuild`, which fetches a wasm
// blob over IPC and hands it to esbuild's browser-only `wasmModule` path —
// unavailable under Node, and not where any of the risk lives. Hence
// `loadBuildOptions` / `distBuildOptions` being exported: the options ARE the
// thing under test.

beforeAll(async () => {
  await esbuild.initialize({})
}, 60_000)

async function bundle(options: esbuild.BuildOptions): Promise<string> {
  const out = await esbuild.build(options)
  return out.outputFiles?.[0]?.text ?? ''
}

const SOURCES: Record<string, string> = {
  // `host` is used at RUN time, not just as a type. A plugin that only ever
  // touches its `ctx` argument compiles to code with no reference to the host
  // global at all — true, ordinary, and useless for proving the import
  // survives.
  'main.ts': `
    import host from 'ourgeo'
    import { greeting } from './lib/util'

    export const meta = { name: 'demo' }

    export async function activate(): Promise<string> {
      host.log(greeting())
      return greeting()
    }
  `,
  'lib/util.ts': `export function greeting(): string { return 'from-util' }`,
}

describe('bundleForDistribution', () => {
  it('leaves the host shims as imports rather than inlining ouRGeo’s ABI', async () => {
    const code = await bundle(distBuildOptions({ files: SOURCES, entry: 'main.ts' }))

    // The whole point: `ourgeo` is still an import in the artifact, so the
    // load-time pass supplies the CURRENT shim.
    expect(code).toMatch(/from\s*["']ourgeo["']/)
    // And the private globals are not baked in.
    expect(code).not.toContain(HOST_GLOBAL)
    expect(code).not.toContain(BUNDLE_GLOBAL)
  }, 60_000)

  it('bundles the author’s other files in, so the artifact is one module', async () => {
    const code = await bundle(distBuildOptions({ files: SOURCES, entry: 'main.ts' }))
    expect(code).toContain('from-util')
    expect(code).not.toMatch(/from\s*["']\.\/lib\/util["']/)
  }, 60_000)

  it('minifies, and keeps the export name anyway', async () => {
    const code = await bundle(distBuildOptions({ files: SOURCES, entry: 'main.ts' }))
    expect(code).toContain('activate')
    // Minified: no comment banner, no indentation-per-line source shape.
    expect(code.split('\n').length).toBeLessThan(10)
  }, 60_000)
})

describe('the round trip', () => {
  it('runs, and hands back the same exports the sources declared', async () => {
    const dist = await bundle(distBuildOptions({ files: SOURCES, entry: 'main.ts' }))

    // Exactly what the store ships and the loader then reads back: one file.
    const code = await bundle(loadBuildOptions({ files: { 'main.js': dist }, entry: 'main.js' }))

    // `__ourgeo_host__` must still be free here — the sandbox passes it in as a
    // wrapper parameter, so a renamed or bound one would silently be undefined.
    expect(code).toContain(HOST_GLOBAL)

    const logged: unknown[] = []
    const host = { log: (...a: unknown[]) => logged.push(...a), ui: { jsxRuntime: {} } }
    const run = new Function(HOST_GLOBAL, `"use strict";\n${code}\n;return ${BUNDLE_GLOBAL};`)
    const exports = run(host) as { activate?: () => Promise<string>; meta?: { name: string } }

    expect(typeof exports.activate).toBe('function')
    expect(exports.meta).toEqual({ name: 'demo' })
    await expect(exports.activate!()).resolves.toBe('from-util')
    expect(logged).toEqual(['from-util'])
  }, 60_000)

  it('carries JSX through both passes to the host’s own React', async () => {
    const files = {
      'main.tsx': `
        export function Panel() { return <div className="x">hi</div> }
        export async function activate() { return Panel }
      `,
    }
    const dist = await bundle(distBuildOptions({ files, entry: 'main.tsx' }))
    // Still an import in the artifact — not a frozen copy of the bridge.
    expect(dist).toMatch(/ourgeo-jsx\/jsx-runtime/)

    const loaded = await bundle(loadBuildOptions({ files: { 'main.js': dist }, entry: 'main.js' }))
    // Resolved, by the second pass, to the host's runtime.
    expect(loaded).toContain(`${HOST_GLOBAL}.ui.jsxRuntime`)
  }, 60_000)
})
