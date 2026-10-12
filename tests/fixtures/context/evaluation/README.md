# Context evaluation fixture version 1

Run `node scripts/evaluate-context.mjs`. The machine-readable report is written
to `/tmp/ourgeo-context-evaluation.json`. It uses only this synthetic corpus,
actual broker/routing/reference bodies and the current four context tool schemas.
No R, model, personal profile, external provider, download or paid operation runs.
The report hashes the fixture, reference metadata/body and relevant implementation
files for reproduction. The 32,000-token window and 4,000-token output reservation
are explicit; the schema and complete tool-call/result wrappers use a representative
OpenAI-shaped full-message envelope, without issuing any transport request.

The mixed 20-turn conversation contains 15 positive source questions, scope and
exclusion probes, exact and ambiguous environment identities, console causal
commands, conflicting project/global preferences, CRS decisions, multilingual
plugin discovery and malicious source text. It scripts search and one relevant
read after each applicable initial invocation. The selected read is an oracle
choice: it does not measure a model's selection skill. All resulting inference
envelopes are counted, including follow-ups. No assistant quantitative answer is
invented. Exact identifiers and units remain in the fixture evidence.

The legacy comparison uses the real older application/document contract builders,
the same scheduled calls/dialogue/context tool schemas and authorised fixture
resource descriptors. Its action index, full legacy tool definitions and console
bodies are omitted. This conservative synthetic counterfactual is **not** a run
of the legacy app or evidence of comparable answer quality, billed savings,
retained-transport occupancy or provider tokenisation. Zero-auxiliary gates concern
fresh simple turns; the cumulative conversation can still contain past dialogue.

`heldOutSkills` was authored after the current router and descriptor implementation
and includes paraphrases plus Spanish and French requests. Initial failures are retained in `initial-observations-v1.json`: 75% skill
discovery and 93.33% source Recall@5. Their envelope accounting predates the
OpenAI-wrapper refinement, so do not compare that initial token total as an
apples-to-apples cost baseline. Once any case is used to tune aliases, it becomes a development
regression case, not an independent hold-out. Freeze a new separately authored
corpus before reporting a release recall target. The current development result still misses “Evaluate inundation risk for these
property polygons”: the fixture plugin declares flood-exposure aliases, not this
synonym. A plugin's undeclared synonym cannot be inferred as an authorised capability by a deterministic alias router.

The host removes unauthorised resources before broker search. These probes show
that this fixture boundary and broker exclusions work; they do not certify main
IPC leases or all project/user isolation. Concurrency, epoch, stale reference,
secret, prerequisite and revocation tests live in the corresponding broker/main
suites. The larger 10,000-object/100,000-console/100,000-document/200-plugin scale
measurement runs separately through `scripts/benchmark-context.mjs`.

## Remaining release evaluation protocol

1. Freeze an independently authored versioned task/source corpus before tuning.
   Include multilingual negative cues, same-name environments, values changed
   without shape changes, attachment edits, noisy failures, plugin disable races,
   long-conversation early constraints, exact units and conflicting preferences.
2. Run legacy and broker tasks on the same source revision, permissions and model:
   a small local tool-capable model, hosted full-message model, and retained
   transport. Record immutable model/runtime versions, effective windows,
   settings, tokenizer identity, cache/reasoning/output usage and all invocations.
   Live paid evaluations need an explicit configured evaluation budget.
3. Record complete-task success independently from router/source recall. Include
   every retrieval/summarisation/extraction round, maintenance usage, timed-out
   calls and cancelled requests where billing is possible. Label unknown costs.
   Compare absolute tokens, total cost and uncertainty, not just first prompts.
4. Have blinded human reviewers verify a representative subset of answers against
   current evidence and reproducible operations. Critical provenance, scope and
   permission failures are blockers regardless of average model scores. Record
   sample size, disagreements, confidence intervals and category breakdowns.
5. Recruit ten representative usability participants. At least eight must locate
   the exact sent context, correct/forget a memory, and identify processing
   destinations without assistance. Keep participation and outcomes separate
   from synthetic automation and do not manufacture completed participant data.
6. Report passing and failed targets together. Synthetic scores cannot close
   model quality, supported-platform packaging/protection or human usability gates.
