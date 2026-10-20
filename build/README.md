# Desktop application icons

`logo-source.png` is the unchanged artwork from the ouRGeo homepage:
[official logo](https://ourgeo.dev/images/ourgeo/logo.png), retrieved
19 October 2026. SHA-256:
`afc376fc620245e88a229f819f9939274a3df7305a5046d313fbe91ceedd3069`.

Run `node scripts/build-app-icons.mjs` with ImageMagick 7 installed to regenerate:

- `icon.png`: 1024-pixel runtime/window/Dock image.
- `icon.ico`: Windows executable, shortcut and installer icon, with seven sizes
  from 16 to 256 pixels.
- `icon.icns`: macOS application icon, with standard and Retina representations
  through 1024 pixels.
- `icons/`: Linux launcher PNGs from 16 to 1024 pixels.
- `src/assets/app-icon.png`: the renderer's 32-pixel favicon.

`logo-mask.png` supplies the circular silhouette with transparent exterior. The
built-in image-editing tool produced the cutout; only its alpha was retained,
with near-transparent fringe noise removed and the interior made fully opaque.
Its perimeter is constrained to the original's connected exterior background
so the cutout cannot reveal a thin white halo around the existing dark rim.
The generator renders the original website pixels through this mask. It never
uses the edited cutout's RGB, preserving the original lettering, mountains,
snow and highlights. Keep the mask aligned with the 1254-pixel source if the
logo is replaced in future.

The built-in edit used the prompt: “Remove ONLY the near-white background
OUTSIDE its outermost dark circular perimeter and replace that exterior with
genuine alpha transparency. Keep the complete circular dark border intact.
Preserve all artwork and every letter INSIDE the circular badge.” Only the
result's silhouette is retained; the generator always renders the original RGB.

Generated assets preserve the artwork inside the badge and remove the white
square outside it. Generated assets are committed; building or
running ouRGeo requires neither ImageMagick nor an internet connection.

Electron Builder uses explicit platform icon paths in `package.json`. Vite also
copies `icon.png` beside the main-process bundle, making the same icon available
inside `app.asar` and during development. `app-icon.ts` supplies the path to the
main workspace, plot popout and Active View window; macOS also sets the Dock
icon when running from source. Linux uses `ourgeo` as its window class and
`StartupWMClass`, matching the installed `ourgeo.desktop` launcher.

ouRGeo currently has no separate system-tray menu. A future Tray implementation
should reuse this artwork rather than restore the old R/globe icon.
