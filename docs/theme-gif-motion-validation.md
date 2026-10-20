# GIF visibility correction — ouRGeo 1.16.28

The GIFs existed and contained genuine animation. Each had 80 frames across
eight seconds, with matching first and last decoded frames for a seamless loop.
The problem was the authored motion: a maximum 1.6-pixel ripple became less
than 0.35 pixels in the 208-pixel gallery preview. Low editor opacity weakened
it further, while centred cover cropping could exclude the moving area entirely.

The user's Arctic selection already pointed to `arctic:loop`. Native preview
captures confirmed that the original GIF was animating: maximum-pair RGB RMS
was only 0.585 channel levels out of 255, versus exactly zero for its paused
poster. Reduced motion was disabled and the document was visible.

## Correction

All ten bundled GIFs now use stronger, centrally visible water/cloud movement
or gentle ambient lighting from their original paintings. Arctic keeps its
stars and geography stationary while the aurora light and water change. Retro
Terminal includes a central room/floor glow that survives narrow panes.

Glow channels are explicitly clamped to 0–255. FFmpeg's `geq` arithmetic can
wrap larger values, causing bright highlights to flash dark; those invalid
prototype results were discarded before replacing any shipped assets.

All loops retain 960 × 540 resolution, 80 frames, eight-second duration,
infinite repetition and byte-identical decoded first/last frames. Files are
2.04–4.88 MiB each, totalling 33.52 MiB. Existing paintings and posters remain
the sources for thumbnails. A single selected GIF is described as a
**looping animation**, with an explicit still-frame explanation under reduced
motion.

The encoder stages files and verifies their hashes, seams, size and visible
pixel differences before atomically replacing a bundled GIF. Authoring gates
cover 208-pixel previews, normal editor opacity/filter, centred portrait crops
and legacy grayscale. This prevents a loop with imperceptible motion from
passing solely because its frame hashes differ.

## Verification

- Encoder: `node scripts/build-theme-loops.mjs --staging`, followed by
  `node scripts/build-theme-loops.mjs --publish-staged`.
- Source metrics and frame hashes: `.cache/theme-artwork/loops.json`.
- Actual compositor regression:
  `TMPDIR=$PWD/.cache/tmp node scripts/check-theme-gif-motion.mjs`.
- Focused theme regression suite: **48 tests pass in nine suites**.
- Full native regression suite: **2,868 tests pass in 293 suites**.
- Typecheck and lint pass, with **0 errors and the same 36 existing warnings**.
- Production build and Linux unpacked packaging pass. All **140 artwork
  binaries and three runtime bundles** match the packaged SHA-256 hashes;
  evidence is in `.cache/theme-gif-motion/package-artwork.json`.

The native motion driver samples lossless compositor images at multiple
timestamps. It checks the real GIF URL, loaded pixel dimensions, document
visibility and motion preference. It also captures paused preview and
reduced-motion editor controls; their pixels must remain identical. Positive
motion thresholds are required for both the preview and editor.

An early diagnostic used native capture rectangles that were clipped below
their requested height, excluding the moving water. Its editor zero-motion
results are invalid. The corrected driver uses full compositor screenshots and
asserts captured dimensions; canvas extraction or URL checks cannot substitute
for proof of visible animation.

The corrected Arctic candidate passed actual wide and narrow editor captures
in `.cache/theme-gif-motion/run-TqkFbj/report.json`: editor RGB RMS 2.06 / 2.64,
with 20% / 34% of pixels changing by at least two channel levels; preview RMS
3.62 / 4.03. Both static controls were exactly zero.

The native driver uses X11 and requests wide/narrow renderer viewports through
CDP. The Linux tiling window manager can ignore native `setBounds`, so the
report records physical window bounds separately and asserts the dimensions
of every compositor capture. Normal compositor captures contain real animated
pixels; no canvas image extraction substitutes for the displayed GIF. Default
validation requires positive preview/editor motion, while `--baseline`
explicitly enables measurements without those gates. `--packaged` runs the
same checks against the unpacked application.

The final rebuilt application passes **20 native compositor cases**: all ten
themes at 1920- and 1000-pixel viewport widths, including split editors. Report:
`.cache/theme-gif-motion/run-fj1kxv/report.json`. Across those cases, the lowest
editor RMS is **1.696** and the lowest preview RMS is **4.823**, above the
required 0.65 / 1.5 thresholds. Every case also passes the changing-pixel
fraction gates. Every paused-preview and reduced-motion editor control has
exactly zero pixel differences, and no renderer errors were recorded.

The final Linux packaged application also passes **four compositor cases**:
Arctic and Retro Terminal at both widths. Report:
`.cache/theme-gif-motion/run-Fgp7j3/report.json`. Minimum editor/preview RMS
is **1.967 / 6.598**; all changing-pixel gates pass, static controls remain
exactly zero and no renderer errors occur. The isolated QA window uses
fullscreen with actual 1920 × 1080 native content bounds, and both tested
viewports fit physically within it. This confirms playback of the packaged
assets as well as the built renderer.

Windows/macOS qualification remains deferred until suitable machines are available.
