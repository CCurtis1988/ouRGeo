# Field collection — ouRGeo 1.16.29

The collection adds all 13 website palettes under `field-<slug>` IDs, preserving
the existing Forest, illustrated themes, legacy looks and saved selections.
Eight are dark and five are light. Each has matching code/Markdown defaults,
a suitable basemap and six distinct still photographs. Animation is deferred
to the user's rendered loops.

## Artwork

- 78 separate, visually reviewed built-in image-generation results; no atlas
  crops or recoloured copies substitute for distinct scenes.
- 78 final 1600 × 900 quality-90 WebP photos and 78 static 320 × 180 thumbnails.
- Photo bytes: **34,368,690**; thumbnail bytes: **1,697,214**.
- All 78 photos have distinct SHA-256 hashes. Encoded dimensions, plain static
  VP8 headers, file budgets, source descriptions and gallery titles are checked.
- Exact prompts, relative master locations and source hashes are recorded in
  `src/assets/themes/gallery/field-prompts.json`.
- Untouched generated PNG masters remain in `.cache/field-theme-artwork/` for
  later video rendering. Per-theme manifests and contact sheets remain there.

## Automated checks

- `npm run typecheck`: passes.
- `npm run lint`: zero errors, the same 36 existing warnings.
- `npm run test`: **2,914 tests pass in 295 suites**.
- Production build: passes.
- Linux unpacked package: passes, at
  `.cache/field-themes-package/linux-unpacked/ourgeo`.
- All **306** bundled theme artwork binaries and **three** runtime bundles
  match the final source/build SHA-256 values in the packaged ASAR. Evidence:
  `.cache/field-theme-artwork/package-artwork.json`.

Palette regressions cover interface text and filled-button contrast, complete
syntax/prose defaults, worst-case white/black pixels under the editor photo
opacity, independent Forest identities and basemaps. Picker regressions cover
keyboard collection navigation, assistant-driven selection, Studio copies,
recolouring, hover/destructive ink and leaving the Field family. Shared colour
math remains covered through the existing Studio tests.

Native driver: `node scripts/check-field-themes.mjs`. The `--packaged` option
runs against the unpacked application. It uses an isolated disposable profile,
blocks remote HTTP requests, exercises real gallery/store/persistence code,
decodes full photos through the preview and captures actual editor layouts.

The final packaged-app run passes all **13 theme cases**, decodes all **78**
full-size photographs and produces **31 screenshots**. It verifies both Dev
and Linen slideshows, saved app/code/Markdown defaults, four narrow split-editor
layouts, Studio duplication, custom collection placement and restoration of
the original Forest. Actual computed filled-button contrast is at least
**4.974:1** normally and **5.659:1** on hover. A real Dev Studio copy also passes
primary/destructive hover checks. No uncaught renderer errors occur. Evidence:
`.cache/field-themes-ui/run-aXObeX/report.json`.

The native screenshots were inspected, including the Field picker, Trout's
river backdrop and Linen's pale dune backdrop with both R and Markdown text.
CSS probes stay inside the current modal's pointer scope; Radix correctly
prevents hovering body siblings while the Studio is open.

Native operating-system picker interaction is outside this palette/artwork
change. Windows and macOS qualification remains deferred until suitable
machines are available, as requested.
