# Agent skill performance: first-principles diagnosis

Measured 2026-11-06 on baseline build `804274f41e8c`. Development data only; the
sealed test has not been read. Scores are on val. Cells with few episodes are
indicative, and cells marked "pending" are being re-measured after the app-state fix.
Haiku and Qwen ran k=2, Opus and Sonnet k=1.

| Topic | Opus | Sonnet | Haiku | Qwen |
|---|---|---|---|---|
| autopilot-off | 3/3 | 3/3 | 6/6 | 5/6 |
| context-memory | 5/5 | 3/5 | 9/10 | 9/10 |
| data-import | 4/4 | 4/4 | 8/8 | 8/8 |
| docs-qa | 0/4 | 0/4 | 0/8 | 0/8 |
| documents | 3/5 | 2/5 | 4/10 | 2/10 |
| drawing | 2/2 | 0/2 | 1/4 | 1/4 |
| environments | 3/3 | 3/3 | 3/6 | 3/6 |
| failure-recovery | 3/4 | 3/4 | 8/8 | 2/8 |
| maps | 4/6 | 4/6 | 11/12 | 8/12 |
| no-tool (corrected) | 3/3 | 3/3 | 6/6 | 0/4 |
| projects | 1/3 | 1/3 | 0/6 | pending |
| r-provenance | 2/6 | 5/6 | 8/12 | pending |
| safety | 4/5 | 4/5 | 10/10 | pending |
| terminal | 2/3 | 3/3 | 4/6 | pending |
| toolbox | 3/6 | 5/6 | 10/12 | pending |
| tutorials | 2/4 | 0/4 | 0/8 | pending |
| layout, plugins, themes | 2/3, 0/3, 3/3 | pending | pending | pending |
| **Overall so far** | **49/75, 65%** | **43/66, 65%** | **88/132, 67%** | **38/76, 50%** |

Stronger models do not score higher overall, so model ability is not the main
limit. Opus's lower r-provenance and toolbox scores are unexplained and small.

## Root causes, by strength of evidence

1. **Capabilities are not advertised. Proven for tutorials.** The contract names no
   skill, topic or action; `buildOurgeoCore` reaches no model; tool descriptions are
   cut to 120 characters. One added sentence took tutorials on train from 1/18 to
   10/12 across Haiku and Sonnet, with all 12 pointing at the right control.
2. **Tool errors end turns only on local models. Proven in code and data.**
   `claude-mcp.ts` returns a thrown tool error to the model; local transports let it
   end the turn. The budget was hit in 25 of 75 Opus turns and none ended. 25 of 76
   Qwen val turns were ended by a limit or `STALE_REFERENCE`.
3. **The retrieval budget is too small for how discovery is charged. Proven in code.**
   Reading one skill or action costs 2 of 6 lookups, so a turn buys about 3 things.
4. **Skill search cannot reach skill bodies. Proven in code; effect size unknown.**
   Search covers title and summary only: `ourgeo_docs("basemap")` returns nothing
   although 39 of 40 tested facts exist in the docs. Naming the topics alone moved
   docs-qa from 7/18 to 6/12 on train, which is a small, unproven gain.
5. **Over-strict graders remain. Open.** docs-qa is 0/24 for all four models. Regexes
   reject correct synonyms and the 3-call limit is tight when reaching a fact costs
   more. Drawing tasks require `draw:addFeature` where R gave the right result.
   Unsolved for the sealed test, which cannot be opened.

## Plan

1. Fix transport parity so a tool error reaches the model on every provider.
2. Advertise capabilities in the contract within its budget: topic names and the
   point-at-a-control rule. L13 and L14 measure these on val.
3. Search skill bodies, and make an unmatched `ourgeo_docs` call list the topics.
4. Stop charging discovery like evidence, or raise the budget, then measure.
5. Measure the queued levers L1 to L12, which include the 120-character limit.
6. Run the rubric judge on stored docs-qa answers to split real errors from strict
   regexes, and add a confirmed fix only where the sealed test stays comparable.
