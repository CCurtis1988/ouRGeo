---
name: run-ourgeo
description: Build, run, and drive the ouRGeo Electron app. Use when asked to start the app, take a screenshot of it, verify a UI change in the real app, open a file in the editor, run R through the console, or inspect Monaco syntax highlighting.
---

ouRGeo is an Electron + React + Monaco desktop app that spawns an R server as a
child process. Drive it through the Playwright REPL at
`.claude/skills/run-ourgeo/driver.mjs`. Launch takes ~10s (Electron boot plus the
R handshake), so the REPL is worth it over relaunching per interaction.

All paths are relative to the repo root.

## Prerequisites

`playwright-core` is a devDependency — `npm install` covers it. No Playwright
browser download is needed; the driver launches the app's own Electron binary.

On a headless Linux box, prefix with `xvfb-run -a` and install the Chromium libs:

```bash
apt-get install -y xvfb libnss3 libgbm1 libasound2t64 libgtk-3-0 \
  libxss1 libxkbcommon0 libatk-bridge2.0-0 libcups2 libdrm2
```

R must be installed with the packages listed in CLAUDE.md, or the app launches
but the console never reports "R session ready".

## Build first

The driver launches the **built** app (`out/main/index.js`), not the dev server:

```bash
npm run build
```

Re-run it after any source change, or you will be driving the previous build and
drawing confident conclusions from stale code.

## Run

Interactive:

```bash
node .claude/skills/run-ourgeo/driver.mjs
```

Scripted — pipe a heredoc. The REPL queues commands and runs them strictly one at
a time, and `#` lines are comments:

```bash
timeout 240 node .claude/skills/run-ourgeo/driver.mjs <<'EOF'
launch clean
ready
open /path/to/notes.Rmd
lang
tokens
ss my-shot
errors
quit
EOF
```

Screenshots land in `/tmp/ourgeo-shots/` (override with `SCREENSHOT_DIR`).
**Actually open the PNG.** A blank frame means the launch failed.

## Commands

| command | what it does |
|---|---|
| `launch [clean]` | launch the app; `clean` first wipes the persisted session AND `layout.json`, so tabs and open panels are deterministic |
| `ready` | block until the console prints "R session ready" |
| `open <path>` | stub the native Open dialog and click Open — the normal way to load a file |
| `stub-open <path>` / `stub-save <path>` | stub a native dialog without clicking |
| `ss [name]` | screenshot → `/tmp/ourgeo-shots/<name>.png` |
| `tabs` | list open tabs, `*` marks active |
| `lang` | read the editor toolbar's document-type selector |
| `tokens` | Monaco's rendered token classes per line — proves highlighting applied |
| `r <code>` | type R into the console and press Enter |
| `console [n]` | tail of the R console pane |
| `click <sel>` / `click-text <text>` / `title <substr>` | click by selector, text, or `title=""` |
| `focus-editor` | put the caret in Monaco so `type`/`press` reach it |
| `type <text>` / `press <key>` | keyboard input |
| `wait <sel>` / `text [sel]` / `eval <js>` | wait, read innerText, evaluate in the page |
| `errors` | renderer console errors collected since launch |
| `windows` | list windows (plot popout opens a second one) |
| `quit` | close the app, sweep stray R servers, exit |

## Gotchas

These are things that actually bit, not generic advice.

- **Native dialogs cannot be driven by Playwright.** Open/Save go through
  Electron's `dialog` module in the main process. `stub-open` / `stub-save`
  replace `showOpenDialog` / `showSaveDialog` via `app.evaluate` before you click
  the UI control. The `open` command does both in one step.

- **Piped stdin closes before the queue drains.** readline fires `close` as soon
  as the last line is *read*, which with a heredoc is immediately. The driver
  defers teardown until the command chain settles; without that, a scripted run
  tears the app down mid-script and silently produces almost no output.

- **readline does not await an async `line` handler.** Every piped command would
  otherwise start at once and interleave. The driver serializes them through a
  promise chain — keep that if you edit it.

- **Stray R servers outlive a hard kill.** `server.R` is a child of Electron but
  can survive; a leftover one holds a random port and confuses the next run.
  `quit` sweeps the ones that appeared after `launch` — never a server that was
  already running, which is how a driver run used to kill the R session of a
  developer's own `npm run dev` window and silently wipe their environment. If a run behaves strangely, check `pgrep -af server.R`
  first — this has previously manifested as an orphaned R process grabbing port
  9222 and breaking CDP-based tooling.

- **The app restores its last session AND its layout on launch.** Without
  `launch clean` you inherit whatever tabs and open panels the previous run
  left. Panel state is the easier one to miss: `layout.json` is a preference the
  app keeps deliberately, so a panel you opened three runs ago is still open.

- **`ss` times out when anything on screen animates.** Playwright waits for a
  stable frame; the map's render loop and a panel's loading spinner both keep
  it from getting one, so the screenshot fails while the app is perfectly fine.
  It is intermittent — the same panels screenshot happily once they settle.
  Read the DOM with `eval` instead, and trust `errors` for whether anything is
  actually broken.

- **Use DOM `.click()`, not `locator.click()`.** The editor pane layers an
  absolutely-positioned background and themed artwork behind a transparent Monaco
  canvas, so coordinate-based clicks are unreliable. Every click command in the
  driver goes through `page.evaluate(el => el.click())`.

- **`tokens` beats a screenshot for syntax highlighting.** Monaco token classes
  (`mtk1`, `mtk15 mtkb`, …) tell you which grammar rule matched. A screenshot
  shows colours; `tokens` shows *why*.

## Troubleshooting

- **"out/main/index.js missing"** → `npm run build`.
- **Launch timeout** → stale Electron process? `pkill -f "electron.*ourgeo"`.
- **"R session ready" never appears** → R or its packages are missing; run
  `Rscript r/server.R` by hand and read the error.
- **"Missing X server"** → prefix with `xvfb-run -a` on headless Linux.
- **Stale Xvfb locks** → `rm -f /tmp/.X*-lock; pkill Xvfb`.
