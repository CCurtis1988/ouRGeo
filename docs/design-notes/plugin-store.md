# The plugin store

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## The plugin store (v1.15)

A plugin had two ways to reach anybody: the assistant wrote it into the user's
own folder, or somebody sent them a `.ourgeoplugin` file. Both are private
exchanges. A plugin somebody spent a weekend on had nowhere to go, and a user
with a problem had nowhere to look.

The store is the third route — hosted on ourgeo.dev, browsable from the website
and from inside ouRGeo, **installable only from inside ouRGeo**. An author
submits; a moderator installs it, runs it, and approves or sends it back with a
note; approved versions appear. `electron/main/plugin-store.ts`,
`src/lib/plugin-store/`, `src/components/plugins/`, and — in the sibling
`ourgeo-website` repo — `db/schema-plugins.sql` and four pages.

### What "protecting the author's code" actually means

This has to be said the same way in the docs, the submit dialog and the code,
because the temptation to oversell it is the failure mode:

- What ships is a **built, minified bundle**. The author's TypeScript is never
  published.
- **Minifying is obfuscation, not encryption.** Plugin code runs in the
  renderer, so it must reach the user's disk in a form the loader can read.
- **Declarative contributions cannot be hidden at all.** Connectors, toolbox
  tools and actions are JSON in `ourgeo-plugin.json`, which the loader reads;
  R library files are read by R. Only `main` is compiled.
- Encrypting would need a key inside an AGPL binary, i.e. a published key. Cost
  with no protection; not built.

**The one real measure is the private bucket.** `plugin-bundles` is not public,
so a bundle is never on a URL the catalogue hands out, and downloading one needs
an account — enforced by a storage RLS policy (`can_download_bundle()`), not by
anything in this app. That is also why installing requires a sign-in while
browsing does not.

In the app, ouRGeo declines to hand the code on: no Export, no Files, and
`plugin:export`, `plugin:readFile`, `plugin:writeFile` and `plugin:inspect`'s
file listing all refuse. It is a decision, not a lock — the folder belongs to
the user, and deleting the sidecar restores Export. Every refusal names the
plugin's page, because a model told only "you cannot" works around it, and the
next thing it reaches for is `execute_r_code` and `readLines()`.

### The archive was already able to decide what runs

Found while building this, and fixed on its own (v1.15.1). `plugins:pack` used
adm-zip's `addLocalFolder`, which walks dotfiles, so the compile cache
`.build/<key>.js` went into a `.ourgeoplugin` and `plugins:unpack` restored it.
`runMain` keys that cache on `hashOf(JSON.stringify(files))` over the files
`plugins:listFiles` reports — and **that call skips dotfiles**. So an archive
could carry innocuous sources plus a cache entry under the key those sources
hash to, and the loader would run the cache entry without compiling anything. A
reviewer would have read code that never executed.

`lib/plugins/archive-policy.ts` is what an archive may contain now — pure,
tested, listed in `tsconfig.node.json` the way `terminal/shells.ts` is. Both
ends drop dot-paths; the traversal guard is a normalisation rather than
`includes('..')` (which refused `a..b.ts` and accepted `/etc/passwd`); size and
entry count are capped. `isDotPath` deliberately exempts `.` and `..`, or
`../../evil.js` would be a silent drop instead of the refusal it has to be.

### The artifact, and the one thing that must not be inlined

`bundleForDistribution` (`lib/plugins/compile.ts`) differs from the load-time
pass in three ways: `format: 'esm'`, `minify: true`, and **the host shims left
EXTERNAL**.

That last one is the decision with a long fuse. The shims inline `HOST_GLOBAL`,
`BUNDLE_GLOBAL` and the exact shape of the JSX bridge, all private to that file.
Inline them into a published artifact and every plugin in the store carries a
frozen copy of ouRGeo's internal ABI: rename `HOST_GLOBAL` and they all die at
once with `__ourgeo_host__ is not defined`, thrown inside `new Function` with a
stack pointing nowhere near the cause. Left external, `main.js` still says
`import { jsxs } from "ourgeo-jsx/jsx-runtime"` and the load-time pass hands it
whatever the shim means today. `format: 'esm'` is what makes that second pass
possible at all — it needs an entry module with a real export clause to
re-export `activate` from.

