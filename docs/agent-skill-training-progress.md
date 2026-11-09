# Agent skill training — progress log

Working record for [agent-skill-training-spec.md](agent-skill-training-spec.md).
Newest first. Numbers here are development measurements (pilot / train / val);
the claim of improvement is made only from the sealed test (spec §6).

Diagnosis of the performance gaps: [agent-skill-diagnosis.md](agent-skill-diagnosis.md).

## 2026-11-08 — study stopped; work moves to a skill system

Stopped at the maintainer's request. All runs, queues, locks and the alarm are stopped;
ledgers are kept. Lever results (val, development only) are in
[agent-skill-diagnosis.md](agent-skill-diagnosis.md). Several levers were workarounds for
gaps in how skills reach the model, so the next step is building a real skill system:
`~/.claude/plans/i-feel-like-we-sleepy-ullman.md`. The harness, tasks and sealed test
(manifest sha256 `6e186e76…`, still unread) are reused to measure it.

Unfinished at the stop: L1b and L2 complete on Haiku, partial on Qwen; L3 not run. The
transport fix (`f970eea4fd28`), docs shortlist (`863986ae7c68`) and L15 not measured on
Qwen. L14 has 29 of its second 75 Qwen runs.

## 2026-11-06 — P1 authored; sealed test fixed

Authored with every task passing its oracle and failing its null and wrong controls:
train 114 tasks, val 75, sealed test 151, 19 domains each. Four usage-limit refusals
during authoring were waited out and nothing was lost.

**Sealed test fixed before any optimisation.** Manifest sha256
`6e186e76f4176d26ca12c999e124cd4c6d28171e41901fd64ca39637fc13dd99` over 19 files, recorded per file in
`.cache/skill-training/sealed.sha256`. Files are read-only and
`sealed-access.log` is empty: nothing has read them. P6 must verify this hash first.

**Baseline audit before P4 (spec §5.5(6)).** First readings were Haiku 55.7% and Qwen
38.6% on train, with Toolbox at 9% for both, too low to accept unread. It was mostly
harness, so those train numbers are superseded:

1. **Grader field.** All 10 Toolbox tasks with a tool check tested `i.tool || i.id`;
   the real parameter is `toolId`, so they could not pass. The oracle missed it
   because replay supplies its own input. Controls do not exercise the real tool
   schema: a known limit of §5.5. Aliased in the grader, which also reaches the sealed
   test without opening it. Every other `where` field matches its schema.
2. **Unanswered native dialog.** A Toolbox run needing a CRS review waits on the
   preflight `dialog.showMessageBox`, which nobody can click in a hidden window. The
   tool call never returned: Qwen lost 600 s, Haiku over 2 minutes.
   `toolbox-train-nc-transform-es-01` now passes in 22 s. The harness answers native
   dialogs in main per the task's `confirm`. Not an app bug.
3. **`numbers_grounded` false failures.** It ignored dimensions the host states and
   prefetched evidence, and read "14 060" as two numbers.
4. A dry run counted as running a tool. It no longer does.

Correction method: all rows from toolbox-affected tasks, pass or fail, are archived in
`ledger-invalid/hung-dialog-and-toolid/` and re-run. `numbers_grounded` is regraded
offline for every row by `regrade.mjs`. Re-running only failures would have biased
the result upward. Null and wrong controls re-run because graders were loosened.

Result: `regrade.mjs` changed 12 verdicts, all fail to pass (Haiku train 9, Qwen train
3, val 0). Null and wrong controls after loosening: 0 of 189 wrongly pass on either,
no harness failures.

**App state leaked between tasks.** `reset` clears the session, not app-level state.
Inside one running app, custom themes, plugins and the layout survived to later tasks
and to the second run of the same task: `plugin:list` showed plugins the task never
made, and Harbor Fog "already existed". `launchApp` wipes the sandbox, so the leak
was within one instance only. The runner now relaunches after any themes, plugins or
layout task, and after any action touching that state. All rows in those three
domains, pass or fail, archived in `ledger-invalid/app-state-leak/` and re-run.

**Domain audit, so far.** Assessed as real and left as training targets: tutorials
(models find the fact, never call `ui:highlight`), plugins (most stop after searching
the store), and `docs-qa` misses such as the chat switcher. Grader doubts, not changed:
`docs-qa` regexes that reject a correct synonym ("different R session"), and drawing
tasks requiring `draw:addFeature` where R got the right result. Those stay as written
so train, val and the sealed test keep one standard, and because they compare fairly
between arms. Read their absolute scores with that in mind. `REQUIRED_SKILL` touched
16 of 648 rows; `theme:duplicate` returning it with empty guidance is unexplained.