7. Run GEPA only on what remains, and the final sealed evaluation last.

Bug fixes are reported apart from training gains.

## Progress

- **Item 1 done in code, build `f970eea4fd28`.** `sendMessage` hands a refused tool call
  back to the model on every local transport. Cancellation, `SCOPE_CHANGED` and the
  24-call cap still end the turn; `claude-cli` is unchanged. The new tests fail with
  the fix disabled. Smoke: `map-colour-01` on Qwen 3/3, answering after budget hits.
  Not yet measured: the full val run is queued after the lever stage. A
  `STALE_REFERENCE` raised before the next inference still ends the turn: that rule
  is pinned by `freshness.test.ts` and awaits L12.
- **Item 3 built as `863986ae7c68`** (transport fix plus the shortlist), measured
  against `f970eea4fd28` on Qwen and against the baseline on Haiku, where the
  transport fix is inert. **L15** (all arithmetic in R) is queued on both.
- **Item 3 code:** `ourgeo_docs` falls back to searching skill
  bodies and returns a shortlist of three topics, or the full topic list if nothing
  matches. It does not open one: ranking by mentions contains the right topic but
  does not reliably put it first.

## Lever results on val (2026-11-07)

Baselines after regrading: Opus 65%, Sonnet 64%, Haiku 63%, Qwen 43%. Lever runs are
k=2 for Haiku and k=1 for Qwen against a k=2 baseline, so Qwen cells are noisy.

| Lever | Haiku | Qwen |
|---|---|---|
| L10 word-ranked toolbox search | 63 → 63 | 43 → 48 |
| L11 soft budget | 63 → 65 | 43 → 41 |
| L12 delivered evidence of a removed object is history | 63 → 63 | 43 → 41 |
| L13 topic names in the contract | 63 → 61 | 43 → 45 |
| **L14 point-at-a-control rule, and "just answer" for how-it-works questions** | **63 → 69** | **43 → 57** |
| L1a descriptions to 400 characters | 63 → 61 | 43 → 37 |
| L1b and parameter descriptions | 66 → 66 (59 tasks) | 57 → 32 (22 tasks) |

- **L14** helped Qwen on 24 tasks and hurt 10 (sign test p = 0.024, uncorrected).
  The gain is not only tutorials (+75): no-tool +67, drawing +75, documents +40. Its
  second sentence stops over-tooling. Not yet significant after Holm across about ten
  levers; a second Qwen run is queued to match the baseline's k=2.
- **L1 refuted for Qwen.** Longer tool text made it worse, so H1 is not the problem it
  was assumed to be.
- **L11 and L12 do not move scores.** L11 cut Qwen's ended turns from 32% to 24%, but
  the rescued turns mostly still failed. The transport fix may matter less than
  expected; its full val run is queued.
- **The Qwen-Haiku gap**, on 24 tasks Haiku passes 2/2: about half the failed checks
  are in turns cut off by a limit. Then arithmetic done in prose rather than R
  (7, e.g. converting feet to metres in its head, a real provenance breach), then
  wrong reasoning about environments (7).

## Skill system work (plan: `~/.claude/plans/i-feel-like-we-sleepy-ullman.md`)

**P0, done 2026-11-08.**
- **G1 confirmed and fixed.** The skill gate never saw its own REQUIRED_SKILL guidance as
  delivered: guidance arrives JSON-escaped twice in a tool result, and the check matched
  at most one level. On the Claude CLI, delivery was only recorded at the next
  invocation, which never comes mid-run. Now `carries()` matches any escaping depth, and
  `noteToolResultReturned` records skill delivery when the result is handed back. The
  regression test fails with only this fix reverted.
- **Skill and action lookups are free.** Finding and reading `skill` and `action` sources
  no longer counts against the 3/6/10 lookup limit; the 12,000-token allowance still
  applies.
- **All 20 topics have "Use when…" descriptions** with the words users type (for
  example, "basemap" under maps). A test requires one for every topic.
