# The terminal

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## The terminal (v1.13)

A real pseudo-terminal running the user's own shell, tabbed with the R console
by default. `electron/main/terminal.ts`, `src/lib/terminal/`,
`src/store/terminal.ts`, `src/components/terminal/`.

**Rule 0 does not bind — no R runs, so there is no R to echo — and that is the
constraint, not a licence.** Every other operation in ouRGeo leaves the user
with a console they can re-read and re-run; a shell command leaves nothing. So
the docs topic and the tool guidance both say the same thing in the same words:
if it can be done in R, do it in R. Rule 22 binds hard: **terminal output is
never written to disk** — not `session.json`, not a `.ourgeoproj`, nowhere.

### A pty, not piped stdio

`child_process.spawn` with pipes is not a terminal: no TTY means no colour from
most tools, no line editing, no `top`, no `vim`, no job control. For anyone who
likes their terminal that is a command runner wearing its clothes.

**`@lydell/node-pty`, pinned exactly, in `dependencies`.** node-pty is built on
node-addon-api, so its binary is **Node-API — ABI-stable across Node and
Electron** — and a prebuilt binary loads with no `electron-rebuild`, no
node-gyp, and (verified) no install script at all. The lydell repackaging ships
one platform's binary via `optionalDependencies`: **160 KB installed**, against
27 MB for the all-platforms package. Stable `node-pty@1.1.0` has *no Linux
prebuild* and falls back to node-gyp, which is a worse day-one story for this
project's primary platform than a pinned beta.

Three consequences, all handled rather than discovered:

- **A cross-built installer would ship no terminal, silently.** Only the host's
  binary installs, and electron-builder cannot tell a file we did not want from
  one that is not there. `scripts/check-pty.mjs` runs before every `package:*`
  and refuses, naming the fix. It resolves the package ENTRY, not its
  `package.json` — these packages declare `"exports": "./lib/index.js"`, and a
  bare string export map makes every other path unresolvable.
- **`asarUnpack` covers the whole package**, not `*.node`: the Windows build
  loads `conpty.dll`, spawns `OpenConsole.exe` and starts
  `lib/worker/conoutSocketWorker.js` as a worker thread, all by path.
- **The module is loaded lazily behind a try/catch.** On an architecture with no
  prebuild the import throws, and a throw at module load would take main down
  over a panel the user may never open. The panel says which platform is
  unsupported instead, and points at `system()`.

### What main does that the renderer cannot

- **Coalescing.** A pty emits data in whatever sizes the program writes it, and
  `cat` on a large file is thousands of tiny reads. Batched on an 8 ms timer or
  at 64 KB — comfortably under a frame, so typing still echoes instantly, while
  a burst becomes at most ~125 messages a second however hard the program writes.
- **Flow control.** `yes` outruns any renderer, forever. Above 512 KB
  unacknowledged the pty is paused; the renderer acks from xterm's `write()`
  callback and it resumes below 128 KB.
- **A bounded replay ring** (128 KB), so a renderer reload — Ctrl+R, or the
  automatic reload `index.ts` performs when the renderer dies — **reattaches to
  the running shell** rather than killing it. Trimmed by whole chunks where
  possible: an escape sequence cut in half replays as garbage. In memory only.
- **Reading the shell's directory.** OSC 7 is the portable answer and a stock
  bash emits nothing at all, so "Set R's working directory to here" was disabled
  for most Linux users. We own the pty and know its pid, so `terminal:cwd` reads
  `/proc/<pid>/cwd`; macOS and Windows keep OSC 7 and report nothing rather than
  something invented. Read when the menu is about to open, not on a timer — an
  item that enables itself a moment after you looked at it is worse than one
  that was right when it appeared.

### The renderer

**Bytes never enter React.** The sink writes straight into xterm's buffer and
acks what was drawn; only four facts reach a store (title, cwd, alive, bell).
Same rule the voice level meter needed, same failure avoided.

