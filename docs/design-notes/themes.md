# Themes

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Themes

Three independent axes, all in `theme.json` and all on `useThemeStore`.
The painted app themes keep their existing ids; `legacy-<id>` variants preserve
original interface palettes, generated SVG scenes and syntax defaults. Appearance
and the Theme Studio keep these in a Legacy themes section collapsed by default.
Legacy variants carry their original `basedOn` scene/basemap identity. Heaven's
painted backdrop uses 30% opacity with slightly softened contrast/saturation so
clouds and architecture remain visible against its light editor surface.

- **App theme** (`src/lib/themes.ts`, ten painted themes, thirteen Field themes and ten legacy variants) owns the interface:
  the `--geo-*` custom properties, the basemap, the scene art, and — crucially —
  the editor's `colors` block.
- **Code theme** and **markdown theme** (`src/lib/editor-themes.ts`, 39 and 29)
  own token colours and nothing else. **Switching either can never move the
  editor background or the artwork behind it** — the palettes carry no
  background at all, `buildMonacoTheme` reads its `colors` block only from the
  app theme, and `editor-themes.test.ts` asserts the two are independent.
  Switching the *app* theme resets both to that theme's defaults; each app theme
  ports its own former syntax colours forward as a code and markdown theme of
  the same id, so the out-of-the-box look is unchanged.

**One Monaco theme carries both palettes.** Monarch appends `tokenPostfix` to
every token — `.r` for R, `.md` for markdown and for the derived `rmarkdown`
grammar — and `TokenTheme.match` ignores the language id, so that postfix is the
only thing separating an R `keyword` from a heading. It is enough: `bare` rules
are the code palette (which is also how *chunks follow the code theme* — every
embedded language falls through to them) and `.md` rules are the markdown
palette. One name, `EDITOR_MONACO_THEME`, redefined on change; `defineTheme`
re-applies a live theme, so nothing swaps on tab change.

**The postfix is a suffix, not a namespace.** Monaco's trie walks dot segments
from the head and falls back to the nearest ancestor, so
`keyword.table.header.md` resolves keyword→table→header and *never reaches*
`keyword.md`. Every multi-segment markdown token needs its own full-path rule; a
forgotten one silently paints one prose construct with a code colour.
`editor-themes-tokens.test.ts` runs Monaco's real tokenizer over an `.Rmd`
fixture and resolves all 32 emitted tokens through a faithful re-implementation
of that trie — it is the only thing that catches this class of bug.

Two consequences worth knowing:

- **Markdown body prose is not targetable in Monaco.** Both grammars set
  `defaultToken: ''`, and Monaco turns `editor.foreground` into the `''` rule
  ahead of ours. `MarkdownPalette.text` therefore drives Visual mode and the
  picker preview only.
- **`inherit: true` leaks the base theme's rules** into `.Rmd` html/sql/yaml
  chunks, so `buildMonacoTheme` restates every one of them from the code
  palette. It also takes the base's `rules` array *by reference* and pushes onto
  it on each resolve — which is why the redefine effect's deps are exactly
  `[themeId, codeThemeId, markdownThemeId, revision]` and must stay that way.
  `revision` (on `useThemeStore`) is the fourth only because the Theme Studio
  commits on a debounce: it moves once per pause, not once per drag.

**Non-Monaco surfaces** follow through CSS custom properties (`--ourgeo-code-*`,
`--ourgeo-md-*`, written by `applyEditorTheme` beside `applyTheme`, with `:root`
defaults in `globals.css` because an undefined custom property invalidates the
whole declaration rather than falling back). They drive the `.hljs-*` rules that
replaced the hard-coded `highlight.js/styles/github-dark.css` import — so
Visual-mode chunk highlighting and the AI chat's code blocks now follow the code
theme instead of being GitHub-dark under every app theme — and the
`.ourgeo-visual .ProseMirror` heading/link/quote/inline-code colours. Chunk
chrome (`.ourgeo-chunk-*`, `.ourgeo-vchunk-{head,run,out}`) deliberately stays on
`--geo-*`: it is chrome, not syntax.

### Background galleries and linked image folders

