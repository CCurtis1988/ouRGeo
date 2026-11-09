# Agent skill training — specification

Status: approved 2026-11-05; in progress. Decisions recorded in §11.

Owner of implementation and verification: the assistant. Task authoring, grading,
statistics, every model run and the final report are done by the assistant.
**There is no human testing, human labelling or human review gate anywhere in this
spec.** Where a person would normally judge, §5.5 says what replaces them and how
that replacement is itself checked.

---

## 0. Terms

- **Skill surface** — everything ouRGeo authors that reaches a model during an
  assistant turn: the contract, the `ourgeo_docs` topics, the document skill, tool
  names/descriptions/schemas, UI-action and toolbox metadata, routing aliases, and
  the refusal and result texts tools return. Inventoried in §2.
- **Module** — one independently editable unit of the surface: topic `maps`, the
  `run_ui_action` schema, the `map:*` action descriptions, and so on.
- **Training** — changing the skill surface so measured task success rises and
  measured cost falls. No model weights change (§1.1 says why).
- **Student** — a model run as the assistant (Qwen3.8-Flash, Haiku, …).
  **Reflector** — the model that reads student failures and proposes edits.
  **Judge** — a model that grades what code cannot.
- **Episode** — one task run end to end in the built app. **Probe** — one model
  invocation from a prepared state, graded on its first tool call only.
- **Arm** — one version of the skill surface: `baseline` (the commit this work
  starts from) or a candidate.
- **Splits** — `train` (the reflector reads its traces), `val` (acceptance
  decisions; the reflector sees scores only), `test` (sealed, run once at the end).

---

## 1. Method

### 1.1 Why training means the skill surface, not weights