Use the `onResolve` hook, never the top-level `external:` array: a custom
resolver fires first and the array never gets a look-in. `legalComments: 'eof'`
rather than `'none'`, because stripping a licence header out of a file the
author vendored is a violation performed on their behalf.

`store-package.test.ts` runs the real compiler through both passes and executes
the result. It exists because "the minifier will not touch this identifier" is
exactly the kind of claim that turns out to be false one version later. The
build options are exported (`loadBuildOptions`, `distBuildOptions`) so it can:
esbuild-wasm's `wasmModule` path is browser-only, so a test going through
`loadEsbuild` could not run at all, and the options and the resolver plugins are
where the risk lives.

### A submission is two archives

`plugin.ourgeoplugin` is what a user downloads. `source.zip` is the author's
folder, readable by them and by staff and by nobody else.

**The source archive is not a courtesy.** A moderator asked to test and approve
a single minified line is performing theatre, and a review gate with no content
is worse than none, because it tells users a plugin was checked when it was not.

Both are staged in `.dist/<id>/` inside the plugins folder — dot-prefixed, so
nothing lists them and a staged build cannot be mistaken for an installed
plugin, and inside the folder so `contain()` still covers every path. They stay
on disk rather than crossing IPC as base64: the uploader is in the same process.

### Where the app's half lives

- **`electron/main/ourgeo-account.ts`** — extracted from `forum.ts`, because the
  account IS one account and two modules each holding a session would mean
  signing in twice for two features of one website. `rest()` gained an auth mode
  (`'optional'` sends the bearer only when there is one, which is what lets the
  catalogue answer a visitor and still tell a signed-in reader whether they have
  installed something); `friendly()` gained a subject, or a failed install would
  blame the forum.
- **`account:status`** is a pure disk check. The store dialog has to choose
  between "Install" and "Sign in to install" before it draws anything, and a
  full restore is a refresh grant plus a profile fetch.
- **`.ourgeo-store.json`** records where a plugin came from. Dot-prefixed, so
  `listFiles` never reports it, it is not an input to the compile hash, and an
  archive cannot forge one. It is the AUTHORITY; `plugins.json` keeps a copy for
  the update poll only, because that file's header promises deleting it "loses
  nothing else".
- **`installStoreArchive` refuses rather than replaces** when a folder of the
  same id is there and did not come from the store — unpacking deletes the
  target first, which is right for a reinstall and destructive for a plugin the
  user wrote. It also refuses when the archive's manifest id disagrees with the
  slug the store listed: those are the same field by design.
- **The download is checked against the length and sha256 the store recorded,
  before anything is unpacked.** Cheap, and the only thing between "the bucket
  was misconfigured" and "we installed it anyway".

### Updates are offered where you go to look at plugins

One batched call, once per session, on the first open of the Plugin Manager or
the store — not at startup. Startup spends a round trip on every launch for an
answer most launches do not need, and puts a message in front of someone who
opened ouRGeo to do something else. Memoised through the promise rather than a
boolean, because two dialogs can open in the same tick.

A **revoked** version is not an update and is not offered: approved, shipped,
then withdrawn, so it is switched off the moment we learn of it with a line in
the console saying why — the crash guard's shape in `loader.ts`. A dismissal is
keyed by version, so a later update is offered again: "not this one" is what a
person means.

### The server half (`ourgeo-website`)

`db/schema-plugins.sql`, applied third and **purely additive** — it re-declares
nothing from the earlier two files, so applying it once is enough and editing
them never obliges a re-run. That is why it does not write to `moderation_log`:
its `target_type` CHECK would have to be altered, and a re-run of `schema.sql`
would silently revert it, turning every approval into a constraint violation.

- **The primary key is the slug, and the slug is the manifest id.** One
  namespace, not two: the id already namespaces every contribution and is the
  folder name on disk, so two plugins sharing one would collide on the user's
  machine however the store numbered them. Claimed at submit, since the review
  page needs a row; a squatted name is answered by staff (`withdrawn` frees it).
- Counters move by delta from triggers inside `begin_internal()`, and
  `rating_avg` is a GENERATED column, so no client, trigger or SQL-editor
  session can write an average the reviews do not add up to.
- **Deleting an install row does not decrement.** An install happened;
  uninstalling does not un-happen it, and a count that went down would read as
  "how many people still have this", which this schema cannot know.
- Reviewing requires TL1, **and having installed it**, and not being the author.
  The middle gate is the point: a rating from somebody who never ran it is an
  opinion about the description.
