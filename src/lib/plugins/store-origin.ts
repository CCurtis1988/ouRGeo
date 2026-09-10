// Where an installed plugin came from.
//
// Its own module, with no imports at all, because both halves of the app need
// it: the renderer's Plugin Manager and `electron/main/plugins.ts`. `types.ts`
// reaches into the layout model, the action types and the toolbox, so the main
// process cannot import from there without pulling most of the renderer into
// the node tsconfig — the same split `panel-meta.ts` and `panel-render.ts`
// already document.

/**
 * What the plugin store recorded when it installed a plugin.
 *
 * Written to `.ourgeo-store.json` inside the plugin folder — dot-prefixed, so
 * `plugins:listFiles` never reports it and it is not an input to the compile
 * hash. That file is AUTHORITATIVE: the export refusal and the "From the store"
 * badge both read it. `plugins.json` keeps a copy purely so the update poll can
 * run without a directory scan, which is what lets that file keep its promise
 * that deleting it "turns everything off and loses nothing else".
 *
 * It is a record, not a lock. The folder belongs to the user and deleting the
 * sidecar restores Export — see the note on protecting an author's code in
 * CLAUDE.md. ouRGeo declines to hand the code out; it does not pretend it
 * cannot be got at.
 */
export interface StoreOrigin {
  /** The plugin's slug in the store, which is also its manifest id. */
  slug: string
  /** The `plugin_versions` row this came from. */
  versionId: string
  version: string
  sha256: string
  installedAt: string
  name: string
  author?: string
}

/** The file the record above lives in, beside the manifest. */
export const STORE_ORIGIN_FILE = '.ourgeo-store.json'