**Sinks are a SET, not one per session.** That was the first shape and it was
wrong: `terminal:run` must watch the stream *while* the view keeps drawing it,
or a command the assistant ran would produce nothing on screen — precisely the
failure the visible-tab rule exists to prevent.

**The sink is registered BEFORE the attach.** `attach` returns the replay
buffer, but data emitted during that round trip is sent immediately; a sink
installed after the await drops it, and the symptom is a missing first line that
only appears on a fast machine.

**Every view stays mounted** when its tab is hidden, so a running program's
screen and scrollback survive a tab switch — which costs a `fit()` on
activation, because a hidden element measures zero.

**Session creation is idempotent by construction.** StrictMode double-invokes
effects in dev, and the second shell would be invisible: no tab, holding a pty
until quit. `ensureSession` de-dupes through an in-flight promise, which is what
actually holds when two callers race.

**Title and cwd come from xterm's own parser** (`onTitleChange`, a registered
OSC 7 handler), not from scanning chunks in main: a sequence split across two
reads is routine and the parser reassembles it. A user's rename sets `renamed`,
which stops the shell's title sequence — fired on every command in most default
prompts — from erasing it.

### Colours

`src/lib/terminal/theme.ts` is `buildMonacoTheme`'s sibling and inherits its
invariant: **the surface is the app theme's, the ANSI ramp is the code
theme's**. So switching code theme recolours `ls`, and switching app theme never
moves the background. `terminal/theme.test.ts` pins both directions.

The sixteen colours are **derived, not authored**. Ten shipped themes would be
160 hand-picked decisions and a Theme Studio theme would have none, so each slot
names a target hue and takes the nearest colourful palette entry, falling back to
a base ramp when nothing is close enough — Solarized yields a Solarized
terminal, a monochrome palette yields sensible defaults rather than six shades
of grey.

**The assignment is exclusive, and that is not a refinement.** Without it
ouRGeo's own Dark theme produced a terminal whose `blue` and `cyan` were the
same `#79c9d9` — one colour at hue 190 is within tolerance of both targets — and
three of the ten shipped themes collapsed a slot that way. Two identical
chromatic colours is a terminal where `ls` cannot tell a directory from a
symlink. Legibility is solved for as CONTRAST against the background rather than
a fixed lightness band, because a band that suits near-black washes out on white.
`background` is `chrome.bg`, not `chrome.panel`: the console it shares a strip
with paints nothing, and taking `panel` drew the terminal as a slightly
different rectangle inside its own pane.

### One header row, not two

The zone used to draw a tab strip ABOVE the panel, and the panel drew its own
header underneath — so reaching the terminal cost two rows of chrome, and the
words "R console" appeared on screen twice, three pixels apart, once as a tab
and once as a heading.

`PanelMeta.hostsTabs` opts a panel into drawing the zone's tabs inside its own
header instead. The console and the terminal both set it; `ZoneTabs` is the
shared component and `Zone` skips its own strip when the zone is hosted.

- **All or nothing per zone** (`zoneHostsTabs`), never per panel. Asking only
  the ACTIVE panel would move the tab strip between the zone's row and the
  panel header as the user switched tabs, so the control they were reaching for
  jumps a row. Drag Plots into the bottom strip and the whole zone reverts to
  its own row — consistent, if less tidy.
- **Only when there is something to switch between.** `usePanelDrawsTabs` is
  false for a zone in `split` mode (both panels are visible and each has its own
  header) and false for a panel alone in its zone, which is what keeps the
  console looking exactly as it did before the terminal existed.
- The shell tabs inside the terminal are **pills, not underlines**: the pane's
  tabs beside them are underlined, and two underlined groups an inch apart read
  as peers when one lives inside the other.