**Field collection** adds all thirteen `ourgeo-website` palettes under stable
`field-<slug>` IDs. Names and website hues stay recognisable; the prefix keeps
the existing Forest and its saved backgrounds intact. `field-themes.ts` holds
the palette and syntax adaptations: website colours are raised/darkened only
where contrast needs it, including the worst white/black pixel under the
editor's 18%/35% dark/light Field photo layer. Primary filled controls need the website's dark
ink on dark-theme accents; Field-derived `--geo-on-accent`, hover and error
ink rules adapt older `text-white` controls without recolouring existing themes.
`applyTheme` derives contrast from the current fills, follows `basedOn` for
Studio copies, and clears that treatment when leaving the family. Membership
and inherited ink are separate: copies remain in the custom collection.
Colour maths lives in the dependency-free `theme-colors.ts`, re-exported by
`custom-themes.ts`, so applying colours cannot import the Studio/registry cycle.
Eight dark themes and five light
themes each have their own matching code/Markdown defaults and basemap.

Field artwork is six distinct photographic nature scenes per theme, with
1600 × 900 WebP originals and 320 × 180 thumbnails. Full prompts/provenance
live in `gallery/field-prompts.json`; `field-theme-scenes.ts` supplies their
titles. These galleries have no bundled animation: the user will render those
later. Gallery base resolution includes every shipped non-legacy theme, so a
Field theme or its custom derivative cannot silently inherit Dark's paintings
and GIF. The picker uses bundled thumbnails and four keyboard-accessible
collection tabs: Illustrated, Legacy, Field collection and Custom. It follows
theme switches from the assistant; Studio uses matching collapsible groups. Code/Markdown labels append
“· Field” to distinguish palettes with names such as Forest.

**Settings → Appearance → Background images…** opens a sibling dialog through
`ui.ts`, like Theme Studio: nesting it inside Settings would put a second Radix
focus trap under Settings' own. Selections apply immediately and belong to the
current app theme. At least one image remains selected; two or more start a
slideshow in selection order, with a per-theme 5–3,600 second interval.

- `theme-backgrounds.ts` enumerates the authored original, five additional
  paintings and the original's ambient GIF. URL-only Vite imports keep the
  gallery available offline without decoding it all. Smaller bundled
  thumbnails and a shared IntersectionObserver defer offscreen image work.
  Legacy/custom themes retain their own original and offer their base theme's
  gallery as extras; parent cycles fall back to Dark. User selection never
  mutates shipped theme definitions, Theme Studio artwork or picker icons.
- `store/theme-backgrounds.ts` owns selections/timing in the separate,
  device-local `theme-backgrounds.json`. Strict parsing and read-back after
  the shared serialised writer distinguish a failed save from a remembered
  choice. A damaged file has an explicit reset path instead of silently
  pretending the defaults were the user's choices.
- `theme-background-playback.ts` owns one workspace clock. Editor mounts
  subscribe to the same current/previous frames, so changing tabs or splitting
  panes cannot restart or desynchronise the slideshow. Only current/next
  selected images preload; a 650 ms crossfade holds at most two displayed
  layers. Visibility pauses automatic changes; reduced motion also replaces
  GIFs with first-frame posters. Async bitmap decoding supplies posters for
  linked/custom animations without mounting an animating thumbnail. All linked
  photos also get 480-pixel thumbnails through the same two-job decode queue;
  CSS sizing alone still decoded every 24 MP original at full size. JPEGs use
  their decoder's EXIF orientation before canvas sizing. Other validated raster
  dimensions can be resized at decode time. Thumbnail/poster caches stay
  separate, and revoked sources cannot recreate URLs after cancellation.
- `electron/main/theme-backgrounds/` holds image-folder capabilities, separate
  from project/context grants. Main owns native pickers, canonical roots and
  atomic rollback-capable persistence in `theme-background-folders.json`.
  Dedicated `ourgeo-theme-image:` URLs contain opaque IDs, never paths.
  Requests recheck root/file identity, containment, single-link regular files,
  byte limits and raster headers. No SVG/HTML, symlink or hard-link imports.
  Header checks cap images at 8 MiB/24 MP; scans are bounded to 200 images,
  2,000 entries, 100 subdirectories, six levels and 15 seconds. Warnings name
  omissions and the recovery move. Folder links never grant AI file access.
- Link/rescan refreshes metadata. Relative-path IDs preserve selections across
  replacement and relinking; revision URLs invalidate stale pixels. Missing
  images retain their choices but are skipped, with the original as fallback.
  Explicit forget revokes URLs and removes its selections without touching
  originals. Folder links and slideshow preferences stay on this device;
  exporting a custom theme still embeds only its authored artwork.

