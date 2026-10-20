# Theme backgrounds: implementation and validation

This feature is included in ouRGeo **1.16.27**. The user workflow is documented
in [Theme backgrounds](theme-backgrounds.md).

## Delivered behaviour

- Each painted theme has six distinct still images and one looping GIF.
  The ten existing paintings remain unchanged; fifty new 1600 × 900 WebP
  paintings match their illustration style. Ten eight-second, 80-frame GIFs
  animate quiet reflections, clouds or terminal light in the original art.
- The gallery retains original custom/legacy artwork and offers the related
  painted gallery as extra choices. Selection and timing are per app theme;
  code/Markdown palettes and theme exports keep their existing behaviour.
- One selected image stays fixed; multiple selections use one synchronised
  workspace clock, a configurable 5–3,600 second interval and 650 ms crossfades.
- GIF badges, still thumbnails, explicit animation previews and reduced-motion
  posters prevent unexpected movement in the picker.
- Multiple linked image folders support link, rescan, locate and forget.
  Relative-path IDs preserve selections after replacement or relinking; missing
  images are skipped and original artwork provides fallback.
- Opaque protocol URLs serve authorised, bounded raster files only. Forgetting
  revokes access without changing disk originals. Folder links do not authorise
  project-library or AI access.
- Lazy, small thumbnails and bounded asynchronous decoding keep large image
  folders responsive. Only current/next selected slideshow images are preloaded.
  Failed reads/saves have visible recovery controls.

## Artwork provenance and reproducibility

The new paintings were produced with the **built-in image_gen tool**, one call
per distinct painting. No API/CLI fallback was used. Every generated source was
copied/encoded into the repository; the application never depends on files under
the generator's default output directory.

- [Prompt set and filenames](../src/assets/themes/gallery/prompts.json).
- [Thumbnail encoder](../scripts/build-theme-thumbnails.mjs):
  `node scripts/build-theme-thumbnails.mjs`.
- [Loop encoder and verification](../scripts/build-theme-loops.mjs):
  `node scripts/build-theme-loops.mjs`.
- [Native acceptance driver](../scripts/check-theme-backgrounds.mjs):
  `TMPDIR=$PWD/.cache/tmp node scripts/check-theme-backgrounds.mjs --complete-art`.

The local FFmpeg loop encoder creates gentle ambient motion from the existing
still paintings; these are encoded animations, not generated video. It validates
frame count, infinite repetition and exact decoded first/last frame equality.
Regenerating artwork derivatives requires local FFmpeg/ffprobe and ImageMagick;
running the application uses the bundled artwork and Chromium's image decoder.
All ten GIFs are 960 × 540. After the visibility correction in **1.16.28**, they
total **35,146,667 bytes (33.52 MiB)**, with individual files from 2.04 to
4.88 MiB. Their static posters are 1600 × 900 and thumbnails 320 × 180.
The complete new artwork directory, including fifty paintings, ten loops,
posters, thumbnails and prompt metadata, is about **50.8 MiB**.

Local review artefacts live under `.cache/theme-artwork/`:

- `gallery-contact.jpg`: all paintings and loop thumbnails reviewed together.
- `loop-quarter-contact.jpg`: all loops reviewed at a quarter-cycle frame.
- `loops.json`: frame hashes, dimensions, duration, byte count and motion metrics.

## Validation

Final checks against the complete artwork and frozen implementation:

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | 0 errors; 36 existing warnings, unchanged |
| `npm run test` with native R/local-server access | **2,865 tests pass in 293 suites** |
| Final playback/poster/component regressions | **16 tests pass in 3 suites**, including two additional blocked-decoder cases |
| `npm run build` | Pass |
| `npm run check:pty -- linux` | Pass |
| Linux unpacked Electron package | Built successfully |
| Native complete-art acceptance | Pass; 17 recorded checks |
| Final Linux ASAR application after the motion fix | Pass; all 17 native checks repeated |
| Packaged contents | All 140 artwork binaries and 3 runtime bundles match their built SHA-256 hashes |

The full suite includes original-art preservation, gallery completeness and
distinct file contents, actual animated GIF frame structure, selection ordering,
saved-settings corruption/write failures, folder authority and traversal,
preload races, decode cancellation/concurrency, large-photo thumbnails, JPEG
orientation and reduced-motion behaviour. R/local HTTP integration tests require
native execution: the initial sandbox attempt could not access their runtimes
and listeners; the native rerun passes. Packaging likewise requires the native
npm dependency collector rather than the sandbox's limited command shim.

The complete built-app run is
`.cache/theme-backgrounds/run-iEAxgL/report.json`. It verifies the gallery has
one keyboard focus scope with Escape support; actual five-second slideshow
changes (**4,972 ms observed**, synchronised across both editors); one fixed
image; genuine frozen GIF frames; a **24 MP PNG becoming a 480 × 320 thumbnail**;
Source/Visual/Source continuity; file replacement and new files after rescan;
missing-folder fallback and relinking; independent theme selections; persistence
after restart; and URL revocation with originals retained after forget.

The reviewed dark and Heaven galleries have minimum measured text contrast
ratios of **9.12:1** and **6.93:1**. There are no uncaught renderer errors or
external requests. Deliberately missing/revoked image URLs produce expected
404 resource messages during recovery tests.

A final accessibility audit found that an already-playing GIF could continue
while its reduced-motion poster waited behind other decodes. Playback now
replaces that moving frame synchronously, before awaiting the poster; static
frames stay intact. Two blocked-decoder regressions cover both cases. The
focused tests, typecheck and lint pass after this final change; the full-suite
count above precedes those two added tests.

Final packaged-app evidence is
`.cache/theme-backgrounds/run-NahMrb/report.json`, with no uncaught renderer
errors or external requests. Its screenshots show the complete gallery,
large-photo thumbnails, linked folders, two synchronised editors and the light
theme. `.cache/theme-artwork/package-artwork.json` verifies every packaged
painting, GIF, poster and thumbnail, plus the final main, preload and renderer
bundles (renderer `index-CAB7T5Bc.js`). The tested Linux application is
`.cache/theme-backgrounds-package/linux-unpacked/ourgeo`.

Native tests use isolated disposable profiles and deterministic file-picker
results. App rendering, stores, persistence, image decoding, source permissions,
IPC, slideshow timing and image serving remain production code. Remote network
requests are blocked. The driver exercises two editor panes and actual files on
disk, including moved folders, replaced images and revoked URLs.

Windows and macOS qualification is deferred until suitable machines are
available, as requested. Operating-system picker pointer interaction is deferred;
the native picker integration is exercised with deterministic responses. No
outside testing or user testing is required for the completed Linux checks.

The subsequent 1.16.28 GIF visibility correction and compositor pixel checks
are recorded in [theme-gif-motion-validation.md](theme-gif-motion-validation.md).
That follow-up supersedes the GIF assets and packaged runtime hashes above.
