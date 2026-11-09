# Plugins

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Plugins (v1.11)

ouRGeo cannot be edited in place once installed: the renderer ships as one
minified bundle inside a read-only asar (AppImage is squashfs; deb/nsis are
root-owned), and `typescript`, `vite` and `esbuild` are devDependencies that
never ship. Changing ouRGeo itself will always mean cloning and building.

A **plugin** is the other route — capabilities added while the app runs. It was
unusually cheap to build because every blocker was already absent: the CSP in
`src/index.html` already permits `script-src 'unsafe-eval' blob:`; every
extension point is already a data object plus one function; and
`custom-themes.ts` was already a working "seed a mutable registry, validate each
user entry, drop the bad ones, never let a user id shadow a shipped one" loader.

### Three kinds, in order of preference

1. **Declarative JSON** — connectors, toolbox tools, actions, toolbar buttons,
   docs topics. No code, so no trust decision, and a model writing JSON against
   a schema succeeds far more often than one writing JS against a remembered API.
2. **R** — files `source()`d into the live session, echoed to the console.
3. **Code** — `main.ts`, compiled at load. The exception, not the default.

Themes and saved layouts are deliberately NOT contributable: both already have
an import path a plugin gains nothing over, and both would need an answer to
"what happens to the user's own when the plugin is removed" that neither
registry is built to give.

### The pieces

- `lib/plugins/manifest.ts` — validation, following `classifyThemeFile`: a
  refusal names the FIELD and the way out; one bad contribution is dropped
  rather than the whole plugin; a `manifestVersion` from the future is refused
  rather than half-read.
- `lib/plugins/compile.ts` — **`esbuild-wasm`**, in `dependencies` (13 MB), and
  the only new dependency. Loaded by dynamic `import()` so it costs nothing at
  startup, and its wasm arrives via `plugins:esbuildWasm` IPC as base64 — a
  `fetch` of a sibling file from a `file://` page under `default-src 'self'` is
  blocked, silently. Output is an **IIFE with a `globalName`**, not an ES
  module: the sandbox runs it inside `new Function`, which needs a statement
  list. There is no filesystem in the browser build, so imports resolve from
  the file map read over IPC — which is also the containment. Bundles cache to
  `<plugin>/.build/<hash>.js`.
- `lib/plugins/sandbox.ts` — a **soft** sandbox: the bundle runs in a function
  whose parameters shadow `electronAPI`, `require`, `process`, `fetch`,
  `localStorage` and friends. It stops accidents and casual reach-arounds, not
  intent — `({}).constructor.constructor` walks straight out, and only a Worker
  or a cross-origin frame would change that, neither of which can touch the DOM.
  The real control is **consent**, and the docs say so in those words rather
  than implying a safety this does not provide.
- `lib/plugins/host-api.tsx` — one frozen `ctx`. The renderer has no filesystem
  or `electronAPI`. R operations remain visible in the console. A declared
  `service` permission grants native system access to a separate installed entry. Permissions gate by ABSENCE: without `network` there is no
  `ctx.http`, because a method that exists and always refuses is one a model
  keeps calling. Frozen shallowly per namespace — the first version deep-froze
  and walked into React's module namespace, freezing the mutable `current` refs
  and killing the renderer with an error pointing nowhere near here.
- `lib/plugins/loader.ts` — read, compile, run, then register EVERYTHING in one
  pass and bump the revision once (the registries replace their plugin half
  wholesale, so a partial pass drops the plugins already loaded). Reloading
  everything rather than diffing is deliberate: a plugin contributes to six
  registries, and a correct incremental update would cost more than a reload.
- **The crash guard.** The plugin's id is written to `plugins.json` BEFORE
  `activate` and cleared after. Finding it there at startup means that plugin
  took the app down; ouRGeo disables it, skips every plugin this launch, and
  says so. Without it, one bad plugin means an app that dies on launch and a
  Plugin Manager that can only be reached from inside the app that dies.
- `electron/main/plugins.ts` — `plugins:*` IPC. These exist rather than reusing
  `file:read`/`file:write` for one reason: **every path is confined to the
  plugins directory**. Plugin authoring is something the assistant does on the
  user's behalf, and `file:write` takes an unchecked absolute path.
- `lib/plugins/archive-policy.ts` — what a `.ourgeoplugin` may contain. Pure and
  tested, listed in `tsconfig.node.json` so `plugins.ts` compiles against it,
  the arrangement `terminal/shells.ts` already has with `terminal.ts`.

### Managed plugin services (v1.16.0)

Media playback needs native codecs without a terminal or a pairing screen.
`service: {entry, files}` declares the native JavaScript entry and all its text
assets; the `service` permission explicitly grants native system access.
`electron/main/plugin-services.ts` rechecks enabled state and real paths before
forking an Electron utility process. The child sends `{type: 'ready', connection:
{url, token}}` through `process.parentPort`; the host accepts only a private
loopback URL and a strong session token. The child must handle `{type: 'stop'}`.
`OURGEO_PLUGIN_DATA` identifies persistent data outside the replaceable plugin
folder. Starts are deduplicated; disabling, renderer loss and quitting stop the
service, with a bounded graceful shutdown. This is process isolation, not an OS
sandbox. Store packages preserve every declared service asset verbatim.

