# Skill system: measured results (P5, 2026-11-09)

What the skill system (plan P0 to P4) changed, measured with the harness in
`scripts/skill-training/`. Regenerate the main table with
`node scripts/skill-training/p5-report.mjs`.

- **Before** is build `804274f41e8c`, the baseline with no skill system.
- **After** is build `cbd55cab280d`, the skill system as measured.
- **Shipped** is build `2553ff33b90b`. It adds two changes after the measurement: manual
  skills can no longer be found through search, and there is a new built-in `skills`
  topic. Its only measurement is the skill-task table below.
- The locked test is the sealed split (151 tasks). Its manifest was verified before P5,
  and nothing read it except these runs.

## Summary

- **The skill system did what it was built for: skills now reach the model.**
  - On 60 trigger probes, Qwen went from 40% to 88% and Haiku from 43% to 68%. Qwen
    gained on 29 probes and lost on none.
  - Both results stay significant after Holm correction across all 9 comparisons.
- **The skill system works end to end on every model.** Across the 8 skill tasks,
  every model passed every run on the shipped build.
- **Task scores rose a little, but not significantly for any one model.**
  - On the locked test, Haiku gained 4 points, Sonnet 5 and Qwen 5.
  - None of the three is significant on its own after Holm correction.
  - Together they show 50 tasks better and 29 worse. That would give a sign test of
    p = 0.024, but pooling was not planned in advance, so it is a pointer, not a finding.
- **Qwen's tuning-set gain of 12 points** (CI 4 to 21) did not fully carry over to the
  locked test, where it gained 5.

## Before and after, paired by task

| Test | Model | Tasks | Before | After | Change (95% CI) | Better / worse | p (Holm) |
|---|---|---|---|---|---|---|---|
| Locked test | Haiku | 151 | 50% | 54% | +4 (−3 to 11) | 16 / 10 | 1.000 |
| Locked test | Sonnet | 151 | 57% | 62% | +5 (−2 to 11) | 16 / 9 | 1.000 |
| Locked test | Qwen | 151 | 42% | 47% | +5 (−1 to 13) | 18 / 10 | 1.000 |
| Tuning set | Haiku | 75 | 63% | 63% | −1 (−8 to 7) | 8 / 7 | 1.000 |
| Tuning set | Sonnet | 75 | 64% | 64% | +0 (−8 to 8) | 5 / 5 | 1.000 |
| Tuning set | Opus | 75 | 65% | 69% | +4 (−5 to 13) | 8 / 5 | 1.000 |
| Tuning set | Qwen | 75 | 43% | 55% | +12 (4 to 21) | 20 / 8 | 0.250 |
| Skill reaches the model (60 probes) | Haiku | 60 | 43% | 68% | +26 (14 to 38) | 21 / 2 | <0.001 |
| Skill reaches the model (60 probes) | Qwen | 60 | 40% | 88% | +48 (35 to 62) | 29 / 0 | <0.001 |

**Notes:**
- **Models:** Qwen is Qwen3.8-Flash on smart-box. Haiku, Sonnet and Opus ran through the
  Claude subscription.
- **Not run:** Opus did not run on the locked test, to save quota.
- **Runs:** probes ran twice for Haiku and once for Qwen. Rates are per task.

## Skill tasks

These tasks test the skill system itself, so there is no "before":

- using a skill the user names;
- an always-on skill;
- leaving alone a skill that is switched off;
- leaving alone a skill set to "only when I ask";
- saving a workflow;
- using a saved skill in a new chat.

| Model | Measured build | Shipped build |
|---|---|---|
| Haiku (2 runs) | 16/16 | 16/16 |
| Sonnet | 8/8 | 8/8 |
| Opus | 7/8 | 8/8 |
| Qwen (2 runs) | 16/16 | 16/16 |

**Opus's miss on the measured build was a real bug.** Opus found a skill set to "only
when I ask" through `context_search` and followed it unasked. On the shipped build,
manual skills are invisible to search and only the app can attach them. A test pins
this, and Opus now passes.

## Locked test by topic (before → after, passes)

| Topic (tasks) | Haiku | Sonnet | Qwen |
|---|---|---|---|
| maps (12) | 8 → 10 | 9 → 12 | 7 → 9 |
| layout (6) | 2 → 4 | 3 → 4 | 2 → 4 |
| terminal (6) | 2 → 3 | 2 → 3 | 2 → 4 |
| docs-qa (8) | 2 → 3 | 1 → 2 | 0 → 1 |
| drawing (5) | 0 → 0 | 1 → 3 | 1 → 2 |
| themes (6) | 3 → 3 | 5 → 5 | 0 → 2 |
| projects (6) | 1 → 1 | 3 → 5 | 3 → 3 |
| r-provenance (12) | 6 → 8 | 7 → 8 | 6 → 6 |
| documents (10) | 7 → 8 | 6 → 7 | 4 → 4 |
| context-memory (10) | 5 → 4 | 7 → 5 | 5 → 3 |
| safety (10) | 5 → 5 | 6 → 4 | 5 → 4 |
| toolbox (12) | 8 → 8 | 9 → 8 | 8 → 8 |
| plugins (6) | 0 → 0 | 0 → 0 | 0 → 0 |
| tutorials (8) | 0 → 0 | 0 → 0 | 0 → 0 |
| failure-recovery (8) | 3 → 3 | 4 → 4 | 0 → 0 |

data-import, environments, autopilot-off and no-tool barely change and are left out.

## What this points to next

- **`plugins` and `tutorials` score 0 on every model and both builds.** When even Sonnet
  scores 0, the cause is either the grader or a capability the app does not give the
  model. That needs a first-principles look before any skill text is changed.
- **`context-memory` and `safety` are down 1 to 2 tasks on all three models.** Each fall
  is small on its own, but they all point the same way. Check whether the catalog's
  extra prompt text, or attached skills, push out memory evidence or safety wording.
- **Qwen's `failure-recovery` is 0/8 on both builds.** Qwen tends to keep calling tools
  past the limit (8 to 14 calls where 5 or 6 are allowed), not stop and report.

## Incidents during the run (no data affected)

- **The laptop suspended from 17:32 to 21:11 UTC on 2026-11-08** (lid). The watchdog
  dropped the request that was in flight; nothing was recorded for it.
- **Smart-box went offline from 03:23 to about 06:00 UTC on 2026-11-09.** Every Qwen task
  in that window gave up after 3 attempts and was not recorded.
  `.cache/skill-training/resume-qwen.sh` re-ran the gap from the ledgers. It now waits
  for smart-box before and after each run.
- **One grader was too strict.** It rejected a correct "no skill called short-report is
  switched on" reply. I widened it and regraded the affected skill-task rows from their
  stored answers (Haiku 1, Qwen 1). The locked test was not affected.
