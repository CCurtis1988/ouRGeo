# Layout, console I/O and the working directory

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## Layout & Panels

The UI is a single-page app with a toolbar + resizable panel system managed by `EditorLayout.tsx`. Panels are toggled by toolbar icon buttons and sized with drag dividers:

| Panel | Store | Component |
|-------|-------|-----------|
| Left: Code Editor + Console | `session`, `editor` | `CodeEditor`, `Console` |
| Left tab: Packages | `packages` | `PackagePanel` |
| Left tab: Environment | `environment` | `EnvironmentPanel` |
| Right: Spatial Editor (MapLibre) | `spatial` | `SpatialEditor` |
| Right: Plot Preview | `plotting` | `PlottingPanel` |
| Right: AI Chat | `ai` | `AiChatPanel` |
| Right: Help | `help` | `HelpPanel` |

### Console I/O Design

- Code execution: `POST /r/execute` (HTTP) — one response per request
- `POST /r/execute` also broadcasts captured plot PNGs via WebSocket after execution
- Frontend adds `input` entries locally (immediate feedback); R server does NOT echo `> code`
- `Ctrl+Enter` runs a single line from Monaco and advances cursor
- `Shift+Enter` runs selected lines

### Working directory (`src/lib/working-dir.ts`, `console/WorkingDirBar.tsx`)

The directory is shown in the console header, beside "R Console" and the
connection dot — next to where relative paths are typed, because that is what it
governs. The path IS the control: clicking it opens the one menu that changes it
(native folder picker), copies it, opens it, re-reads it, or jumps to a recent
one (`working-dirs.json`, persisted, max 8).

- **R owns the value.** The store is set from the server's own `getwd()`, never
  from what the picker was told to do, and `broadcast_wd_if_changed()` runs
  beside the env/package sweeps after every execution — so a `setwd()` typed
  into the console moves the label exactly as the dialog does.
- `POST /session/setwd` rather than `execute('setwd(…)')`, so a bad path is a
  result the menu can show instead of stderr the user has to go and read. The
  console still gets the `setwd()` line — every GUI operation echoes its R.
- **R starts in the user's home directory** (`r-bridge.ts`), not in `r/`. The
  cwd is what every relative path in the session means, and pointing it at
  ouRGeo's own program directory aimed `ggsave()` at the install — inside
  `resources/` in a packaged build. `server.R` is therefore spawned by ABSOLUTE
  path: it resolves its module directory from `--file=`, which R reports
  verbatim, so a bare `server.R` would normalize against the new cwd.
- `elidePath` drops whole segments from the middle (`/home/…/Projects/ourgeo`),
  never mid-word — a path cut at `/home/data…` reads as a different directory.
  Measured on a canvas in the element's own font, because `text-overflow`
  removes the END, which is the part that names the directory. The measured box
  needs `flex-1`: content-sized, it measures the elided string rather than the
  space available, and the label shrinks once and never grows back.