Panel renderers are mounted as React components in `PanelContent`, with an error
boundary per panel. Calling a plugin renderer directly in Zone's map attached
its hooks to Zone and crashed when the plugin was enabled. Plugin callbacks
should return an element; the host also enforces the component boundary.

### What an archive is allowed to contain

A `.ourgeoplugin` used to arrive from the user's own machine — someone sent you
a file and you chose to open it. Three things about the import were only safe
under that assumption, and the one that matters is not a hardening detail, it
is a way for an archive to decide what runs:

- **The compile cache travelled inside the archive.** `plugins:pack` used
  adm-zip's `addLocalFolder`, which walks dotfiles, so `.build/<key>.js` went
  in; `plugins:unpack` restored it. `runMain` then keys the cache on
  `hashOf(JSON.stringify(files))` over the files `plugins:listFiles` reports —
  and that call SKIPS dotfiles — so an archive could carry innocuous sources
  plus a cache entry under the key those sources hash to, and the loader would
  run the cache entry **without compiling anything**. A reviewer would have read
  code that never executed. Dot-prefixed paths are now dropped at both ends,
  which also means an archive cannot forge the store's `.ourgeo-store.json`.
- **The traversal guard was `entryName.includes('..')`** — a substring test that
  refuses the innocent `a..b.ts` and accepts the absolute `/etc/passwd`. It is
  now a normalisation that can express neither, and `isDotPath` deliberately
  exempts `.` and `..`: counting them would turn `../../evil.js` into a silent
  drop rather than the refusal it has to be.
- **There was no ceiling**, so an archive that unpacked to a full disk was a
  supported input. Entry count and total unpacked size are capped, and each
  refusal says the reading it is actually pointing at — that you picked the
  wrong file.

`unpackArchive` is exported because the plugin store installs through it: one
place decides what an archive may contain, so a hostile one cannot be made
acceptable by arriving through the other door. Every entry is decompressed
before anything is deleted, or a failure halfway would leave the user with
neither the old plugin nor the new one.

### The registries went live

`ALL_ACTIONS` → `actionList()`, `API_PROVIDERS` → `providerList()`,
`CATEGORIES` → `categoryList()`, `OURGEO_TOPICS` → live, plus the panel and
toolbar registries. Same contract as `THEMES`: one writer, object identity never
changes, React subscribes to `usePluginStore.revision` instead. `GroupId` gained
`plugin.${string}`, and `GROUP_LABELS` became a live map whose insertion order
is what the model reads — shipped groups always first.

### Declarative connectors (`api-connectors/declarative.ts`)

`compileProvider(spec)` builds a real `ApiProvider` from JSON. Comparing the
fourteen shipped providers was the argument: outside the OGC XML trio they are
the same program — fetch JSON, read a path out of it, serialise the shared
`Query` into one of five dialects, emit an R one-liner. `DIALECTS` holds those
five (`odata`, `cql`, `esri`, `soql`, `params`) as tables of per-operator
templates; a test asserts the `odata` table reproduces the hand-written
`buildODataFilter` byte for byte across seven filter shapes, and that a spec for
the shipped OData provider generates identical R. `{x}` is URL-encoded and
`{{x}}` is raw — a cascade id in a path and a filter clause in a query string
need opposite treatment — and a query parameter whose value comes out empty is
dropped, because `&$filter=` is not the same request as no filter.

**What it deliberately cannot express**, and the docs say so, so a model does
not spend three turns trying: XML capabilities documents (WFS/WMS/WCS negotiate
versions by probing), adaptive probing (Esri's halving page size), and
cross-request derivation (extent reprojection, STAC asset discovery). Those
register a provider from code.

### The AI surface

`plugin:*` (list, inspect, readFile, scaffold, writeFile, validate, reload,
enable, disable, delete, export, import) and `connector:*` (list, inspect, open,
addServer, removeServer, probe, test).

- **`plugin:enable` is `confirm` and that is the whole trust model.** Writing a
  plugin changes nothing; enabling one is when code starts running.
  `plugin:disable` is `always` — switching something off is never the risky
  direction, and it is the first thing to try when the app misbehaves.
- **`plugin:writeFile` validates a manifest before writing it.** A saved broken
  manifest cannot be read back, which would cost the assistant the ability to
  fix its own mistake through `plugin:readFile`.
- **`connector:probe` and `connector:test` are the difference** between a model
  that can write a connector and one that writes a working one. A wrong
  `itemsPath` compiles, installs, and produces an empty dropdown with nothing on
  screen to explain it; probe reports the JSON's shape, and test walks the
  cascade against a real server and says which stage failed.
- Docs live in `ourgeo_docs`: `extending`, `plugin-connectors`, `plugin-tools`,
  `plugin-code`, `layout`. The `extending` skill's catalog line tells the model
  plugins exist at all (`buildOurgeoCore()`, which once said so, ships nowhere). The core
  budget moved 6000 → 7000 chars for those plus 23 new action ids; it is a
  budget to defend, not a number to nudge.
- A test walks every topic for `group:action` tokens and asserts they resolve.
  It found `ui:listThemes` in the `interface` topic on its first run — an action
  that has never existed.
