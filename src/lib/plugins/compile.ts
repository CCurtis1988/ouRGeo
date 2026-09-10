// Turning a plugin's source into something the sandbox can run.
//
// Plugins may be written in TypeScript and JSX, because that is the idiom the
// rest of ouRGeo is written in and the one an assistant will reach for. There
// is no compiler on an installed machine — `typescript` and `vite` are
// devDependencies and never ship — so ouRGeo carries `esbuild-wasm` and does
// the build itself, in the renderer, at load time.
//
// Three decisions worth knowing:
//
//  * **The wasm arrives over IPC, not over `fetch`.** The renderer is a
//    `file://` page under `default-src 'self'`; fetching a sibling file is
//    blocked, silently. `plugins:esbuildWasm` reads it out of the asar and
//    hands back base64.
//  * **esbuild loads lazily.** A dynamic import keeps 13 MB of wasm and its
//    loader out of the startup path; a declarative-only plugin never pays for
//    it at all.
//  * **The output is an IIFE with a `globalName`, not an ES module.** The
//    sandbox runs the bundle inside `new Function(...)`, which needs a
//    statement list it can `return` a value out of. An ES module would have to
//    go through a blob URL, and a blob module cannot have the host's globals
//    shadowed around it.

import type * as ESBuild from 'esbuild-wasm'

/** The identifier the bundle sees for the host API — a parameter of the
 *  sandbox's wrapper function, so it is not reachable from anywhere else. */
export const HOST_GLOBAL = '__ourgeo_host__'

/** What the wrapper returns: the entry module's exports. */
export const BUNDLE_GLOBAL = '__ourgeo_plugin__'

export interface CompileInput {
  /** Every file in the plugin folder, keyed by path relative to it. */
  files: Record<string, string>
  /** The manifest's `main`, relative to the plugin folder. */
  entry: string
}

export interface CompileResult {
  ok: boolean
  code?: string
  error?: string
}

let esbuild: typeof ESBuild | null = null
let initializing: Promise<typeof ESBuild> | null = null

