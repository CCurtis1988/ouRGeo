# Markdown & R Markdown

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Markdown & R Markdown (v1.9)

`.md` / `.Rmd` / `.qmd` are first-class documents in the code editor.

**Language is a FIELD on the tab, not a `TabType`** (`TabState.language`,
`src/lib/markdown/doc-kind.ts`). `TabType` selects which component renders and
gates the four `t.type === 'code'` predicates that decide what persists
(`session-persistence.ts:24,37`, `editor.ts`); a `'markdown'` TabType would have
been silently dropped from `session.json`. Tabs written before this feature carry
no `language` and default to `'r'`.

- **Grammar** (`rmarkdown-monarch.ts`): Monaco's stock markdown Monarch ships
  already, but its GFM fence rule needs a word character after the backticks, so
  it matches neither fence rule on ```` ```{r label} ````. The result is worse
  than a miss: the *closing* fence is read as an *opening* code block and the
  rest of the document inverts. The derived `rmarkdown` language adds one
  brace-aware rule with `nextEmbedded`, so chunk bodies highlight as R. Pinned by
  `rmarkdown-tokenize.test.ts`, which runs Monaco's real tokenizer. Because this
  imports Monaco's internals (`monaco-editor/esm/vs/basic-languages/markdown/`),
  `monaco-editor` is a **direct, exactly-pinned** dependency rather than whatever
  `@monaco-editor/react` happens to hoist.
- **Actions** (`markdown/actions.ts`): one declarative catalog → three consumers.
  `apply-source.ts` is a pure `computeMdEdit(text, selStart, selEnd, action)`, so
  every wrap/unwrap toggle and list-renumbering rule is testable with no DOM;
  `MarkdownRibbon` is a thin Monaco adapter over it (`executeEdits`, never
  `applyExternalContent` — that does a whole-model `setValue` and destroys the
  cursor and undo stack). Ribbon primitives live in `src/components/ui/ribbon.tsx`.
- **Two escapes from "data-only"**, both injected rather than imported, so the
  catalog and `apply-source.ts` still test with no app running:
  - `prompt` — values the editor can't infer. Link and footnote are the only
    users, and both were previously inserted with the caret marker still in the
    text (a bare `[^]`). `MdPromptDialog` collects them; `applyPromptValues`
    folds them into a concrete source op. The host recognises these by candidate
    id so `/link` opens the same dialog the ribbon button does.
  - `dynamic` — a body generated from live app state, via the
    `ChunkBodyGenerator` passed to `resolveActionBody`. Generated bodies are
    marked `literal`, which skips `$N` snippet expansion: R code containing a
    `$`-digit sequence would otherwise be silently corrupted.
- **Slash menu**: `getCompletions(text, offset, deps, mode = 'r')`. The mode is
  **defaulted**, which is what structurally stops the shared R console
  (`Console.tsx:274`) from ever seeing markdown candidates — locked by a
  regression test asserting the no-argument call is byte-identical. `/` opens the
  popup via `CompletionResult.autoOpen`, **not** by widening the `structural`
  regex in `useCompletion.ts` (adding `/` there would pop the menu on `a/b`).
  Inside a chunk, `context-markdown.ts` slices the body and delegates to the R
  analyzer with shifted offsets, giving full R autocomplete in chunks.

  Three surfaces, one catalog, ranked by one function (`markdownSlashMenu`):

  | where | how it opens | what accepting does |
  |---|---|---|
  | Source, empty caret | the analyzer sees `/` in the text | replaces the typed `/query` with the action's text |
  | Source, over a selection | Monaco `onKeyDown` swallows the `/` | hands the action to the ribbon backend, which wraps/prefixes the selection |
  | Visual (both) | `visual/slash.ts`, a ProseMirror plugin | `applyVisualAction`, same as the ribbon button |

  Rows carry the catalog's own lucide icon (`CompletionCandidate.icon`), tinted
  per group by `GROUP_TINT`, so a `/` row and its ribbon button show the same
  picture. R candidates keep the typographic glyphs from `icons.ts`.

  **Over a selection the `/` never reaches the document** — typing it would
  replace the selected lines, which is the opposite of the request. Because
  nothing can be typed, the keystrokes that would filter the list are
  intercepted and accumulated instead (`slashOverSelection` in `CodeEditor`, the
  selection branch of `handleKeyDown` in `slash.ts`). In Visual mode the plugin
  detects the typed `/` in its `view().update` rather than in `handleKeyDown`,
  so the character the user sees and the range deleted on accept always agree.

### Map chunks (`markdown/chunk-codegen.ts`)

"Chunk: current map" and "Chunk: export current plot" generate real R from the
layers, symbology, view and annotations currently on the map, by calling the same
`generateTmapCode` / `generateGgplotCode` the Spatial Editor's Export dialogs
call — a map written into a document and a map exported from the dialog are the
same code. With nothing on the map the generator returns null and the action
falls back to its static scaffolding.

- `buildMapChunkParts` returns the header and code **separately** because Visual
  mode builds a ProseMirror `code_block`, not a string of fences.
- The engine is `useMarkdownSettingsStore.mapChunkEngine` (Settings → Documents,
  persisted in `markdown-settings.json`): `tmap` (default), `ggplot`, or `auto`,
  which follows `spatialSettings.lastExportMode` — whichever Export dialog the
  user opened last.
- The figure variant reuses each generator's `exportOpts` to emit its own save
  call, and its chunk is `include=FALSE`: it exists to WRITE the file that the
  following `![](figures/…)` references, so letting it also render inline would
  put the same figure in the knitted document twice.

### Chunks and inline output

- **Identity** (`chunk-identity.ts`) is the crux. Not a content hash (throws
  output away on every keystroke) and not an index (insertion shifts everything):
  an explicit label is the key — knitr already requires uniqueness — then exact
  code match, then a positional pass, then a uuid. The ribbon auto-labels chunks
  it creates, so almost everything takes the label path. **Invariant: editing a
  chunk preserves its id and marks the output `stale`, never drops it.**
- **Execution** (`r/lib/handlers-rmarkdown.R`): a separate endpoint because
  `/r/execute` points the default device at a single fixed-name PNG
  (`server.R:33-37`) and does one `recordPlot()` — a chunk drawing three plots
  loses two, and broadcast plots carry no caller attribution. Verified: a
  fixed-name device yields 1 file, `png("…%03d.png")` yields 3.
- **Rendering** (`chunks/monacoChunkLayer.ts`): decorations for chunk chrome, a
  **content** widget for `[▶]` (scrolls with the text; overlay widgets are
  viewport-fixed and CodeLens would need a language service this repo has none
  of), and view zones for output with `heightInPx` (`heightInLines` is wrong
  under `wordWrap: 'on'`). React mounts via `createPortal` from the CodeEditor
  tree, not a per-zone `createRoot`, so context survives. The `ResizeObserver`
  watches an **inner** wrapper — observing the zone's own node makes the height
  you set feed back into the measurement.
- **Zones belong to the EDITOR, not the model.** There is one editor and tabs
  swap via `setModel()`, so `chunkLayer.detach()` runs *before* the swap or the
  previous tab's outputs float inside this tab's text.
- Outputs live in `src/store/chunks.ts`, deliberately **not** on `TabState` —
  they hold base64 PNGs and would otherwise be serialized into `session.json`
  and every `.ourgeoproj`.

### Knit

`electron/main/knit.ts` spawns a child `Rscript` rather than using the R server:
knitr's contract is a clean session (catching "works in my console, fails on
knit"), a render can take minutes and the server is serial, and a child can be
killed. `GET /rmarkdown/deps` drives `knit-deps.ts` so each format is
**pre-disabled with a specific reason** before the user clicks — the common
failure is missing pandoc, which is not an R package. `knit-errors.ts` turns
knitr's output into a hint and a line number to jump to.

### Publish to the forum (`src/lib/forum/`, `electron/main/forum.ts`)

The Publish button beside Knit knits an `.Rmd` to markdown and posts it to
ourgeo.dev/forum.html as a new discussion.

**The forum is a static site on Supabase**, not an API: a post is an insert into
`threads`, figures go to the `post-images` storage bucket with a row in
`post_attachments`, bound to the thread afterwards by `link_attachments()`. The
schema lives in the separate `ourgeo-website` repo, and every gate — trust
level, quota, per-post image cap, category role — is a Postgres trigger or RLS
policy whose refusal message IS the user-facing sentence.

- **Markdown, never HTML.** The forum's renderer HTML-escapes everything before
  emitting a tag, so a knitted HTML document would render as literal markup;
  bodies are capped at 12,000 characters where self-contained HTML is hundreds
  of KB; and `data:` image URIs are rejected outright. Markdown is not a
  preference here, it is the only thing that works.
- **All of it runs in the main process.** The access token never reaches the
  renderer, so a bug in the UI cannot post as the user. The renderer only
  transcodes pixels (it has a canvas; main does not) and asks for named
  operations.
- **Auth is PKCE with a loopback redirect** on 127.0.0.1:8788–8790, which is
  what lets one flow cover all three sign-in methods: google/github through
  `/auth/v1/authorize` in the real browser, email through `/auth/v1/otp` as a
  magic link that lands on the same loopback. The verifier stays in the main
  process. **The ports must be listed in Supabase → Authentication → URL
  Configuration → Redirect URLs**, or the browser round trip dead-ends.
- The refresh token is stored with Electron `safeStorage` (`forum-session.bin`),
  not the plaintext `api-keys.json` convention — unlike an API key it grants the
  ability to post as the user. With no OS keyring available nothing is stored
  and the user signs in again next launch.
- **Figures upload before the thread is created.** A document whose images are
  refused then fails with nothing published; the other order would leave a
  public post missing half its figures and no way to fix it from the app.

`publish-markdown.ts` is a pure transform bridging pandoc's output to the
forum's small vocabulary, and each rule exists because of something real in the
renderer: indented chunk output becomes fenced (there is no indented-code rule,
so a printed data frame would arrive as prose), ``` ``` r ``` becomes ``` ```r ```
(the fence regex needs no space, or a stray `r` lands on the first code line),
pipe tables become aligned text in a fence (there is no table rule at all), and
raw HTML is dropped. Pinned by tests against a fixture captured from a real
`rmarkdown::render()` run.

### Visual mode

Milkdown (ProseMirror + remark). remark was already in the tree via `remark-gfm`,
so the parser driving Visual mode is the same one driving the round-trip checker —
with Tiptap or Lexical, a second markdown implementation would put a permanent
bug class on the Source↔Visual seam. Every Milkdown import is confined to
`src/components/editor/visual/` behind `VisualEditorHandle`.

- **The text always owns the truth**; Visual is a projection. It *replaces* the
  editor rather than splitting, so only one is mounted and there is no sync loop.
- **Front matter never enters ProseMirror** (`front-matter.ts`) — remark would
  read `---` as a thematic break and destroy it.
- **The switch is gated** on `roundtrip.ts`, which checks idempotence at the
  second pass plus structural equality and flags raw HTML with line numbers. The
  invariant is idempotence, never byte preservation — the first pass may
  normalise formatting.
- **A no-edit toggle is byte-identical**: entering records a baseline; if the
  serialization is unchanged on exit, the *original* text is written back, so
  looking at Visual mode never reformats the file or marks it dirty. Write-back
  uses `pushEditOperations`, not `setValue`, so Monaco's undo survives.
- **Exit serializes the live doc** (`getMarkdown()` action), never the value from
  the `markdownUpdated` listener — that listener is **debounced by 200 ms**
  inside Milkdown, so a snapshot from it silently drops whatever was typed in the
  last fifth of a second, which in practice is every edit made just before
  clicking "Source".
- `joinFrontMatter` restores the blank line after the front matter: no markdown
  serializer emits a leading blank line, so without it every trip through Visual
  mode would shift the document up by one.
- **Escapes are minimised at the serialization boundary** (`escapes.ts`).
  remark-stringify escapes defensively: every `_`, `*` and `~` in a text node
  comes back with a backslash, so a document that merely *visited* Visual mode
  returned with `geom\_line()` where the author wrote `geom_line()` — which in
  an R Markdown document is the difference between prose and nonsense.
  `minimizeEscapes` removes an escape only when the document still parses to the
  same tree without it, so `geom_line()` loses its backslashes (intraword `_` is
  not emphasis) while `x\*y\*z` keeps them (unescaped it becomes emphasis).
  Candidates are grouped by line and character and accepted whole, because
  dropping one half of `\_id\_` leaves `\_id_` — same meaning today, a trap
  tomorrow. It runs inside `normalize()`, not just at the Visual boundary: the
  mode switch compares against that baseline, so a baseline that still carried
  the escapes would make a look-and-leave toggle rewrite the file.
- **Position survives the switch** (`doc-position.ts` + `visual/anchor.ts`).
  There is no exact correspondence between a markdown offset and a ProseMirror
  position — `**bold**` is eight characters in one and four in the other — so
  the anchor is *top-level block index + alphanumerics into it*. Markdown syntax
  is punctuation, so counting alphanumerics skips exactly the characters that
  exist in one representation and not the other. Exact between blocks,
  approximate within one, which is the right trade for landing the reader on the
  paragraph they were reading. `contentStartOf` descends to the first positioned
  leaf so `# `, `- ` and a chunk's ```` ```{r label} ```` header don't count.

  **Two anchors travel, and they are independent.** The VIEW anchor drives
  scrolling and is read from the viewport — Monaco's
  `getVisibleRanges()[0].startLineNumber`, and in Visual the first top-level
  block whose rect bottom is below the pane top (with the fraction scrolled past
  mapped onto its character count, so a long chunk resumes mid-way). It is
  restored to the TOP of the destination viewport, because that is where it was
  measured from. Following the caret instead would land the reader wherever the
  cursor happened to be left, which after any scrolling is not what they are
  looking at.

  The CARET anchor is carried separately and **written back only when the reader
  moved it**: `entryCaret` is recorded on the way in and compared on the way
  out. A mode toggle is not an edit, so an unchanged caret is left exactly where
  it is rather than re-derived from an anchor — the anchor is exact to the
  alphanumeric, not to the byte, so round-tripping an untouched cursor would
  nudge it for no reason. Hence `setCaretAtAnchor` and `scrollAnchorToTop` are
  separate calls; ProseMirror's `scrollIntoView()` flag could not be used for
  the second even in principle, because it needs a transaction and therefore a
  selection change.

  Both restores scroll by hand. Visual: two frames after `create()`, because the
  pane's scroll height is still settling and ProseMirror's `scrollIntoView()`
  flag no-ops on a box that has not finished growing. Source: two frames plus an
  explicit `editor.layout()`, because Monaco spends Visual mode inside a
  `display:none` wrapper and has no width until React unhides it — and with
  `wordWrap: 'on'` line heights depend on width, so scrolling before that
  relayout computes tops for a zero-width editor.
