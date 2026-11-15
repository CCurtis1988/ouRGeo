# Why saved memories were ignored at Balanced (diagnosis, 2026-11-10/11)

**The report.** Project memories such as "Always make all plot dark themed" and
"Always use metric units in charts and reports" were ignored when the assistant was
asked for a plot or a report. Switching the Context setting from Balanced to
Thorough seemed to help.

**Root cause.** The memories almost never reached the model. Turn-start routing
looked at saved memories only when the message contained a memory keyword
("remember", "prefer", "units", "format", "style", "length", …). "Draw a histogram
of depth" has none, so no memory was read. After that, the model had to decide on
its own to search memory, and for a plain task it seldom did. When a memory did
reach the model it was followed every time, on every model tested.

**The Context setting was not involved.** Effort is never in the prompt. It sets
the number of lookups the model may make (3, 6 or 10) and an evidence-size ceiling.
Measured, Thorough delivered memories no more often than Balanced.

**Fix (1.17.1).**
- Memories are matched to every message (`src/lib/context/memory-routing.ts`); the keyword gate is gone.
- Memories are read first, on their own allowance, so the three prefetch slots and an active skill can no longer crowd them out.
- A new "graphics" category links plot, chart, figure, histogram and map requests to memories about plots.
- Generic verbs ("make", "show", "add") no longer count as a match.
- Memories the host reads at turn start cost the model no lookup.

A message that no memory fits still carries none.

## Hypotheses and what the evidence said

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | Turn-start memory routing only fires on keywords | **Confirmed, main cause** | Offline replay of the real router: 6 of 8 plain plot/report requests routed no memory. Live: at Balanced the memory reached the model in 18–25% of cases, and almost only when the request happened to contain "length". |
| H2 | Relevance is word overlap, so "histogram" or "map" never match "plots" | Confirmed | Relevance 0 for "draw a histogram…" against the dark-plot memory. Removing the gate alone (F2a) reached 82%; the misses were exactly these. |
| H3 | Memories come last among the 3 prefetch slots and get cut | Confirmed (offline) | Routed skill topics, environment and console evidence are queued ahead of memories. |
| H4 | Attached skills use the shared 2,400-token prefetch allowance | Confirmed (offline) | An active skill plus a routed topic left no room for a memory (pinned by a test in `memory-routing.test.ts`). |
| H5 | Balanced's evidence ceiling or lookup limit blocks memory reads; Thorough lifts it | **Rejected** | Thorough delivered 19% vs 18% (Haiku), 18% vs 20% (Sonnet), 20% vs 25% (Qwen). Lookup-limit refusals at Balanced: 0 of 20 (Haiku), 0 of 10 (Sonnet), 1 of 20 (Qwen). |
| H6 | The prompt never tells the model to check saved instructions | Partly; prompt alone is not enough | Adding that sentence (F1): Haiku 19% (no change), Sonnet 36%, Qwen 60%, with an extra search on many turns. |

## How it was measured