Judge calibration passed: 69 cases, Sonnet 100%, Opus 97.1%, κ 0.94. Both misses
were Opus on injection tasks.

**Determinism on build `804274f41e8c`**: oracles run twice on train (114) and val
(75): no verdict differences, no oracle failures. Harness logs showed one repeat 500:
`env:workIn` left the bridge's working environment set across `reset`, so the next
fixture's R ran in a removed environment. Every case was caught by its fixture
failing and being retried on a fresh app, and no Qwen row followed a `env:workIn`
call. The runner now relaunches after any episode that uses it.

## 2026-11-06 early — baseline build replaced before any Claude baseline ran

**The baseline build is now `804274f41e8c`.** This replaces `60667baf045e` below and
the short-lived `dc33370ce4cd`. All earlier Qwen rows are archived under
`ledger-invalid/` and are being re-measured. No Haiku or Sonnet baseline existed yet, so this cost about an
hour of Qwen time, and a baseline with tasks that never reached the model would not
have been valid.

**App bug fixed, not credited to training: naming a non-data-frame object could end
the send.** A message mentioning `area_ha`, a plain vector, made retrieval ask R for
a schema. R refuses for anything but a data frame, as HTTP 500, and the send failed
with a bare `AxiosError` before any model was called. Two fixes: `contextSchema`
uses `ask()` (the CLAUDE.md wire-level rule), and `broker.prefetch` skips optional
evidence that is `SOURCE_UNAVAILABLE`. Other refusals still throw, so policy
failures stay closed; both directions are tested. Found because two Qwen tasks
recorded 0 calls in about 100 ms, just past the harness's 50 ms no-op cutoff. Those
rows were invalid and the cutoff is gone: any turn with no tools and no text is now
a harness failure, never a score.

**Bridge**: `send` now returns the panel's error line (`sendError`, recorded in the
ledger), so a failed turn explains itself. Probes run a discovery call for real and
credit it only when `probe.item` is in its top results. That closes the deferred
§4.3 item, except that tasks must still set `probe.item`.

**Turn-end causes now visible.** On the Qwen pilot on `dc33370ce4cd` (11/15), both
turns with no final answer had a recorded cause. `r-autopilot-off-01` hit the lookup
budget, so its failure was not an ordinary miss. `env-move-01` hit `STALE_REFERENCE`:
`env:move` took `nc` out of `.GlobalEnv`, so already-delivered evidence lost its
source and the next `validateSend` refused. The object had moved, so the grader
passes, but the user sees an error telling them to send again.

**Decision for the maintainer, not taken here.** `freshness.test.ts` pins refusal on
removal after delivery, and the design note gives no reason specific to removal.
That rule is unchanged in the shipped path. Lever L12
(`scalar:evidence:goneIsHistory`, off by default) treats delivered evidence whose
object is gone as history, unless the exclusion list changed during the turn; five
tests cover both directions. Its numbers go to the maintainer with the choice.

**Open question, to be answered by the new baseline**: on the old build 13 of 58 Qwen
turns made tool calls and ended with no final answer, including
`r-autopilot-off-01`, first read as an ordinary miss. Only 2 hit the lookup budget
and 1 `STALE_REFERENCE` as thrown tool errors; the other 10 are unexplained, because
that build could not record turn-level errors. Some may be the 12-invocation or
24-call limits, some a model stopping silently after a write. Do not claim a cause
until `sendError` shows one. Lever L11 (`scalar:budget:soft`) tells the model the
budget is spent instead of ending the turn; off by default.

**Controls**: train oracles run twice: 104 tasks, no verdict differences, no oracle
failures. That was on the old build, so it repeats on this one with val. Judge
calibration is now a pipeline gate before the Claude baselines.

## 2026-11-05 night — stall diagnosed, about 7.5 h lost, restarted

Found when the maintainer asked whether the job had stalled. Both Qwen runners
were alive and silent: last rows 19:02 and 22:14 UTC, each within 3 minutes of the
laptop hibernating. Four harness faults, all fixed; no app change, so build
`60667baf045e` remains the baseline.

