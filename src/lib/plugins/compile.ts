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

  const virtual: ESBuild.Plugin = {
    name: 'ourgeo-plugin-files',
    setup(b) {
      // `import ... from 'ourgeo'` is the host API. It becomes a one-line
      // module re-exporting the sandbox's parameter, so a plugin can use a
      // normal import instead of reaching for a global.
      b.onResolve({ filter: /^ourgeo$/ }, () => ({ path: 'ourgeo', namespace: 'ourgeo-host' }))
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

  try {
    const out = await build.build({
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
      plugins: [jsxRuntimeShim(), virtual],
      logLevel: 'silent',
    })
    const code = out.outputFiles?.[0]?.text
    if (!code) return { ok: false, error: 'The compiler produced no output.' }
    return { ok: true, code }
  } catch (e) {
    return { ok: false, error: formatBuildFailure(e) }
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