- Four pages, built from the forum's own pieces. The website cannot build a
  submission — its CSP carries no `wasm-unsafe-eval`, so esbuild cannot run
  there — so `plugins-submit.html` reads a file ouRGeo made, with fflate.
  Decompressing is not eval.
- `image-upload.js` takes a target rather than growing a twin: the transcode
  half is the entire reason that file exists, and forking it to change a bucket
  name would duplicate the tricky part to vary the trivial one.

### Screenshots, and the ordering nobody could see

Attaching a picture is not one act but four — pick, resize, upload, record —
and the panel showed none of them. It opened `dialog:openFile`, whose filters
are `.R` and `.Rmd`, so a PNG was hidden behind "All Files"; it took one file;
it did the whole round trip with nothing on screen; and it then either grew a
64px thumbnail or wrote a sentence into an error box three scrolls down. An
author could not tell acceptance from refusal. That is the report this was
written from, and it is the only symptom the three faults below shared.

**The refusal was real, and it is about ordering rather than permission.**
`plugin_media.plugin_slug` references `plugins(slug)`, and that row is written
by `submit_plugin_version()` — so before a first submission there is genuinely
nowhere to put a picture, and `plugin_media_insert`'s `plugin_is_mine` gate
turns every upload into an RLS refusal. `friendly()` renders that as "your
account may not do it yet", which sends an author to check their trust level
for a problem that has nothing to do with it. So: `store:media` reports
`claimed`, the panel says what is true in those words, and screenshots picked
early are prepared, previewed, and uploaded by `flush()` the moment the
submission creates the row. The main-process handler still names the real cause
if an upload is somehow attempted early, because a message nobody can act on is
the thing being removed here.

- **Every file gets a row the moment it is chosen**, before any work — so
  choosing five files visibly produces five things. `planScreenshotAdd` is pure
  and splits a multi-selection into what will be added and what will not; a
  file dropped for being a PDF or for being the ninth is NAMED, with the
  reason. Nothing is dropped silently.
- **A row states which of the four steps it is on**, and "on your store page"
  is claimed for nothing else — `summarizeScreenshots` counts `waiting`
  separately for exactly that reason, and a test pins it. The thumbnail is the
  RESIZED image, with `952×488 · 53 KB (from 265 KB)` beside it, so "resized
  before upload" is visible rather than promised.
- **Uploads are sequential.** Five in parallel finish in an order nobody chose,
  and the order is not cosmetic: `sort_order` decides which screenshot becomes
  the catalogue card's `icon_path`. One at a time keeps it the order they were
  picked in, and "Make card picture" is a sort-order write and nothing else.
- **Remove means remove.** The old panel forgot a screenshot locally and left
  it on a public page. `store:deleteMedia` deletes the ROW first and the object
  second — the opposite order to uploading, and right for the same reason both
  times: a row pointing at bytes that are gone is a broken image on a public
  page, while an object with no row is invisible.
- **`store:media` restores the session before it asks.** With a stored-but-not-
  restored token the query goes out anonymously, and `plugins_read` hides an
  unpublished plugin from everyone but its owner — so an author's own pending
  submission would come back as "not in the store yet" and their screenshots
  would queue for a submission that had already happened. An expired sign-in is
  raised rather than answered around.
- **`apply` writes the ref inside the state updater** (`PluginScreenshots`).
  The upload loop patches a row and reads it back in the same tick, and a ref
  refreshed on render would hand it the row as it was before the patch — a
  screenshot just prepared would read as having no bytes and be skipped in
  silence. Same class as `useGeometryCommit`, in its upload-queue form; there
  is deliberately no render-time assignment, or an unrelated re-render would
  roll the ref back.

`MAX_SCREENSHOTS` is ouRGeo's own limit, not the server's — `plugin_media` caps
nothing per plugin — so it is worded as ouRGeo's wherever it bites.

### The assistant

`store:search / inspect / updates / open` are `always`; `store:install` and
`store:update` are **`confirm`**, the same tier as `plugin:enable`. What
installs arrives switched off, and there is no action that enables it — the
assistant cannot install and turn on in one breath.

**Never exposed:** submitting a plugin and writing a review, both of which
publish under the user's name to a public site; and approving anything, because
an assistant that could approve a plugin could approve one it had written. A
test asserts all three, so adding one would be noticed.