1. **The laptop slept under the batch.** PowerDevil hibernated it about every 15
   minutes during the day (on battery). `keep-awake.sh` now holds a logind
   `sleep:idle` lock while the pipelines live. It changes no power setting, leaves
   lid and power key alone, and releases at 25% on battery. `run.mjs` also discards
   any episode that spanned a sleep (wall clock vs monotonic).
2. **A bridge call that never returned froze the run for ever.** App, R and timers
   all still worked; the runner's `page.evaluate` just never came back. Which
   renderer await was lost is not established. Every bridge call now has a
   watchdog, then relaunch and up to 3 attempts, and no row on harness failure.
3. **The usage limit was scored as model failure.** Task authoring exhausted the
   5-hour Claude limit; `base-haiku-train` recorded 0/152, of which 151 were empty
   turns about 1 s long with `error: null`. The app itself reports the limit in
   the panel's error line; only the bridge missed it. Empty Claude turns are no
   longer recorded, and `claude()` waits out a limit. Those rows are quarantined in
   `.cache/skill-training/ledger-invalid/`.
4. **P2 started on failed authoring.** All remaining domains failed in seconds,
   the "== test" trigger fired, and val ran with 0 tasks. The pipeline now requires
   19 train and 19 val domains, and `run.mjs` refuses an empty task set.