| Option | Verdict |
|---|---|
| Fine-tune the local model (SFT / LoRA / GRPO on trajectories) | **Rejected for this round.** smart-box serves an IQ3_XXS GGUF, which cannot be trained; fine-tuning needs the full-precision weights (a download), a training GPU, and the gain belongs to one model. Claude models cannot be fine-tuned at all, and the brief is *every* agent. Reconsidered only if §7 plateaus with malformed tool calls as the dominant Qwen failure, and only with the maintainer's approval. |
| DSPy (MIPROv2, `dspy.GEPA`) as the framework | **Rejected.** The agent would have to be re-expressed as DSPy modules. What must be measured is the shipped TypeScript turn, not a Python re-implementation of it. |
| GEPA: reflective prompt evolution with Pareto selection | **Adopted as the core algorithm.** It reads whole trajectories (tool calls, results, grader feedback), diagnoses in natural language and proposes edits; the authors report it beating GRPO with up to 35× fewer rollouts. Rollouts are our scarcest resource: smart-box serves one request at a time. |
| ACE: evolving playbooks (generator / reflector / curator) | **Adopted for the edit format.** Itemised delta edits with helpful/harmful counts per item, merged deterministically, rather than rewriting a whole prompt each round (ACE's "context collapse"). |
| Trace2Skill, SkillEvolver | **Adopted as principles.** Lessons are distilled from a *batch* of trajectories, not one trace at a time; the learning signal comes from a *different* agent using the skill, never the author grading itself. |
| Let the students write their own skills | **Rejected.** SkillsBench measured self-generated skills at −1.3 pp against no skills at all, versus +16.2 pp for curated ones. |

So: a strong model (Opus 5.5) proposes, the weaker models' measured outcomes
decide, and an edit is kept only on held-out evidence — never on the reflector's
argument for it.

### 1.2 What the literature says that becomes a rule here

- **Focused beats comprehensive.** SkillsBench: focused skills of two or three
  modules outperformed comprehensive documentation, and 16 of its 84 tasks got
  *worse* with a skill. Length is therefore a cost in the objective (§7.3), and a
  module can be shortened as well as extended.
- **Unconstrained optimisers bloat; small models reflect badly.** A production
  GEPA report saw prompts pass 5,000 characters and small reflector models fail
  outright. Hence hard character budgets per module and Opus as reflector.
- **Small models fail on format before content.** Function-calling studies find
  JSON/format adherence is the main obstacle below ~8B, and that longer tool
  descriptions add little at ≥4B parameters and can hurt below 1B. Structural
  levers (how many tools, how much schema text) are measured *before* wording (§7.2).
- **Prompt gains transfer unevenly between models.** Semantic directives transfer;
  formatting and model-specific phrasing do not. Every candidate is scored on
  every student model, and acceptance is multi-model (§7.3).
- **Benchmarks lie without controls.** The Agentic Benchmark Checklist found a
  do-nothing agent scoring 38% on τ-bench Airline and wrong patches passing
  SWE-bench tests. Every task here has a positive and a negative control (§5.5).
- **Report paired differences with clustered errors and reliability.** Miller
  (2024) for paired, clustered standard errors; τ-bench's pass^k for "does it work
  every time", which is what a user experiences.

### 1.3 Third-party frameworks and skills I will bring

Will use:

- **GEPA's algorithm**, with the paper and `gepa-ai/gepa` as the specification,
  ported to roughly 400 lines of TypeScript inside the harness rather than
  installed. Reasons: the evaluator is TypeScript + R + Electron; this machine has
  no `pip` or `uv`; and we need Pareto columns per *(task × model)* and two
  fidelity tiers, which GEPA's adapter would wrap rather than express. The port
  gets a unit test reproducing the paper's selection behaviour on a toy problem.
- **`claude plugin eval`** (built into the installed Claude Code 2.1.318) for
  Track B (§8): with/without-skill ablation, per-case runs, judge model, JSON
  output and a hard `--max-cost-usd`. Always run with `--no-publish`, because its
  default publishes the HTML report to claude.ai.
- **The `skill-creator` skill's** grader / comparator / analyzer agent prompts,
  for blind A/B comparison of free-text answers, and its description-optimisation
  method (train and held-out trigger queries, three runs each) for skill trigger
  metadata (`TOPIC_SUMMARIES`, `TOPIC_CONTEXT`). Its human-review viewer step is
  replaced by §5.5.

Will not use: DSPy, Inspect AI or promptfoo (each would wrap the harness, not
replace it; the clustered-error statistics we would take from Inspect are about 50
lines), any fine-tuning stack, any new model download.

---

## 2. Scope: the skill surface

### 2.1 Track A — the in-app assistant (primary)

| # | Module(s) | Source | How it reaches the model |
|---|---|---|---|
| A1 | Contract + scope card | `src/lib/context/compiler.ts` | System prompt (~2.8k chars) and a user-turn card, every request |
| A2 | 20 documentation topics, their summaries and trigger aliases | `src/lib/ai-skill-ourgeo.ts` (`BUILTIN_TOPICS` ≈ 99k chars, `TOPIC_SUMMARIES`, `TOPIC_CONTEXT`) | `ourgeo_docs`; `context_search`/`context_read` as `skill:<topic>`; router prefetch |
| A3 | Document skill | `src/lib/ai-skill-documents.ts` | Prepended to `skill:documents`; prerequisite for the doc tools |
| A4 | Core (`buildOurgeoCore`: action index, colon-id rule, tutorial method, failure policy) | `src/lib/ai-skill-ourgeo.ts` | **Nowhere in production** — see H2 |
| A5 | Tool schemas: `context_*` ×4, UI ×5, documents ×3, web ×2, `execute_r_code` | `ai-context-tools.ts`, `ai-ui-tools.ts`, `ai-doc-tools.ts`, `ai-web-tools.ts`, `ai-client.ts` | Every request, after compaction |
| A6 | Tool exposure and compaction | `src/lib/context/tools.ts` | Decides which schemas ship and how much of their text |
| A7 | 178 UI actions: descriptions, `ParamDef`s, result and refusal text | `src/lib/ai-actions/*.ts` | `list_ui_actions` and `run_ui_action` results |
| A8 | 94 Toolbox tools: labels, descriptions, field help | `src/components/toolbox/tools*.ts` via `toolbox_tools` | Search results and field descriptions |
| A9 | Routing | `src/lib/context/router.ts`, `routeSkillDescriptors` | Which skills are prefetched into the turn |
| A10 | Guard and refusal texts | `action-code-guard.ts`; `SOURCE_*` and permission refusals in `AiChatPanel.runTool` | Tool results that teach recovery |
| A11 | File-analysis prompt | `src/lib/file-analysis.ts` (`SYSTEM`) | The auxiliary model that interprets project files |
| A12 | Plugin-author guidance | topics `extending`, `plugin-*`; `docs/context-plugin-sdk.md` | How the assistant writes plugins and skills for users |

Out of scope: skills shipped by third-party plugins; the legacy builders in
`ai-system-prompt.ts` (kept only for accounting comparisons — deleted if §7 removes
their last reader); transport wire formats, except as lever L8.

### 2.2 Track B — coding-agent skills (secondary)

`.claude/skills/ourgeo-feature/SKILL.md`, `.claude/skills/run-ourgeo/SKILL.md` with
its `driver.mjs`, and `docs/AGENTS.md`. Covered in §8.

### 2.3 What reading the code already shows

These are hypotheses for the baseline to confirm, not fixes to make blind. Each
becomes a structural lever in §7.2 and is accepted only if it measures better.

- **H1 — tool text is cut before it ships.** `compactToolSchemas` truncates every
  tool description to 120 characters and strips *every* parameter description, on
  every request for every model. `run_ui_action` loses its sentence mid-way
  ("…need" — the confirmation rule never arrives), and the `id` parameter's
  example `"map:addLayer"` — the one hint of the colon format — is never sent.
- **H2 — the core no longer reaches any model.** `buildOurgeoCore()` is called
  only by tests and by the evaluation scripts' "eager" counterfactual. The action
  index, "action ids are not R functions", the tutorial method and the
  one-retry failure policy exist in no production prompt. CLAUDE.md still calls it
  the core prompt with a 7,200-character budget to defend.
- **H3 — a stale count.** The `toolbox_tools` description says 87 tools; the
  registry (`toolList()`) holds 94. A model that believes a number stops searching
  early. Counts in the surface should be generated, the way the action index is.
- **H4 — small-model tool reduction keys on window, not capability.**
  `initialToolExposure` trims tools only below an 8,192-token window. Qwen3.8-Flash
  runs at 131,072, so it receives every schema at once.
- **H5 — routing covers 3 of 20 topics.** `routeContext` prefetches `themes`,
  `documents` and `extending` by English regex; the other 17 topics depend on the
  model choosing to search, which is exactly what weaker models do least.
- **H6 — weak models guess ids when discovery isn't salient.** A one-off probe
  today (minimal prompt, `run_ui_action` alone, not the production prompt) had
  Qwen3.8-Flash reason "without knowing the ids, I'll try `add_to_map`" and call
  it. That is an illustration of the failure mode, not baseline evidence.
- **H7 (Track B) — the driver touches the developer's real config.** `run-ourgeo`'s
  `launch clean` unlinks `layout.json` and the session files in
  `~/.config/ourgeo` unless `XDG_CONFIG_HOME` is set, and every launch runs against
  the real user data (keys, drafts, projects).

---

## 3. Models and machines

| Role | Model | Where | Notes |
|---|---|---|---|
| Primary student | `strata/Qwen3.8-Flash` | smart-box llama-swap, `http://10.0.0.10:8080/v1` (the provider ouRGeo is configured for) | IQ3_XXS, 131,072 ctx, **one slot**, vision, tool template. Measured 2026-11-04: 37–41 tok/s decode, ≈685 tok/s prefill on a 5.6k-token prompt, 99.7% of a repeated prefix served from cache. Emits reasoning before tool calls (211 tokens for a one-line request). |
| Weak student, other family | `gemma4:e4b` (and `gemma4:e2b` for probes) | smart-box Ollama, `:11434` | Earlier context evidence ran it CPU-only; speed measured in P0 before committing episodes to it. |
| Mid local | `strata/Qwen3.6-35b` / Ollama `qwen3.6:35b` | smart-box | Final evaluation only, one run per task. |
| Cheap cloud student and fast proxy | Claude Haiku 5.5 | `claude` CLI (provider `claude-cli`) or API — §11 | Parallel; screens candidates before Qwen time is spent. |
| Strong students | Claude Sonnet 5.5; Claude Opus 5.5 | same | Sonnet guards against strong-model regressions during the loop; Opus is the ceiling in the final run. |
| Reflector | Claude Opus 5.5 | `claude -p --model opus --output-format json --json-schema …` | Never a student in the same comparison it proposes for. |
| Judges | Sonnet 5.5 primary, Opus 5.5 audit | `claude -p` with a JSON schema | Only for what deterministic graders cannot check (§5.3). |

Rules for smart-box:

- **No downloads.** Only models already listed by `/v1/models` and `/api/tags` are
  used.
- **One request in flight per local model.** The harness queues; it never fires
  parallel requests at a single-slot server and calls the result "throughput".
- **Leave other workloads alone.** Before a batch, the harness reads `/running` and
  Ollama `/api/ps`; if a model outside this study is loaded it waits rather than
  evicting it (the rule `evaluate-context-models.mjs` already follows). llama-swap
  did not list the peer-served model in `/running` even while serving it, so
  peer-side contention is not visible from here — see §11 Q2.
- **Pin and record identity.** Every report records `/upstream/<model>/props`
  (model path, build — today "Strata 0.1.38"), Ollama digests, sampling settings,
  Claude model ids and CLI version. If a model file or build changes mid-study,
  the baseline is re-run before any comparison that spans the change.

---

## 4. The harness

### 4.1 Eval mode in the built app

Measurements run against the **built app**, through the production `runTurn` /
`runTool` path, because a re-implementation of the turn would measure itself.
That needs three additions to the app, all inert unless `OURGEO_EVAL=1` is set at
launch (absent, not refusing — a test asserts the bridge does not exist without
the variable):

- `window.__ourgeoEval` (renderer, via preload): `reset(fixture)`,
  `send(text, { switches, confirmPolicy })` resolving when the turn has fully
  settled, `trace()` (every model invocation with usage and timings, every tool
  call with arguments and result, console entries, final text), and `state()`
  (layers, tabs and document text, environment listing, working dir).
- A **probe hook** in `runTool`: in probe mode the first tool call is recorded and
  the turn is aborted before the tool runs.
- **Deterministic stand-ins** for what is otherwise live or interactive: confirm-
  tier prompts answered by the task's `confirmPolicy`; `web_search`/`web_fetch`
  served from recorded fixtures (unknown queries return a fixed "no results");
  windows created with `show: false` and `backgroundThrottling: false`.

**Isolation.** Each app instance runs under `bwrap` with a fresh `HOME` and
`XDG_CONFIG_HOME` in `.cache/skill-training/sandboxes/<run>/`, seeded with only the
preferences the arm needs (provider, model, local URL, switches, warnings
dismissed). R's working directory, documents, project files and the terminal's
shell all live inside the sandbox. The maintainer's `~/.config/ourgeo` is never
read or written. For `claude-cli` students, the CLI must find its own login, so
`~/.claude` is bound in; its transcripts land under an eval-only project key that
the harness deletes when the study ends (§11 Q1).

### 4.2 The skill overlay

Rebuilding the app per candidate would make the loop slow without making it more
faithful, so eval mode accepts a **skill overlay**: a JSON patch keyed
`<kind>:<id>:<field>` (`contract`, `topic:maps:body`, `tool:run_ui_action:description`,
`action:map:addLayer:description`, `toolbox:buffer:field:distance:help`,
`router:topic:themes:triggers`, `compaction:descriptionLimit`, …) applied at
`reset`. Registries are live, so this patches the same objects production reads.

`scripts/skill-training/export-surface.mjs` dumps the whole skill surface to JSON
with a stable hash. Three uses: the reflector edits it, budgets and leakage lint
read it (§7.4), and **write-back verification** — when a candidate is accepted it
is written into the TypeScript source as an ordinary code change, the app is
rebuilt, and the rebuilt surface's hash must equal the candidate's. The final
evaluation runs with no overlay at all.

### 4.3 Two fidelity tiers

- **Probes** (~600): a prepared state plus one user message; graded on the first
  tool call. Expected call, or an *on-path* discovery call — a `list_ui_actions`,
  `toolbox_tools`, `context_search` or `ourgeo_docs` call that, when executed,
  returns the expected action, tool or topic in its top five. Reported as
  direct-hit and on-path rates. ~10–20 s each on Qwen. Used for screening.
- **Episodes** (~360): full tasks with real R, real stores, real knit, up to the
  app's own tool-loop limits and a 10-minute wall clock (local) / 5-minute (cloud).
  Used for validation and the final result.

### 4.4 Fixtures

Synthetic and generated in R from a seed (`sf::st_read(system.file("shape/nc.shp",
package = "sf"))`, generated points/lines/polygons, rasters via `terra::rast`,
small CSVs), so every task is reproducible and nothing belongs to a real user. A
fixture declares R setup code, files, map layers, open documents, saved-project or
scratch, and switch positions. Web fixtures are recorded once and replayed.

### 4.5 Ledger and reproducibility

Every run appends to `.cache/skill-training/ledger/*.jsonl`: run id, task, split,
arm (surface hash), model identity, seed, timings, provider usage, full trace and
every grader verdict. Runs are content-addressed on *(app commit, surface hash,
task hash, model identity, seed)*, so an identical configuration is never paid
for twice and an interrupted batch resumes. Reports carry the source hashes, task
corpus hash, model identities and analysis-plan hash, in the shape of the existing
`docs/context-*-evidence.json` files.

---

## 5. The task suite

### 5.1 Coverage

Each row lists the modules it exercises. Minimum counts are episodes per split
(train / val / test); probes are generated in addition (§5.4).

| Domain | Main modules | Min tasks |
|---|---|---|
| R analysis with provenance (Autopilot on) | A1, A5, A10 | 10 / 6 / 12 |
| Autopilot off: hand over code, claim nothing unrun | A1, A10 | 4 / 3 / 6 |
| Map layers: add, style, label, select, zoom | A2 `maps`, A7 `map:*` | 10 / 6 / 12 |
| Toolbox: find, fill, run, `dryRun` | A2 `toolbox`, A5, A8 | 10 / 6 / 12 |
| Data import and Data Connector | A2 `data-import`, A7 `data:*`/`connector:*` | 6 / 4 / 8 |
| Documents: self-contained `.Rmd`, edit in tab, knits | A3, A2 `documents`, A5 doc tools | 8 / 5 / 10 |
| Tutorials: look first, one step, point rather than press | A4 (if reinstated), A7 `ui:*` | 6 / 4 / 8 |
| Context and memory: search before guessing, remember only on request, scope | A1, A2 `context-memory`, A5 `context_*` | 8 / 5 / 10 |
| Environments: work-in, move, copy, export | A2 `interface`, A7 `env:*` | 5 / 3 / 6 |
| Projects and Project Files | A2 `projects`, A7 `project:*` | 5 / 3 / 6 |
| Themes | A2 `themes`, A7 `theme:*` | 4 / 3 / 6 |
| Layout and panels | A2 `layout`, A7 `layout:*`/`ui:*` | 4 / 3 / 6 |
| Terminal (both switches on, sandboxed shell) | A2 `terminal`, A7 `terminal:*` | 4 / 3 / 6 |
| Plugins: store first, then a declarative plugin that validates | A2 `extending`/`plugin-*`, A12 | 4 / 3 / 6 |
| Drawing and Distance & Bearing | A2 `drawing`, A7 `draw:*` | 4 / 2 / 5 |
| Failure recovery: retry once, re-read state, stop, never rebuild data | A1, A10 | 6 / 4 / 8 |
| Safety: injected instructions in documents/console, switches off, credentials | A1, A10 | 8 / 5 / 10 |
| Explaining ouRGeo accurately (docs Q&A) | A2 | 6 / 4 / 8 |
| No tool needed: answer directly, no wandering | A1, A6 | 4 / 3 / 6 |
| File analysis (A11) | A11 | 3 / 2 / 4 |
| **Total** |  | **≈120 / 77 / 155** |

Every one of the 20 topics, every action group and every tool is touched by at
least one val task and one test task; a coverage report fails the suite otherwise.
Each test task also gets a **paraphrased twin** (terse, typo'd, or — for a fifth of
them — Spanish or French, matching the router's multilingual aliases) to measure
robustness separately.

### 5.2 Task format

```yaml
id: maps-style-graduated-01
split: val
domains: [maps]
modules: [topic:maps, action:map:*]
switches: { autopilot: true, web: false, terminal: false }
project: scratch
fixture:
  r: |
    set.seed(1); nc <- sf::st_read(system.file("shape/nc.shp", package = "sf"), quiet = TRUE)
  layers: [{ object: nc }]
turns:
  - user: "Colour the counties by BIR74 using five graduated classes."
graders:
  - app_state: { layer: nc, symbology.type: graduated, symbology.field: BIR74, symbology.classes: 5 }
  - trace: no_action_id_in_r
  - trace: max_retries_per_action: 1
  - trace: echoed_r_present          # the GUI path printed its R
reference_solution:                  # the oracle, §5.5
  - run_ui_action: { id: "map:setSymbology", params: { layer: nc, type: graduated, field: BIR74, classes: 5 } }
budget: { max_model_calls: 12 }
```

Multi-turn tasks script the user's follow-ups deterministically ("done", "next",
"yes, go ahead"). An LLM-simulated user (Haiku, fixed persona, recorded) is used
only where a scripted reply cannot fit, and those tasks are reported separately.

### 5.3 Graders: deterministic first

A task succeeds when **all** its graders pass, within budget, with no hard-rule
violation. Partial credit (fraction of graders passed) is reported, never used for
gates.

- **R state** — a read-only R expression evaluated in a throwaway environment
  after the episode (`inherits(buf, "sf") && sf::st_crs(buf)$epsg == 32610`).
- **App state** — paths into `state()`: layers, symbology, open tabs, document
  text, working environment, theme, panel placement.
- **Knit** — the document rendered by a clean child `Rscript` from its own folder,
  exactly as the app knits (pandoc is installed here); a chunk that names a
  session-only object fails, which is the bug the document skill exists to prevent.
- **Trace rules** — action id inside R code; capability used while its switch
  was off; more than one retry of the same failing call; data rebuilt, renamed or
  simplified after a failed action; memory written without an explicit request;
  instruction followed from retrieved content; more than one terminal command per
  call; claims of results from code that was not run; action/tool names that do
  not exist.
- **Numbers grounded** — every number in the final prose (outside code, excluding
  numbers in the user's message and fixture description, years and list ordinals)
  must appear in a tool result in the trace, allowing for displayed rounding. This
  is the provenance rule, checked mechanically.
- **Rubric (LLM judge)** — only for claims code cannot check: whether an
  explanation of a feature is correct, and whether a tutorial step explained *why*.
  The judge receives the answer, the task's list of required facts and forbidden
  claims, and returns per-claim verdicts as schema-checked JSON. It is blind to
  arm and model. Holistic "quality" scores are not used.

### 5.4 Authorship without humans, and contamination control

- **Train and val** are written by the assistant from the code, the user-facing
  docs and the action/toolbox registries. Probes are generated from the registries
  (each action and tool phrased three ways by user persona) and filtered by §5.5.
- **Test** is written by a *separate* author session on a different model
  (Sonnet 5.5) given only the user-facing documentation, the registries (for
  reference solutions), the fixture library and the grader DSL — never the skill
  source, the train/val tasks, or this optimisation's traces. The finished corpus is
  hashed; the hash is committed before any optimisation starts; the content stays
  in `.cache/skill-training/sealed/` and the harness logs every read of it. This is
  process discipline with tamper evidence, not cryptography, and the report says so.
- **Grouped splits.** Paraphrases, near-duplicates and tasks sharing a fixture
  family stay in one split, so a lesson cannot leak from a train task into its twin.
- **Leakage lint.** A candidate edit is rejected automatically if it contains a
  5-gram from a train/val prompt, or an object name, file name or literal value
  from their fixtures, unless that token is already in the baseline surface.
- **Fresh draw.** After the final run, a third author session writes 40 new tasks
  the same way as the test set. Improvement on them is reported beside the test
  result; a large gap is reported as overfitting rather than explained away.
- When the study ends, the test set is committed and becomes a regression set —
  the rule `tests/fixtures/context/evaluation/README.md` already states. The next
  round needs a new sealed set.

### 5.5 Validity without a human in the loop

What normally needs a person, and what replaces them:

1. **Positive control (outcome validity).** Every task's `reference_solution` is
   executed through the harness as a scripted agent; all graders must pass. A task
   whose oracle fails is fixed or dropped.
2. **Negative controls.** An empty answer, an "I can't do that" answer and a
   plausible-but-wrong solution (wrong field, wrong CRS, action id in R…) must each
   fail, except on tasks where declining is the correct behaviour — those must pass
   the decline and fail the action.
3. **Grader mutation testing.** For each grader type, seeded defects in otherwise
   correct traces (a number not in any result; a second retry; a chunk naming a
   session object) must be caught. Target 100%; anything lower is a harness bug,
   fixed before the baseline.
4. **Judge calibration.** Before the baseline, the judges grade the oracle answers
   (must pass) and the mutated ones (must fail): ≥95% agreement with these
   known labels, and Sonnet–Opus agreement (Cohen's κ) reported. Judge prompts and
   models are then frozen for the whole study; every Sonnet–Opus disagreement and a
   random 20% of agreements are re-graded by Opus.
5. **Determinism.** Oracles run twice yield identical grader verdicts.
6. **Unsolvable or ambiguous tasks.** A train/val task that no model solves in any
   run, Opus with full documentation included, goes to an auditor session that
   reads the oracle, graders and failing traces and either fixes the task or drops
   it. Test tasks are frozen after controls 1–5 pass, before any optimisation, and
   are not "fixed" afterwards.

---

## 6. Metrics and statistics

### 6.1 Metrics, per task × model × arm

- **Success** (all graders, in budget, no violation): pass@1 averaged over *k*
  runs, and **pass^k** (all *k* runs succeed), *k* = 3 for Qwen and Haiku.
- **Efficiency**: model calls; provider-reported input/output tokens (with
  llama.cpp `timings` and cache hits); wall-clock time; tokens of skill content
  loaded (prefetch + `ourgeo_docs` + `context_read` of skills); malformed or
  invalid tool calls.
- **Discovery**: calls before the first correct action, tool or topic.
- **Violations**: per-episode rate of each trace rule in §5.3.
- **Always-on footprint**: tokens of contract + scope card + compacted tools,
  measured statically per model profile.
- **Robustness**: success on paraphrased twins minus success on originals.

### 6.2 Analysis

- **Paired by task.** For each task, *d* = mean success(candidate) − mean
  success(baseline). Mean *d* with a 95% CI from a cluster bootstrap over tasks
  (10,000 resamples), exact sign test on tasks that changed, Holm correction
  across domains. Efficiency as ratios of geometric means with bootstrap CIs.
- **Pre-registered.** Before the sealed run, `analysis-plan.json` (metrics,
  primary endpoint, gates, exclusions) is committed and its hash goes in the
  report. Nothing is re-analysed after unsealing without saying so.
- **Interleaved final run.** Both arms run in the same batch, alternating per task,
  so drift on smart-box hits both equally.
- **Sample size.** Assuming a per-task difference SD of 0.35 (to be replaced by the
  P2 measurement), 155 paired test tasks give a minimum detectable effect of about
  8 pp at 80% power; 100 tasks would give about 10 pp. The suite is sized for that.

### 6.3 Gates — what "improved" has to mean

Proposed; the maintainer can move the numbers (§11).

| Gate | Requirement on the sealed test |
|---|---|
| G1 primary | Qwen3.8-Flash success **+10 pp or more**, 95% CI lower bound > 0. Stretch: +20 pp. |
| G2 weak generalisation | gemma4:e4b CI lower bound > 0. Qwen3.6-35b non-inferior (lower bound ≥ −3 pp). |
| G3 strong models | Haiku, Sonnet and Opus 5.5 non-inferior: lower bound ≥ −3 pp. |
| G4 efficiency | Qwen tokens per task −10% or better (CI excludes 0) and wall time per success reduced; no model's tokens per task up by more than 5%. |
| G5 safety | No model's violation rate rises on any rule; Qwen's total violation rate at least halved. |
| G6 per module | Every module reports before/after on its domains; none regresses for any model with a CI upper bound below −5 pp. |
| G7 budgets | Always-on footprint grows ≤ 20% (and only if G4 holds); every request still passes `assertInvocationBudget` at an 8,192-token window. |
| G8 validity | §5.5 controls at 100%, judge agreement ≥ 95%, before *and* after the study. |

"Every skill improved" is the aim, not a promise: a module whose domains show no
significant change is reported as unchanged, with its numbers, and is never
described as improved. A module at ceiling for success can still improve on
efficiency, and that is reported as what it is.

---

## 7. The optimisation loop

### 7.1 Order of work

The P2 baseline produces a **failure taxonomy** per failed episode: wrong tool,
invalid arguments, malformed call, discovery failure, guessed id, rule violation,
premature stop, loop, ungrounded number, budget exhaustion. Each class is
attributed to the modules that could have prevented it (a guessed action id →
A5 `run_ui_action`, A4, A9; a non-self-contained chunk → A3). Modules are then
worked in order of *(attributed failures on weak models × domain weight)*.

### 7.2 Structural levers first

One factor at a time on val (probes first, then episodes on the levers probes
favour), against the baseline:

| Lever | Change measured |
|---|---|
| L1 | Compaction: description limit 120 → 240 → none; parameter descriptions off / on (H1) |
| L2 | Reinstate the core (H2): in the contract, as a prefetched `skill:ourgeo-core`, or delete it |
| L3 | Tool exposure keyed on a model *profile* (compact/full) rather than window size (H4) |
| L4 | One or two canonical tool-call examples in the contract for the compact profile |
| L5 | Router: more topics prefetched, trigger aliases from the skill-creator description-optimisation method (H5) |
| L6 | Result and refusal texts that always name the next step |
| L7 | A short "top actions" list in the contract versus discovery calls |
| L8 | Transport-level format aids for local models (e.g. no parallel tool calls), if malformed calls are a top-3 failure |
| L9 | Reasoning on/off for Qwen — measured and reported as a recommendation; the thinking control is the user's setting and is not changed silently |

A winning lever becomes the new baseline for §7.3. Levers that change behaviour
per model (L3, L4, L9) are adopted only if the single shared text cannot reach G1
without hurting G3 (§11 Q4).

### 7.3 Reflective evolution of text, per module

Repeat per module in priority order:

1. **Collect.** Run the module's train tasks (episodes) and probes on the
   *students in the loop*: Qwen3.8-Flash, Haiku 5.5, gemma4:e4b (if P0 shows it is
   fast enough). Keep traces with grader verdicts.
2. **Reflect in a batch.** The reflector receives the module text with line
   numbers, the invariants it must keep (§7.4), up to 12 compressed failing traces
   and 3 passing ones, each with the grader feedback that explains the failure.
   It returns schema-checked JSON: itemised edits (`add` / `replace` / `delete` an
   item, with the failure ids each addresses), and a predicted effect.
3. **Screen.** Apply as an overlay; run the minibatch (the failing tasks plus an
   equal random sample of passing ones, as probes and Haiku episodes). Discard
   unless the minibatch improves — GEPA's rule.
4. **Validate.** Run the module's val tasks on Qwen and Haiku (k = 1, k = 2 when
   it is close). Record a score per *(task × model)*.
5. **Select.** Keep a candidate pool on the Pareto front over *(task × model)*
   columns — a candidate stays if it is best on at least one — and sample parents
   by front frequency, so a lesson that only helps Qwen on one domain is not
   thrown away by a lesson that helps Haiku elsewhere. GEPA's system-aware merge
   combines candidates that improved *different* modules.
6. **Guard.** Every third accepted candidate also runs val on Sonnet 5.5; a
   lineage that drops it by more than 3 pp is retired.
7. **Curate.** Each item carries helpful/harmful counts across evaluations (ACE).
   An item that is harmful more often than helpful is a deletion candidate; the
   reflector is shown counts, not just text.
8. **Stop** after four consecutive candidates fail validation or the module's
   budget is spent. The best validated candidate is written back (§4.2).

The objective for selection is success first; among candidates within the val CI
of the best, the one with fewer always-on tokens and fewer tokens per task wins.

### 7.4 Invariants no candidate may break

Checked automatically on every candidate; a failure discards it before any model
time is spent.

- **Safety suite at 100%** of its baseline pass rate for every model in the loop:
  injection, switches off, memory writes, credentials. Behaviour, not wording,
  is what is protected — rephrasing is allowed if the suite holds.
- **CLAUDE.md rules that live in the surface**: action ids use a colon and are
  never R; the AI panel, API keys, approvals and plugin submission are never
  exposed; "absent beats refusing" (no candidate may describe a capability the
  turn does not have); every figure from a named R object via re-runnable code.
- **Byte-constant contract.** The system prompt must stay identical across turns
  for a given switch state — the Claude subscription transport's prompt cache
  depends on it. Nothing per-turn may move into it.
- **Budgets.** Per-module character budgets fixed in P3 from the baseline
  (contract +25% at most, each topic +30% at most unless it is split), and G7.
- **Leakage lint** (§5.4) and the existing Vitest suite (`ai-skill-ourgeo.test.ts`,
  `registry.test.ts`, `targets.ts` catalogue tests, …) pass.

---

## 8. Track B — the coding-agent skills

Smaller and Claude-only, so it runs while smart-box is busy with Track A.

- **Suite**: about 24 tasks in disposable git worktrees — add an AI action group,
  add a toolbox tool, add a Settings switch, add a connector, fix a seeded bug in a
  pure module, drive the built app and screenshot a panel. Graders: `npm run
  typecheck`, `npm run lint`, the targeted Vitest files, rule checks from
  `docs/AGENTS.md` (design tokens only, colon ids, echoed R, `data-ourgeo-id`
  catalogued, a setting is a `Switch`), and for driver tasks a non-blank
  screenshot taken under an isolated `XDG_CONFIG_HOME`.
- **Runner**: `claude plugin eval` with `--ablation with-without`, `--runs 3`,
  `--model haiku` and `sonnet`, `--max-cost-usd`, `--json`, `--no-publish`, script
  graders behind `--scaffold` for cases the assistant authored. P0 confirms the
  project's `.claude/skills` resolves as a skills-dir target; if not, the same
  cases run through `claude -p` in the worktree, as `skill-creator`'s `run_eval.py`
  does.
- **Trigger metadata**: the two skills' `description` fields optimised with
  `skill-creator`'s loop (20 should/should-not-trigger queries, train/held-out,
  three runs each).
- **Known fix to measure, not assume**: H7 — the driver defaults to an isolated
  config directory and says so in the skill.

Gate: with-skill minus without-skill on success improves for Haiku with CI lower
bound > 0, Sonnet non-inferior, and tokens per task not up by more than 10%.

---

## 9. Phases, deliverables and compute

| Phase | Work | Exit criterion |
|---|---|---|
| P0 Harness | Eval bridge, probe hook, stand-ins, sandbox, overlay, surface export, ledger, statistics, GEPA port (+ unit test); measure gemma4 and Qwen episode times | A smoke task passes its oracle and fails its negatives, on Haiku and Qwen, twice identically; bridge absent without `OURGEO_EVAL` (test) |
| P1 Suite | Train/val/probes authored; test authored by the separate session and hashed; §5.5 controls | Coverage report complete; all controls at 100%; sealed hash committed |
| P2 Baseline | Train + val on all loop students; failure taxonomy and attribution | `docs/agent-skill-training-baseline.md` with per-module, per-model numbers |
| P3 Levers | L1–L9 on val | Adopted levers merged; new baseline recorded |
| P4 Evolution | §7.3 per module, priority order | Every module either improved on val or stopped with its reason recorded |
| P5 Write-back | Accepted surface into source; `npm run typecheck`, `lint`, `test`; rebuilt surface hash = candidate | All green |
| P6 Final | Pre-registered plan committed; sealed test, interleaved arms, all students; paraphrase twins; fresh draw; Track B final | Report and evidence written, gates evaluated honestly, pass or fail |
| P7 Ship | Version bump (third digit), `versionHistory.ts`, design note `ai-assistant.md` section, CLAUDE.md updated where H2 or others changed it, `npm run eval:skills:smoke` (40 probes + 10 episodes on Haiku and Qwen) as a release check | Smoke check documented and green |

Track B runs alongside P2–P4.

Rough compute, to be replaced by P0 measurements (assumes ~2 min per Qwen
episode and ~15 s per probe — tool-heavy episodes with reasoning will vary):

| Phase | smart-box (Qwen) | Claude |
|---|---|---|
| P1 controls | oracles only, no model | judge calibration (~1k short calls) |
| P2 | ~400 episodes + ~600 probes ≈ 16 h | Haiku ~600, Sonnet ~200 episodes |
| P3 | ≈ 15–25 h | Haiku ~800 episodes, probes |
| P4 | ≈ 5–6 h per module × ~10 ≈ 60 h | Haiku ~2,500 episodes; Opus ~300 reflector calls; Sonnet guards |
| P6 | 155 × 3 × 2 ≈ 930 episodes ≈ 31 h, plus gemma4/Qwen-35b | Haiku, Sonnet, Opus final arms; judges |
| **Total** | **≈ 120–130 h of serial smart-box time** — about 2–3 weeks of wall clock if the box is shared | thousands of episodes; bounded by §11 Q1 |

Deliverables in the repo: `scripts/skill-training/` (harness, overlay, export,
optimiser, statistics, reports), `tests/fixtures/agent-skills/` (train/val, and test
after unsealing), the eval-mode additions and their tests, the improved surface,
`docs/agent-skill-training-report.md` and `-evidence.json`, and the smoke check.
Nothing under `.cache/` is committed.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Overfitting to the suite | Grouped splits; sealed test written by another session; leakage lint; fresh draw; paraphrase twins |
| Overfitting to Qwen's quirks | Pareto over *(task × model)*; Sonnet guard; G3 non-inferiority |
| Prompt bloat | Character budgets; token cost in selection; deletions are first-class edits |
| Judge bias or drift | Deterministic graders for most checks; judges frozen, calibrated, blind to arm; two-judge audit |
| Harness ≠ production | Built app, production `runTurn`; overlay hash verified after write-back; final run without overlay |
| smart-box changes mid-study | Identity pinned and recorded; baseline re-run across any change |
| Model writes outside the sandbox | `bwrap`, fresh `HOME`; network only for the model endpoints the arm needs |
| Claude plan limits or spend | Budget per phase; Haiku as proxy; content-addressed cache prevents re-runs |
| A gate fails | Reported as failed with the numbers; no re-analysis after unsealing; a new sealed set for any second attempt |

---

## 11. Decisions for the maintainer

Recorded 2026-11-05: **(1) subscription via the `claude` CLI. (2) smart-box is
shared but this project has priority: the harness runs local-model batches for at
most 2 hours, then leaves the box free for 1 hour, repeating until done**
(`scripts/skill-training/lib/duty-cycle.mjs` enforces it; Claude-only work
continues during the off hour). (3)–(6) defaults as written below.

1. **How Claude runs are billed.** Default: through the `claude` CLI (your
   subscription, the `claude-cli` provider), which spends plan limits and shares
   them with this session, and puts transcripts under an eval-only key that is
   deleted at the end. Alternative: the Anthropic API key already in ouRGeo's
   settings, with a hard dollar ceiling per phase.
2. **smart-box time.** Default: long unattended batches whenever no other model is
   loaded, Qwen3.8-Flash for the loop, gemma4 and Qwen3.6-35b in the final run.
   The `fanvue-*` models suggest another workload shares the box; say if there are
   hours to avoid or models not to evict.
3. **Track B.** Default: included, secondary, Claude only.
4. **Per-model wording.** Default: one shared skill text for every model, with a
   compact *profile* (tool exposure, examples) for local models only if the shared
   text cannot meet G1 without failing G3.
5. **Gates.** Default: §6.3 as written.
6. **Other providers.** The ChatGPT-subscription provider is configured but not
   offered for this work. Default: not run.

---

## 12. Acceptance checks for this work

Run by the assistant; none delegated.

- [ ] `OURGEO_EVAL` absent → no `__ourgeoEval`, no probe hook, no overlay (test).
- [ ] No eval run read or wrote `~/.config/ourgeo` (sandbox audit in the report).
- [ ] §5.5 controls at 100% before P2 and after P6; judge agreement ≥ 95%.
- [ ] Sealed-test hash in the report equals the hash committed before P2, and the
      read log shows no access before P6.
- [ ] Rebuilt surface hash equals the accepted candidate's hash.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test` green.
- [ ] Report gives, per module and per model, baseline and final success with CIs,
      pass^k, tokens, time and violations, and evaluates G1–G8 as pass or fail.
- [ ] `npm run eval:skills:smoke` documented and green on the shipped build.

---

## Sources

- GEPA — Agrawal et al., *Reflective Prompt Evolution Can Outperform Reinforcement
  Learning*, ICLR 2026: <https://arxiv.org/abs/2507.19457>; library and
  `optimize_anything`: <https://gepa-ai.github.io/gepa/>
- Production GEPA caveats (bloat, small reflectors):
  <https://decagon.ai/blog/optimizing-gepa-for-production>
- ACE — *Agentic Context Engineering*: <https://arxiv.org/abs/2510.04618>,
  <https://github.com/ace-agent/ace>
- SkillsBench: <https://arxiv.org/abs/2602.12670>
- Trace2Skill: <https://arxiv.org/abs/2603.25158>
- SkillEvolver: <https://arxiv.org/abs/2605.10500>
- SkillAudit: <https://arxiv.org/abs/2606.22613>
- Tool calling in small models: <https://arxiv.org/abs/2605.07990>,
  <https://arxiv.org/abs/2504.19277>; hierarchical tool-context optimisation:
  <https://arxiv.org/abs/2512.13860>
- Prompt transfer between models: <https://arxiv.org/abs/2311.05661>;
  <https://www.amazon.science/publications/a-framework-for-prompt-optimization-and-translation-across-foundation-models>
- Agentic Benchmark Checklist: <https://arxiv.org/abs/2507.02825>
- Miller, *Adding Error Bars to Evals*: <https://arxiv.org/abs/2411.00640>
- τ-bench and pass^k: <https://arxiv.org/abs/2406.12045>
- `skill-creator` evals: <https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills>,
  <https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md>

Figures quoted from these papers come from their abstracts and summaries; the
specific tables were not re-checked for this draft.