**`store/panelDrag.ts` is what made this possible.** The dragged-panel id was a
`useState` in `EditorLayout` threaded down as a prop pair — fine while only
`EditorLayout`'s own children needed it, impossible once a tab button is
rendered deep inside `Zone` → `PanelSlot` → the panel itself. Same move
`store/contentDrag.ts` documents one level down, for the same reason. The
gesture itself (`startPanelDrag`, its 4px threshold, its single commit point)
moved to `layout/panel-drag.ts` so the zone and its tabs do not import each
other.

**`TerminalDirBar` is `WorkingDirBar`'s sibling, not a reuse of it.** Same shape
— the path IS the control, one click opens everything you can do with a
directory — but R's working directory is a value ouRGeo owns and can set, while
a shell's is a fact about a process we can only read, and the way to change it
is to type `cd` and hope. One component with a prop deciding which of those each
menu item meant would have been worse than two. It polls (2s, a `readlink` in
main) while its tab is on screen.

**They are DRAWN identically**, though, down to the shared `ElidedPath`
(`components/ui/elided-path.tsx`, lifted out of `WorkingDirBar`), the mono face
and the size: the two sit inches apart in the same strip — one when the console
tab is in front, one when the terminal is, and both at once in split — so a
user reading the bottom of the window should see one kind of thing that says
where you are, not two that differ in font for no reason they can name.

**It shows the SHELL's directory and only ever that.** It used to tint amber
when the shell and R had drifted apart, which made the one place that answers
"where is this shell?" also, quietly, a report on R. The two directions between
them are still in its menu, where they are actions with both paths spelled
out — which is where a comparison belongs.

### Placement, and the setting

`terminal` is an ordinary panel (bottom zone, order 1) and — since 1.13 — has
**no toolbar button**. The tab beside "R console" is how you reach it, which
is why the panel is `essential`: a closed terminal would be a panel with nothing
left to open it. It costs nothing to leave open, because in a tabbed zone only
the ACTIVE panel renders, so no shell is spawned until the tab is clicked.
`essential` is also the migration — every `layout.json` written while the button
existed says `open.terminal: false`, and step 3 of `normalize` opens it on load.

Two consequences that were bugs first:

- **The bottom strip now ships `tabs`**, not `split`. The zone default was
  invisible while the terminal was closed; with it open, a fresh install would
  have come up with a shell running beside the console that nobody asked for.
- **The placement preference is applied in `useLayoutStore.init`**, before the
  first render — not from the panel's mount effect, and not from an effect
  afterwards. A stored layout whose bottom strip is `split` mounts the Terminal
  panel for one frame, and mounting it spawns a shell: `terminal.list()` came
  back with a pty on a launch that never showed a terminal. It is the one
  terminal-shaped special case in the layout store, and it is there because
  that is where the file becomes what is on screen. `alignTerminalMode` takes
  `front` for the same reason: an explicit open must SHOW the terminal, a
  startup must not, or every launch would come up with the shell in front of
  the console the user was reading.

`lib/terminal/placement.ts` is pure and holds two operations:

- `placeTerminal` — what the **Settings switch** does. An explicit "arrange it
  like this", so it moves the panel even from another zone, and it follows the
  CONSOLE rather than the bottom strip: hard-coding `bottom` would be right until
  someone moves the console to the left column. It also OPENS the panel, since
  "give the terminal its own pane" and "and don't show it to me" is not a thing
  anyone means.
- `alignTerminalMode` — what **opening the panel** does. Never moves anything;
  it only changes the mode of a zone the terminal and console are BOTH in. That
  guard is the difference between a remembered preference and one that fights
  you, and it is what lets the setting promise the panel stays where it is put.
  A workspace built before the terminal existed has it in `split`; the default
  is a tab, and this is the one moment there is anything to apply it to.

`useLayoutStore.transform` is the one escape hatch that made this possible
without a terminal-shaped special case in the layout store — a pure transform,
applied through the same `apply` as everything else.