The art and prompt set live in `src/assets/themes/gallery/`; original paintings
remain unchanged. `scripts/build-theme-loops.mjs` records reproducible loop
encoding. See `docs/theme-backgrounds.md` for the user workflow and
`docs/theme-backgrounds-validation.md` for test evidence.

**GIF frame counts are not a visibility check.** The initial 1.6-pixel ripples
had different decoded frames, but scaled to less than half a pixel in the
208-pixel preview and became barely visible at editor opacity. Some moving
regions were completely outside a narrow editor's centred cover crop. The
encoder now uses broader central water/cloud motion and restrained lighting,
checks preview/editor/portrait/grayscale pixel differences, and stages complete
files before atomic replacement. Glow arithmetic is explicitly clipped: FFmpeg
`geq` wraps values outside 0–255, producing dark flashes in bright highlights.
`scripts/check-theme-gif-motion.mjs` compares actual compositor captures with
unchanging poster controls; canvas extraction and URL assertions cannot prove
an image visibly animates. Single-animation summaries say "looping animation",
while reduced motion explicitly identifies a still frame.

### The Theme Studio (v1.10)

Settings → Appearance → **Theme Studio…** (`ThemeStudioDialog.tsx`, a *sibling*
of Settings in `EditorLayout` — nesting it would stack two focus traps). One
dialog, three tabs, all three axes: the user builds their own app themes, code
palettes and markdown palettes, always by copying an existing one.

- **The registries became live.** `THEMES`, `CODE_THEMES` and `MARKDOWN_THEMES`
  are now mutable objects seeded from `BUILTIN_*`, and `registerCustomThemes` /
  `registerCustomEditorThemes` replace the user's entries in one pass. Forty
  call sites already read `THEMES[id]` and reach fields off the result — a user
  theme has to BE a `ThemeDef` or every one of them grows a branch. Object
  identity never changes, so React cannot subscribe to a registry: components
  read `useCustomThemeStore` and call `themeList()` / `codeThemeList()` /
  `markdownThemeList()`. A user id can never shadow a shipped one; the shipped
  themes stay read-only, because an ouRGeo update would otherwise silently
  revert an edit and there would be no honest "reset to default".
- **Hex in, HSL out** (`custom-themes.ts`). The authoring model is hex, because
  `<input type="color">` speaks nothing else; `ThemeDef.vars` is derived, since
  `globals.css` composes those triples with alpha (`hsl(var(--geo-accent) /
  0.4)`) and a hex there invalidates the whole declaration. `palette`,
  `swatches` and the editor chrome come along the same way. Nothing derived is
  ever stored — a hand-edited file cannot then disagree with itself.
- **Colours are validated on the way IN.** Monaco's `ColorMap.getId` throws on
  anything that is not six or eight hex digits, inside `defineTheme`, taking the
  editor with it and leaving no stack that points at the theme file. So every
  colour in an imported or persisted theme is normalised to six digits or the
  import fails with the offending field named. Three-digit shorthand is expanded
  rather than refused; eight-digit is refused rather than silently truncated.
- **`kind` is a field, not an inference.** A code palette and a markdown palette
  are both a flat map of colour names, so nothing in the *payload* tells them
  apart. With the kind declared, importing an App theme file into the Code
  Themes list answers *“That is an App theme file (“Sunset Slate”), and this is
  the code theme list. Import it from the App Themes tab.”* — rather than
  complaining about a missing property. `classifyThemeFile` also recognises the
  two ouRGeo files most likely to be picked by mistake (`theme.json`, which
  records which themes are *selected*, and a project manifest) and says so.
- **Artwork is inlined as `data:` URIs**, not referenced by path — an exported
  theme has to carry its own pictures or it arrives on another machine pointing
  at nothing. That is what the size caps in `BACKGROUND_SPEC` / `ICON_SPEC` are
  for; they are enforced at the file picker, where the user can still choose a
  different image. The backdrop replaces the generated scene behind the editor
  and carries its own opacity and grey-scale (a photograph and a flat SVG do not
  want the same treatment); the card image represents the theme in the picker.
  Both are optional and `themeIconUri` falls through icon → backdrop →
  generated scene, so a card is never blank. A user theme with no backdrop
  still gets a scene: `sceneSvg` looks up `basedOn` in the shipped drawing
  table and recolours it from the user's palette.