/** Load and initialise esbuild-wasm once, on first use. */
async function loadEsbuild(): Promise<typeof ESBuild> {
  if (esbuild) return esbuild
  if (!initializing) {
    initializing = (async () => {
      const mod = await import('esbuild-wasm')
      const base64 = await window.electronAPI.plugins.esbuildWasm()
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const wasmModule = await WebAssembly.compile(bytes)
      await mod.initialize({ wasmModule })
      esbuild = mod
      return mod
    })()
    initializing.catch(() => { initializing = null })   // let a failure be retried
  }
  return initializing
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json']

/**
 * Bundle a plugin.
 *
 * There is no filesystem in the browser build, so the plugin's files are
 * resolved from the map we already read over IPC. That is not a workaround —
 * it is also the containment: a plugin cannot `import` anything outside its own
 * folder, because nothing outside its folder is in the map.
 */
export async function compilePlugin({ files, entry }: CompileInput): Promise<CompileResult> {
  let build: typeof ESBuild
  try {
    build = await loadEsbuild()
  } catch (e) {
    return { ok: false, error: `Could not start the plugin compiler: ${message(e)}` }
  }

  return runBuild(build, loadBuildOptions({ files, entry }))
}

/**
 * The load-time build.
 *
 * Separate from `compilePlugin` so it can be handed to an esbuild that was
 * started some other way. What is worth testing here is these options and the
 * two resolver plugins, not the six lines that fetch a wasm blob over IPC —
 * and esbuild-wasm's `wasmModule` path is browser-only, so a test that went
 * through the loader could not run at all.
 */
export function loadBuildOptions({ files, entry }: CompileInput): ESBuild.BuildOptions {
  return {
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: BUNDLE_GLOBAL,
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    // React is not in the map, so automatic JSX would try to import
    // `react/jsx-runtime`. Point it at the host instead: `ctx.ui.jsx` is the
    // real runtime, injected rather than bundled, so a plugin's React is
    // always the app's React and hooks work.
    jsxImportSource: 'ourgeo-jsx',
    plugins: [jsxRuntimeShim(), virtualFiles(files)],
    logLevel: 'silent',
  }
}

async function runBuild(build: typeof ESBuild, options: ESBuild.BuildOptions): Promise<CompileResult> {
  try {
    const out = await build.build(options)
    const code = out.outputFiles?.[0]?.text
    if (!code) return { ok: false, error: 'The compiler produced no output.' }
    return { ok: true, code }
  } catch (e) {
    return { ok: false, error: formatBuildFailure(e) }
  }
}

/**
 * Resolve a plugin's imports from the file map, and nothing else.
 *
 * There is no filesystem in the browser build, so the plugin's files come from
 * the map read over IPC. That is not a workaround — it is also the
 * containment: a plugin cannot `import` anything outside its own folder,
 * because nothing outside its folder is in the map.
 *
 * `hostShim: false` leaves `ourgeo` and the JSX runtime as EXTERNAL imports
 * instead of inlining them. See `bundleForDistribution` for why that matters.
 */
function virtualFiles(files: Record<string, string>, opts: { hostShim?: boolean } = {}): ESBuild.Plugin {
  const hostShim = opts.hostShim !== false
  const resolveIn = (from: string, spec: string): string | null => {
    const base = spec.startsWith('.')
      ? normalize(`${dirOf(from)}/${spec}`)
      : normalize(spec)
    for (const ext of EXTENSIONS) {
      if (files[base + ext] !== undefined) return base + ext
      if (files[`${base}/index${ext}`] !== undefined) return `${base}/index${ext}`
    }
    return null
  }

  return {
    name: 'ourgeo-plugin-files',
    setup(b) {
      // `import ... from 'ourgeo'` is the host API. It becomes a one-line
      // module re-exporting the sandbox's parameter, so a plugin can use a
      // normal import instead of reaching for a global.
      b.onResolve({ filter: /^ourgeo$/ }, () => (
        hostShim
          ? { path: 'ourgeo', namespace: 'ourgeo-host' }
          : { path: 'ourgeo', external: true }
      ))
      b.onLoad({ filter: /.*/, namespace: 'ourgeo-host' }, () => ({
        contents: `const host = ${HOST_GLOBAL};\nexport default host;\nexport const ourgeo = host;\n`,
        loader: 'js',
      }))

      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return { path: normalize(args.path), namespace: 'plugin' }
        const hit = resolveIn(args.importer, args.path)
        if (hit) return { path: hit, namespace: 'plugin' }
        // A bare specifier that is not `ourgeo` and not a file in the folder is
        // a dependency the plugin does not have. Say which one, rather than
        // failing later on an undefined symbol.
        return {
          errors: [{
            text: `Cannot import "${args.path}": plugins have no node_modules. ` +
              `Import from "ourgeo" for the host API, or add the file to the plugin folder.`,
          }],
        }
      })

      b.onLoad({ filter: /.*/, namespace: 'plugin' }, (args) => {
        const contents = files[args.path]
        if (contents === undefined) return { errors: [{ text: `Missing file "${args.path}".` }] }
        return { contents, loader: loaderFor(args.path) }
      })
    },
  }
}

/**
 * Build the single minified module a plugin is DISTRIBUTED as.
 *
 * The plugin store ships one built file rather than the author's sources. This
 * is that build, and it differs from the load-time pass above in exactly three
 * ways — `format: 'esm'`, `minify: true`, and the host shims left EXTERNAL.
 *
 * **The externals are the part that matters, and inlining them would be a bug
 * with a very long fuse.** The shims above bake in `HOST_GLOBAL`,
 * `BUNDLE_GLOBAL` and the exact shape of the jsx runtime bridge, all of which
 * are private to this file today. Inline them into a published artifact and
 * every plugin in the store carries a frozen copy of ouRGeo's internal ABI:
 * rename `HOST_GLOBAL` and they all die at once with
 * `__ourgeo_host__ is not defined`, thrown inside `new Function` with a stack
 * that points nowhere near the cause. Left external, `main.js` says
 * `import { jsxs } from "ourgeo-jsx/jsx-runtime"` and the load-time pass hands
 * it whatever the shim means TODAY.
 *
 * `format: 'esm'` is what makes the second pass possible at all: it needs an
 * entry module with a real export clause to re-export `activate` from. Shipping
 * the finished IIFE instead would pin the ABI *and* skip the one pass that can
 * still be fixed in a patch release.
 *
 * Two smaller decisions:
 *   * `legalComments: 'eof'`, not `'none'`. Stripping a `/*! … *\/` licence
 *     header out of a file the author vendored into their folder is a licence
 *     violation performed on their behalf.
 *   * `keepNames`, because minification otherwise rewrites `fn.name`, and a
 *     plugin that dispatches on it would work in development and not in the
 *     store.
 *
 * `target` must stay in step with the load-time pass, or the second one
 * down-levels output the first already down-levelled.
 */