**The switch lives in Settings → Terminal, not Settings → Workspace.** It
shipped in Workspace, on the argument that where a panel sits is a fact about
the workspace and belongs with the other panel settings — which is true, and
irrelevant: a user who wants the terminal beside the console opens the Terminal
section, finds a shell picker and a cursor style, and concludes the arrangement
cannot be changed. It reads the LAYOUT rather than the stored preference, so a
terminal dragged to the right column reads off, which is honest — it is beside
nothing.

### The assistant

Six actions (`terminal:list / open / run / read / interrupt / close`) plus a
**third switch in the AI panel footer**, AND-ed with Autopilot, off by default
and only ever `true` by explicit value.

**It is not a sandbox and must not be described as one**: R's `system()` reaches
the same machine from behind Autopilot alone. What the switch means is that the
user decided, deliberately and once, that running commands on their computer is
part of what the assistant does. The accountability is the real control — every
command is typed into a tab they are watching and logged to the console.

- `UiAction.requires` carries the gate, not six copies of a check inside the
  group. Checked BEFORE the tier, because two refusals for one call is how a
  model ends up telling a user something is impossible.
- With the switch off the actions are **filtered out of `list_ui_actions`
  entirely** — absent rather than discovered by refusal, the rule the web tools
  already follow — and `buildToolGuidance` states the position up front.
- No `confirm` tier by default: the switch is the deliberate act, and a modal
  per command becomes a habit-forming click. The user can still raise any of
  them in the permissions dialog.

**`terminal:run` and the completion marker** (`run-markers.ts`). A pty has no
framing, no exit code, and a prompt is whatever the user configured — so the
command is followed by one that prints a private OSC sequence carrying the exit
status. An OSC rather than a printable sentinel, so `echo "OURGEO-DONE"` cannot
end a run and nothing extra is drawn.

**Never a raw ESC byte on the command line.** To a line editor an ESC is not a
character, it is the start of a meta sequence: writing one into bash's readline
enters a key binding instead of inserting text, and the command silently becomes
something else. Every form uses notation the shell expands (`\033`, `[char]27`).
cmd.exe has none, so it gets no marker and reports no exit code — said, not
guessed. Each shell spells the status differently and fails *silently* (`$?` in
fish is a different variable that prints nothing), so the family comes from the
profile and an unrecognised shell loses the code rather than typing `$?` into
the user's prompt.

The core prompt budget went **7000 → 7200**: six generated ids the index carries
regardless, plus one sentence that must be up front because it names the switch.
The prose was 44 of the 200.

### Keyboard, shells, and the R links

- **Everything goes to the shell** except Ctrl+Shift+C/V/F (Cmd on macOS).
  Ctrl+C is SIGINT, Ctrl+R is reverse-search, Ctrl+D is EOF. Copy with an empty
  selection is swallowed, or Ctrl+Shift+C arrives as the SIGINT it was avoiding.
- **Ctrl+= / Ctrl+- become font size** when a terminal has focus, decided in
  `EditorLayout` rather than the terminal: main `preventDefault`s them in
  `before-input-event`, so the keystroke never reaches the focused element and
  only the `ui:zoom` message does.
- **Login shells on macOS only.** launchd gives a GUI app a minimal PATH and a
  non-login zsh never reads `~/.zprofile`, so a terminal without `-l` cannot find
  `brew` — or, on many machines, R. Linux and Windows have no such gap and would
  only get `~/.profile` re-run on every tab.
- **Two links to R**, both in the tab menu: "Go to R's working directory" types
  the `cd` so it lands in the shell's own scrollback, and "Set R's working
  directory to here" goes through the same `changeWorkingDir` the console header
  uses — so it echoes `setwd("…")`, which is rule 0 on the one operation here
  that touches R.

**Not persisted:** which tabs were open. A terminal is a live process, and
restoring a dead tab that looks alive is worse than starting clean; across a
renderer reload it survives because main kept the pty. `terminal-preferences.json`
holds the settings and is a preference — never in the `will-quit` delete list.