- Deleting the dead `buildOurgeoCore` moves to P2, where the catalog replaces it.

**P1, done 2026-11-08.** The skill library: `src/lib/skills/`.
- `frontmatter.ts`: a lenient YAML subset; no new dependency. `format.ts`: SKILL.md in
  and out, compatible with agentskills.io, Claude Code and Hermes files.
- `library.ts`: every change as pure functions with the maintainer's rules. Assistant
  skills save at once with history and an agent-made mark. The assistant cannot switch
  skills on or off, change their mode, lock, delete or revert them, or edit locked ones.
  Imports arrive off. Project skills are on only if this device approved that exact
  text, so a bundle cannot authorise itself.
- `stored.ts` plus `skills-persistence.ts`: `skills.json` is a preference file; one bad
  entry is dropped on its own, and a file from a newer version is read-only.
  `store/skills.ts` is the single writer. `catalog.ts` is the one list that broker
  sources, routing and the manager read.
- **Effects on existing behaviour:** a skill switched off is absent from broker sources
  and routing. Turn-start routing brings in only automatic skills (the keyword router
  no longer bypasses mode). User skills are broker sources with attributed bodies
  (`skill:@user/<name>`; `@` cannot occur in a plugin id).
- **Projects:** optional `ui.skills` in the bundle, written only when present. It is
  included in drafts, dirty tracking and reset, is a `skill` kind in the three-way
  merge, and is counted by revert. A merged-in version still passes the trust rule.
- Fixed while wiring: a circular import (store, then topics, then actions, then project
  persistence, then the store) left `projectActions` undefined at load. The store now
  gets reserved names from a provider.
- Gates: typecheck and lint clean; 327 test files and 3175 tests pass.

**P2, done 2026-11-08 (code and unit tests; not yet driven in the real app).**
- **Catalog in the contract**, `buildSkillCatalog`: every on, non-manual skill as
  `name: Use when …`, within 3% of the window (300-token floor). It is byte-constant per
  library state, and the contract now names `use_skill`, not `ourgeo_docs`.
- **`use_skill`** (enum of real names, supporting files) replaces `ourgeo_docs` in the
  tool list. **`save_skill`** does create, patch and archive under the library's rules.
- **The host attaches skills at turn start** (`turn.ts`): those the user invoked (`/name`,
  "use your X skill"), always-on ones, and ones active in this chat. `activeSkills` is
  kept on the chat through reload; chat import validated it field by field and would
  have dropped it.
- **Save requests** skip the memory hook and get a workflow digest. Actions whose skill
  is off are absent from discovery.
- Bugs found by the new tests:
  - "run it with the short-report skill" captured "it with the short-report".
  - A fixed 1200-token catalog floor let a 4k-token model spend about a third of its
    window on the catalog.
- **Docs:** the stale "core is in every prompt" text in CLAUDE.md, AGENTS.md and three
  design notes is corrected. `buildOurgeoCore` is marked as sent to no model.
  New design note: `docs/design-notes/ai-skills.md`.
- Gates: typecheck and lint clean; 329 test files and 3211 tests pass.

**P3, done 2026-11-08. Verified end to end in the real app** (build `74121a22bdd7`, Haiku).
- **Skill Manager** (`components/skills/SkillManagerDialog.tsx`), a sibling dialog like the
  Theme Studio:
  - the list has filters (built-in, plugins, mine, this project, made by the assistant,
    off, archived) and search, with a whole-row Switch per skill;
  - each skill's details hold the mode, the lock, the SKILL.md editor with save and
    discard, history with restore, usage, token cost, and "Test this skill", which runs
    the same checks the chat uses;
  - actions: new, import a file or folder (arrives off), export as a folder, duplicate
    a built-in, archive or restore, and delete (confirmed with `ask()`).
  - Badges: Built-in, Plugin, Mine, This project, Imported, and "Written by the
    assistant".
- **Ways in:** Settings → AI Assistant → Skills…, a book button in the AI panel header,
  the `/` picker and active-skill chips in the composer (`SkillComposerBar`), and
  `ui:openDialog` with `skills`. There are four `data-ourgeo-id` targets, checked both
  ways by the registry test. The Context inspector already shows why each skill was
  selected.