export async function bundleForDistribution({ files, entry }: CompileInput): Promise<CompileResult> {
  let build: typeof ESBuild
  try {
    build = await loadEsbuild()
  } catch (e) {
    return { ok: false, error: `Could not start the plugin compiler: ${message(e)}` }
  }

  return runBuild(build, distBuildOptions({ files, entry }))
}

/** The distribution build's options. See `bundleForDistribution`. */
export function distBuildOptions({ files, entry }: CompileInput): ESBuild.BuildOptions {
  return {
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    keepNames: true,
    charset: 'utf8',
    legalComments: 'eof',
    sourcemap: false,
    jsx: 'automatic',
    jsxImportSource: 'ourgeo-jsx',
    plugins: [externalHostShim(), virtualFiles(files, { hostShim: false })],
    logLevel: 'silent',
  }
}

/** Keep the JSX runtime an import rather than inlining the bridge. */
function externalHostShim(): ESBuild.Plugin {
  return {
    name: 'ourgeo-external-host',
    setup(b) {
      // A custom onResolve fires ahead of the top-level `external:` array, so
      // marking these here is the only thing that works alongside the virtual
      // file map.
      b.onResolve({ filter: /^ourgeo-jsx\/jsx-(dev-)?runtime$/ }, (args) => ({
        path: args.path, external: true,
      }))
    },
  }
}

/** `jsxImportSource` sends every JSX file to `<source>/jsx-runtime`; serve that
 *  from the host so a plugin's elements are made by the app's own React. */
function jsxRuntimeShim(): ESBuild.Plugin {
  return {
    name: 'ourgeo-jsx-runtime',
    setup(b) {
      b.onResolve({ filter: /^ourgeo-jsx\/jsx-(dev-)?runtime$/ }, (args) => ({
        path: args.path, namespace: 'ourgeo-host',
      }))
      b.onLoad({ filter: /^ourgeo-jsx\/jsx-(dev-)?runtime$/, namespace: 'ourgeo-host' }, () => ({
        contents:
          `const r = ${HOST_GLOBAL}.ui.jsxRuntime;\n` +
          'export const Fragment = r.Fragment;\n' +
          'export const jsx = r.jsx;\nexport const jsxs = r.jsxs;\nexport const jsxDEV = r.jsxDEV;\n',
        loader: 'js',
      }))
    },
  }
}

function loaderFor(path: string): ESBuild.Loader {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.ts')) return 'ts'
  if (path.endsWith('.jsx')) return 'jsx'
  if (path.endsWith('.json')) return 'json'
  return 'js'
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** Collapse `.` and `..` without a Node path module. A `..` that walks past the
 *  root simply cannot resolve, because nothing above the plugin folder is in
 *  the file map. */
function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** esbuild's failures carry structured errors with file and line; a plugin
 *  author (or the model that wrote the file) needs both. */
function formatBuildFailure(e: unknown): string {
  const errs = (e as { errors?: ESBuild.Message[] }).errors
  if (!errs || errs.length === 0) return message(e)
  return errs.map((m) => {
    const loc = m.location ? ` (${m.location.file}:${m.location.line}:${m.location.column})` : ''
    return `${m.text}${loc}`
  }).join('\n')
}