**Harness.** The skill-training harness ran the real app turn on each of 10 tasks.
- **Requests:** 9 ordinary plot, chart and report requests, none mentioning style or units, plus a control question.
- **Seeded project memories:** the two from the report, worded as written, plus two unrelated ones (census boundaries, the client's name).
- **Project:** the memories sit in a saved eval project, active in both the renderer and the main process.
- **Code:** `tests/fixtures/agent-skills/memory/`, `scripts/skill-training/mem-report.mjs`.

**Graders.**
- **Dark:** judged from the rendered plot (median luminance; a white plot measures 1.0, a dark one 0.12), with dark-theme code as a backup.
- **Metric:** judged from the R that ran (a miles-to-km or feet-to-metres conversion) or, for reports, from the answer.

**Held-out tasks.** These check the fix is not tuned to the plot tasks. They use three instructions that no category was written for:
- **caption:** "Always add a caption with the data source to every figure";
- **uppercase:** "Always name new columns in UPPER CASE";
- **rows:** "Always state how many rows were used in every report".

**Arms** (eval overlays; the shipped code is unchanged until the fix):
- Balanced and Thorough as they were.
- "Always apply" pinned, as the ceiling.
- F1, the prompt sentence.
- F2a, routing without the gate.
- F2c, routing plus the graphics category.
- F2b, a card listing every saved instruction on every message.

### Results: memory reached the model, and was it followed

| Arm | Haiku (22 checks) | Sonnet (10–11) | Qwen (19–20) |
|---|---|---|---|
| Balanced (before) | 18% | 20% | 25% |
| Thorough (before) | 19% | 18% | 20% |
| F1 prompt sentence | 19% | 36% | 60% |
| F2a routing without the gate | 82% | – | – |
| Pinned "Always apply" | 100% | – | 100% |
| F2b saved-instructions card | 100% | 100% | 100% |
| F2c routing + graphics category | 100% | 100% | 100% |
| **Final fix (as committed)** | **100%** (22/22) | **100%** (11/11) | **100%** (20/20) |

**When the memory reached the model, it was followed: 100% in every arm, on every model.**

**Lookup cost.** In F2c, Qwen hit the Balanced lookup limit twice, because the two
memories read at turn start each spent one of its six lookups. The final fix makes
those host-chosen reads free, and Qwen hit the limit 0 times in 20 episodes.

**The control question.** "What's the mean mpg in my cars table?" had no memory
selected on the final build, on any model.

**Held-out instructions.** Before: Haiku 2/10 and Sonnet 1/5, the only passes being on the weak "rows" task, where models often state the row count anyway. F2c and F2b: 10/10 and 5/5. Final fix: Haiku 10/10, Sonnet 5/5, Qwen 10/10.

### Why F2c and not F2b

Both reached 100%. F2b sends every saved instruction with every message. In the
control question that made the models volunteer unrelated conversions: "that is
about 8.54 km/L". It also breaks the context design's rule that an unrelated
request selects no auxiliary sources. F2c sends a memory only when it fits, and
sent none with the control question. A memory that must go with every message is
what "Always apply" is for.

## Also found

- **A turn could hang silently.** If preparation returns early (for example, the
  main process's project lease does not match the renderer's project), `handleSend`
  never ends the stream. The panel then shows a Stop button over a turn that is not
  running, with no message. Found while building the eval project. **Fixed in
  1.17.1:** `useAiStore.endStreamIfStill(ac)` ends that turn's stream (only its own)
  and the panel says to send again; reproduced in the real app with a mismatched
  lease, the turn now ends in 0.14 s instead of streaming until stopped.
- **Harness, eval only:**
  - Fixtures can seed memories (`fixture.memories`) into a saved eval project. The main process is told through an eval-only `eval:activateProject` handler, registered only with `OURGEO_EVAL=1`.
  - `--effort` selects the Context setting.
  - Ledger rows record which evidence each turn selected and why.
  - New graders: `plot_made`, `plot_dark` (rendered luminance), `r_code_regex` and `output_regex`.
- **Two grader mistakes of mine, caught and corrected before any conclusion:**
  - The first dark check missed a background passed through a variable (`par(bg = dark_bg)`), so it now judges the image.
  - The UPPER CASE check matched case-insensitively. Those rows were regraded case-sensitively from the R they ran, and the task now checks the column names in R.

## Appendix: full report (`node scripts/skill-training/mem-report.mjs`)

| Model | Arm | Episodes | Memory reached the model | How | Followed (all) | Followed when reached | Dark plots | Metric | Mean input tokens | Control-question input tokens | Lookup-limit refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Haiku | Balanced (today) | 20 | 4/22 (18%) | routed 4 | 4/22 (18%) | 4/4 (100%) | 2/16 | 2/6 | 39,988 | 27,088 | 0 |
| Haiku | Thorough (today) | 20 | 4/21 (19%) | routed 4 | 4/21 (19%) | 4/4 (100%) | 2/15 | 2/6 | 44,222 | 29,503 | 0 |
| Haiku | Pinned "Always apply" (ceiling) | 20 | 22/22 (100%) | pinned 22 | 22/22 (100%) | 22/22 (100%) | 16/16 | 6/6 | 39,917 | 31,653 | 0 |
| Haiku | F1 prompt sentence | 20 | 4/21 (19%) | routed 4 | 4/21 (19%) | 4/4 (100%) | 2/15 | 2/6 | 43,451 | 28,815 | 0 |
| Haiku | F2a routing, no keyword gate | 20 | 18/22 (82%) | routed 18 | 18/22 (82%) | 18/18 (100%) | 12/16 | 6/6 | 38,361 | 30,272 | 0 |
| Haiku | F2c routing + graphics category | 20 | 22/22 (100%) | routed 22 | 22/22 (100%) | 22/22 (100%) | 16/16 | 6/6 | 41,291 | 28,560 | 0 |
| Haiku | F2b saved-instructions card | 20 | 22/22 (100%) | card 22 | 22/22 (100%) | 22/22 (100%) | 16/16 | 6/6 | 40,793 | 31,601 | 0 |
| Haiku | F2c in production code (memory reads still cost lookups) | 20 | 22/22 (100%) | routed 22 | 22/22 (100%) | 22/22 (100%) | 16/16 | 6/6 | 41,627 | 30,257 | 0 |
| Haiku | **Final fix (as committed)** | 20 | 22/22 (100%) | routed 22 | 22/22 (100%) | 22/22 (100%) | 16/16 | 6/6 | 44,847 | 28,442 | 0 |
| Sonnet | Balanced (today) | 10 | 2/10 (20%) | routed 2 | 2/10 (20%) | 2/2 (100%) | 1/7 | 1/3 | 36,031 | 20,339 | 0 |
| Sonnet | Thorough (today) | 10 | 2/11 (18%) | routed 2 | 2/11 (18%) | 2/2 (100%) | 1/8 | 1/3 | 31,044 | 20,902 | 0 |
| Sonnet | F1 prompt sentence | 10 | 4/11 (36%) | routed 2, searched 2 | 4/11 (36%) | 4/4 (100%) | 1/8 | 3/3 | 34,442 | 28,775 | 0 |
| Sonnet | F2c routing + graphics category | 10 | 11/11 (100%) | routed 11 | 11/11 (100%) | 11/11 (100%) | 8/8 | 3/3 | 33,490 | 21,539 | 0 |
| Sonnet | F2b saved-instructions card | 10 | 11/11 (100%) | card 11 | 11/11 (100%) | 11/11 (100%) | 8/8 | 3/3 | 38,335 | 20,882 | 0 |
| Sonnet | F2c in production code (memory reads still cost lookups) | 10 | 10/10 (100%) | routed 10 | 10/10 (100%) | 10/10 (100%) | 7/7 | 3/3 | 32,969 | 38,476 | 0 |
| Sonnet | **Final fix (as committed)** | 10 | 11/11 (100%) | routed 11 | 11/11 (100%) | 11/11 (100%) | 8/8 | 3/3 | 31,189 | 29,704 | 0 |
| Qwen | Balanced (today) | 20 | 5/20 (25%) | routed 4, searched 1 | 6/20 (30%) | 5/5 (100%) | 2/14 | 4/6 | 38,349 | 16,424 | 1 |
| Qwen | Thorough (today) | 20 | 4/20 (20%) | routed 4 | 6/20 (30%) | 4/4 (100%) | 3/14 | 3/6 | 41,603 | 26,589 | 0 |
| Qwen | Pinned "Always apply" (ceiling) | 20 | 20/20 (100%) | pinned 20 | 20/20 (100%) | 20/20 (100%) | 14/14 | 6/6 | 62,078 | 28,909 | 0 |
| Qwen | F1 prompt sentence | 20 | 12/20 (60%) | searched 8, routed 4 | 12/20 (60%) | 12/12 (100%) | 7/14 | 5/6 | 47,484 | 18,645 | 0 |
| Qwen | F2c routing + graphics category | 20 | 20/20 (100%) | routed 20 | 20/20 (100%) | 20/20 (100%) | 14/14 | 6/6 | 61,958 | 22,923 | 2 |
| Qwen | F2b saved-instructions card | 20 | 19/19 (100%) | card 19 | 19/19 (100%) | 19/19 (100%) | 13/13 | 6/6 | 64,975 | 23,357 | 0 |
| Qwen | **Final fix (as committed)** | 20 | 20/20 (100%) | routed 20 | 20/20 (100%) | 20/20 (100%) | 14/14 | 6/6 | 51,362 | 23,557 | 0 |

Plot tasks with no R plot made (not counted for "dark"): haiku thorough: 1; haiku f1: 1; sonnet base: 1; sonnet shipped: 1; qwen base: 2; qwen thorough: 2; qwen pin: 2; qwen f1: 2; qwen f2c: 2; qwen f2b: 3; qwen final: 2

**Held-out instructions** (caption on figures, UPPER CASE column names, row count in reports):

| Model | Arm | Passed | caption | upper case | rows (weak: often stated anyway) |
|---|---|---|---|---|---|
| Haiku | Balanced (today) | 2/10 | 0/4 | 0/4 | 2/2 |
| Haiku | F2c routing + graphics category | 10/10 | 4/4 | 4/4 | 2/2 |
| Haiku | F2b saved-instructions card | 10/10 | 4/4 | 4/4 | 2/2 |
| Haiku | F2c in production code (memory reads still cost lookups) | 10/10 | 4/4 | 4/4 | 2/2 |
| Haiku | **Final fix (as committed)** | 10/10 | 4/4 | 4/4 | 2/2 |
| Sonnet | Balanced (today) | 1/5 | 0/2 | 0/2 | 1/1 |
| Sonnet | F2c routing + graphics category | 5/5 | 2/2 | 2/2 | 1/1 |
| Sonnet | F2b saved-instructions card | 5/5 | 2/2 | 2/2 | 1/1 |
| Sonnet | F2c in production code (memory reads still cost lookups) | 5/5 | 2/2 | 2/2 | 1/1 |
| Sonnet | **Final fix (as committed)** | 5/5 | 2/2 | 2/2 | 1/1 |
| Qwen | **Final fix (as committed)** | 10/10 | 4/4 | 4/4 | 2/2 |