- **Files:** `electron/main/skill-files.ts`, `dialog:openSkill` and `dialog:exportSkill`.
  Main reads a SKILL.md or skill folder within limits: text only, no links or
  dot-paths, 64 files, 512 KB each, 4 MB total. Nothing is executed.
- **End to end:**
  - A real folder import arrived off; switching it on worked.
  - "Please use your short-report skill to summarise nc" attached it as "user invoked
    skill", and Haiku followed it exactly (heading, three bullets, closing line).
  - The next turn re-attached it as "active skill", and the reply still followed it.
- **Deferred:** zip import (a file and a folder cover it); the editor is a textarea,
  not Monaco.
- Gates: typecheck and lint clean; 330 test files and 3217 tests pass.

**P4, done 2026-11-08. Verified end to end in the real app** (build `72c57a9a2fde`, Haiku).
- When the assistant saves, patches or archives a skill, a notice appears above the
  message box: "The assistant saved a new skill X", with **Review** (opens the
  manager on that skill), **Undo** (deletes it, restores the previous version, or
  unarchives) and dismiss. The notice stays if an undo fails, so it can say why.
- **Found by the real-app test and fixed:** Haiku chose `scope: project` in scratch, was
  refused, and asked the user instead of saving, so the skill they asked for was never
  made. The scope is the model's guess, so in scratch the skill is now saved on this
  computer, with a note saying so.
- **End to end:**
  - "Please turn what we just did into a skill called nc-summary" saved a good skill
    (placeholders, R as templates). The notice showed, and Haiku told the user.
  - In a new chat on different data, "Use your nc-summary skill on nc2" attached it as
    invoked and Haiku followed it.
  - Clicking the notice's Undo removed the skill.
  - **Unprompted:** after "I do this for every new parcel file I get", Haiku saved
    `parcel-area-summary` without being asked and told the user ("I also saved this
    workflow as a skill called …").
- **Harness note:** every fresh sandbox opens the first-run health check, which covers
  the AI panel. Click-driven tests must dismiss it first ("Maybe later").

**P5, done 2026-11-09.** Full results: `docs/agent-skill-results.md`.
- **Skills now reach the model.** On 60 trigger probes, Qwen went from 40% to 88% (29
  better, 0 worse) and Haiku from 43% to 68%. Both stay significant after Holm
  correction (p < 0.001).
- **Skill tasks pass on the shipped build for every model:** Haiku 16/16, Sonnet 8/8,
  Opus 8/8 and Qwen 16/16.
- **Locked test: +4 to +5 points for Haiku, Sonnet and Qwen;** none is significant on its
  own. Qwen's +12 on the tuning set shrank to +5 on the locked test.
- **Found by P5 and fixed (build `2553ff33b90b`):**
  - Opus reached a manual skill through `context_search` and followed it unasked.
    Manual skills are now `hostOnly`: search never returns them, and only the host can
    load them.
  - A new built-in `skills` topic covers how to use, save and manage skills.
- **Grader fix:** the skills-off check rejected a correct "no skill … is switched on" reply.
  I widened the regex and regraded the affected skill-task rows from their stored answers
  (Haiku 1, Qwen 1).
- **Incidents, no data affected:**
  - A laptop suspend (lid) from 17:32 to 21:11 UTC on 2026-11-08.
  - Smart-box offline from 03:23 to about 06:00 UTC on 2026-11-09. Failed rows were never
    recorded, and `resume-qwen.sh` re-ran the gap.
- **Open:**
  - `plugins` and `tutorials` score 0 on every model and both builds.
  - `context-memory` and `safety` are down slightly on all three models.
  - Qwen's `failure-recovery` is 0/8.
  - Deferred: zip import; the Monaco editor in the Skill Manager; H7 (`run-ourgeo` `launch
    clean` deletes the real `layout.json`); Track B never ran.