Also fixed: **`close()` killed every R server newer than its own launch**, so
closing one runner could kill a parallel runner's R, or a developer's own ouRGeo R.
It now kills only its own Electron's children. Contaminated by this and
quarantined: one Qwen train row (`data-import-train-wells-xy-typo-01`, spanning
Haiku's close) and the partial Qwen pilot, which is being re-run in full.

`stall-alarm.sh` now wakes the supervising session after 45 minutes without output;
a live process proves nothing.

**Grader mutation tests (spec §5.5(3)) added**:
`scripts/lib/skill-training-graders.test.ts`, 20 tests covering all 14 grader
types, each passing a correct trace and catching a seeded defect. 100% of seeded
defects were caught. Testing correct traces also exposed a false failure, now
fixed: `numbers_grounded` split "10,000" in tool output into 10 and 000. No
recorded row failed because of it.

**`export-surface.mjs` added**: 691 keys, baseline hash `70eb3806a38f6ade`, stable
across runs; `--verify` accepts a matching candidate and rejects a changed one.

**Deferred to the build between P3 and P4**: probe on-path checking (spec §4.3).
It must execute the discovery call, which needs a bridge change, and that would
change the build hash during the baseline. Until then a probe's discovery credit
means "called a discovery tool", not "the expected item was in its top five".

**Rubric judge added**: `lib/judge.mjs` (blind, schema-checked, verdicts cached by
`JUDGE_VERSION`), the `rubric` grader, and `calibrate-judge.mjs` for the §5.5(4)
gate, which must run before the Claude baselines count. In TASKS.md before docs-qa
and the sealed test were authored. Five hand-made cases graded correctly, including
Spanish, a denied false claim, and a vague answer. Not yet calibrated: that needs
authored rubric tasks.

**Track B**: `claude plugin eval` has no script graders, so its typecheck, lint and
test gate cannot be expressed there. Using the §8 fallback: `track-b.mjs` runs
`claude -p` in a disposable worktree under `bwrap`. All 24 cases written. Null control 24/24 fail. It also caught two faults in my
own cases: a seeded bug that `permissions.test.ts` does not cover (now graded by
the whole action suite) and driver cases that the no-diff rule would have failed. Haiku smoke run on
`bug-norm360` passed in 36 s, using about 1.2M cached input tokens, so full runs
wait until Track A is safe on quota. H7 confirmed in code: `launch clean` unlinks
the real `layout.json` unless `XDG_CONFIG_HOME` is set. Not yet fixed; it ships
with Track B.

**Optimiser reviewed before P4**: selection and lint moved to `lib/gepa.mjs` with 13
tests (a specialist survives against a better average, parents drawn by columns
led, ties, shorter text wins a draw). Fixed: the dotted-id lint flagged ordinary R
such as `read.csv(`, and an empty overlay re-ran baselines under a new identity,
which would have cost hours per module; it now reuses P2 rows.

**Repository checks, working tree**: typecheck and lint on touched files clean.
Full Vitest 3081/3082 and 1 failure in two runs, a different 5 s timeout each time
in theme and folder tests this work did not touch. Both files pass 18/18 alone;
load average was about 12 with the study running. Treat a loaded-machine timeout
as noise, and re-run on an idle machine before P7.

State at restart (05:45 UTC): train 77 tasks in 12 of 19 domains; val 0; sealed
test 0. Qwen train 30 valid rows kept.

## 2026-11-05 — P0 harness built; P1 authoring and P2 pipeline running

### Harness (P0)

- **Eval mode in the app**, inert unless `OURGEO_EVAL=1`: `src/lib/eval/hooks.ts`
  (seams), `bridge.ts` (`window.__ourgeoEval`: configure, reset, send, state,
  overlay, oracle replay), `overlay.ts` (candidate skill surface patched into the
  live registries, fully restorable — tested), `surface.ts` (the whole
  model-facing surface as one keyed object). Production change outside eval:
  `handleSend` accepts text, `runTool` calls two optional hooks.
- **Runner** `scripts/skill-training/run.mjs`: built app, one sandbox per
  instance (`HOME`/`XDG_CONFIG_HOME` under `.cache/skill-training/sandboxes`; the
  maintainer's `~/.config/ourgeo` is never touched), frozen build snapshots
  (`snapshot.mjs`), content-addressed JSONL ledger, smart-box duty cycle
  (2 h on / 1 h off, `lib/duty-cycle.mjs`), relaunch after a wedged turn.
- **Graders** `lib/graders.mjs` (R state, app state, trace rules, grounded
  numbers, clean-session knit); **statistics** `lib/stats.mjs` (paired task
  bootstrap, sign test, Holm, pass^k — unit-tested); **report** `report.mjs`.
- **Controls on the 15-task pilot**: oracle 15/15, null 0/15, known-wrong 0/15
  after fixing three grader bugs the oracle exposed (label field name, "10,000"
  parsed as two numbers, `exists()` evaluated in `local()`'s frame).
- **Authoring** `author.mjs`: Opus writes train/val, Sonnet writes the sealed
  test from user-facing material only; every task must pass its oracle and fail
  its null and wrong controls, with up to two repair rounds.
- **Optimiser** `optimize.mjs`: GEPA loop (Pareto over task × model, batch
  reflection by Opus with ACE-style itemised edits, minibatch screen, val
  acceptance, safety-suite guard, budgets and leakage lint).

### Product defects the harness found (fixed or queued as levers)

1. **Fixed — every tool call after R failed on the Claude-subscription
   provider.** Evidence returned by a tool was never marked delivered when the
   whole tool loop runs in one transport invocation (MCP). The first
   `execute_r_code` legitimately moved the environment generation and
   `validateSend` then rejected every later call as `STALE_REFERENCE`.
   `ContextBroker.noteToolResultReturned` marks it delivered when the result is
   handed back; regression test in `broker.test.ts`. This is a correctness fix,
   reported separately and **not credited to skill training** — the baseline
   build already contains it, because without it the harness could not measure
   the Claude arms at all.
2. **Lever L10 — Toolbox search matched the whole query as one substring.**
   "reproject transform CRS" found nothing although "CRS Transform" exists;
   Qwen then browsed categories until its turn ran out. Word-ranked search is
   behind `scalar:toolbox:search` and is measured in P3.
3. **Discovery of `ui:highlight` targets.** Asked to point at the Toolbox
   button, Haiku's `list_ui_actions("toolbox")` returned `map:select`; it spent
   its six lookups and told the user it could not find the button (pilot
   tutorials 0/2). Text-optimisation target for A7/A9.
4. **Invented "equivalent R".** Qwen told the user the R for adding a layer was
   `mapview::mapview(nc)`; ouRGeo echoes the real R. Target for A1/A2 `maps`.
5. **Efficiency.** Haiku used 10–12 tool calls to colour one layer by a column;
   median 34k input tokens per pilot task.

### Pilot baseline (15 tasks; development only)

Qwen scored 11, 11 and 10 of 15 across three builds, so one run is noisy. The Haiku
row is from an older build, so the two rows are not a like-for-like
comparison. Qwen failures: `r-autopilot-off-01` (no `mean(` in the handed-over R),
`r-transform-01` (ran out the full 600 s), `doc-rmd-01` (not self-contained),
`tutorial-toolbox-01` (no `ui:highlight`, the same task Haiku failed).

| Model | Episodes | Success | pass^2 | Median calls | Median input tokens |
|---|---|---|---|---|---|
| Haiku (claude-cli) | 30 | 90.0% | 86.7% | 5 | 34.5k |
| Qwen3.8-Flash (baseline build `804274f41e8c`) | 15 | 66.7% | not measured (k=1) | see report | see report |