- Known gaps: `$…$` math renders as literal text; **footnotes have no node in
  Milkdown's commonmark+gfm schema**, so the ribbon dims them in Visual mode
  (`VISUAL_UNSUPPORTED`) and `roundtrip.ts` flags them as unsupported. That flag
  matters because remark round-trips footnotes *perfectly* — a remark-only check
  sees no loss, while ProseMirror would drop them.

#### Chunks in Visual mode (`visual/chunk-view.ts`)

- **Options survive the round trip.** mdast splits ```` ```{r a, echo=FALSE} ````
  into `lang: "{r"` + `meta: "a, echo=FALSE}"`, and Milkdown's stock code_block
  keeps only `lang` — so everything after the first space was DROPPED on the way
  back to markdown, a silent edit to the user's document just for looking at it.
  `chunkAwareCodeBlock` (`codeBlockSchema.extendSchema`) carries `meta` both ways.
- **Upgrade on focus, per the plan.** Each chunk holds two stacked layers: a
  read-only hljs-highlighted `<pre>` and the real editable `contentDOM`. CSS
  shows one at a time, driven by the `is-active` class that `activeChunkPlugin`
  puts on whichever code block holds the selection. No per-chunk editor is
  constructed, so a 50-chunk document stays cheap.
- Clicking the read-only layer maps the point back to a character offset with a
  **Range from the layer's start to the hit point** — a click in the `<pre>`'s
  padding resolves to the ELEMENT, not a text node, so walking text nodes would
  land every such click at the end of the chunk.
- Output is keyed the same way `chunk-identity.ts` keys it (`label:<label>`), so
  a chunk run in Source mode still shows its output in Visual and back, and Run
  goes through the same `runChunkCode` path.