- **Edits commit on a debounce; the preview is instant.** `ThemePreview` is a
  self-contained mock drawn from the draft with inline styles, sharing no custom
  properties with the app — which is also what lets you look at a theme you have
  not switched to. The real application is updated once the user pauses (250 ms),
  and `useThemeStore.refresh()` re-applies and bumps `revision`.
- Themes live in **`custom-themes.json`**, separate from `theme.json` on
  purpose: that file records which themes are *selected* and is merged on every
  click of a picker, while this one holds definitions with megabytes of inlined
  artwork.
- **`createJsonFileStore` now serializes its writes** (`persistence.ts`).
  `merge` is a read-modify-write across two IPC round trips and `setTheme`
  fires three at once; run concurrently the second erases the first's key, and
  two overlapping `writeFile`s to one path were observed leaving a *splice* of
  both payloads on disk — unparseable JSON, which the loader reads as `{}`, so
  the app quietly reverted to Dark on the next launch. One promise chain per
  file. Pinned by `persistence.test.ts`.
### Themes the assistant makes (`ai-actions/theme.ts`)

A user can now ask for a theme in prose, so the assistant can build one rather
than describe where the Studio is. Switching stays in `ui.ts` (`ui:theme`,
`ui:codeTheme`, `ui:markdownTheme` — a one-line action like toggling a panel);
the `theme` group is authoring: `theme:list`, `theme:inspect`, `theme:create`,
`theme:setColors`, `theme:configure`, `theme:setImage`, `theme:duplicate`,
`theme:delete` (confirm tier), `theme:export`, `theme:import`.

- **A param's enum can be resolved at call time** (`ParamDef.valuesAt`), and
  the theme switches use it. This is not a nicety: `validateArgs` runs BEFORE
  the action, so a fixed `Object.keys(THEMES)` captured at module load refused
  a theme the assistant had just built — *"must be one of: dark, bespin, …"* —
  and the handler that resolves against the live registry was never reached. A
  local model duly reported to its user that switching to a theme it had made
  was impossible and they would have to click the button themselves. The same
  resolver feeds `describeAction`, so `list_ui_actions` shows the model what
  exists rather than what shipped.
- **`ParamDef.lenient` marks an enum as advisory**, and the theme switches set
  it so a theme can be named by its LABEL. A model that has just created
  "Half-Life 2" reaches for that string, not for `my-half-life-2`; gating
  centrally on the id list would move the same wall one step along, so the
  check lives in the action, where `resolveThemeArg` matches an id, then a
  label, ignoring case and punctuation.
- **`theme:create` takes `apply`**, because "make me a theme" almost always
  means "and use it", and the two-call form was where the failure surfaced.
- **The refusals are the design.** A shipped theme refused by name, pointing at
  `theme:duplicate`; an unknown colour key answered with the valid list; a
  colour name or malformed hex answered with `#rrggbb` — because `defineTheme`
  would otherwise throw deep in the editor with no stack pointing at the model's
  mistake. `theme:setColors` also reports the resulting contrast ratios back,
  flagged when under 4.5:1: it is the one failure a model cannot see.
- **`colors` and `chrome` are separate parameters** for the same reason the
  Studio has two columns — `panel`, `bg`, `border`, `accent`, `muted` and `fg`
  exist in both sets, so a flat map could not say which was meant.
- The `themes` topic in `ai-skill-ourgeo.ts` is the skill itself: the three
  axes and the no-background invariant, the create-from-a-template workflow,
  what each colour paints, and the palette-building rules (move a family
  together, one accent hue, keep the semantic colours semantic).


### Theme collection navigation and image visibility (1.16.30)

`theme-collections.ts` classifies app themes into Illustrated, Legacy, Field
collection and Custom; custom origin wins over inherited collection flags.
Appearance uses keyboard-navigable tabs and Theme Studio uses collapsible groups
with the selected collection open. Syntax palettes retain their own organisation.
`ThemeBackgroundVisibility` shares the per-theme optional `imageStrength` in
`theme-backgrounds.json`. Slider changes use a transient Zustand preview across
all panes and commit on release/blur/unmount; serialised writes preserve other
preferences and a slow save must not clear a newer preview. Explicit overrides
map 0–100 directly to opacity with no image filter; absence restores authored
presentation. Visibility is excluded from the slideshow clock signature. Light
Field defaults are 35%, with syntax ink contrast checked at that blend bound.
