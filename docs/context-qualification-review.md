# Stage 0–2 independent qualification handoff

The owner retained every current closure requirement on 12 October 2026, then
deferred independent review and the participant study because no review team is
available. They will revisit those gates if a team becomes available. Requirements
remain unchanged; neither gate passes and stages 0–2 remain uncertified.
This pack prepares that later work; it records no completed review or participant
results. Engineering automation cannot supply those results.

## Independent model evaluation

An author who did not tune the router must freeze a new task/source corpus before
implementation changes use its cases. Record the author's role, version, SHA-256,
permissions, expected current sources and an evidence-based success rubric for
each case. Preserve ambiguous identifiers, changed values, historical errors,
long-chat instructions, exclusions, malicious source text and multilingual cues.
Every quantitative answer must have current reproducible evidence or decline it.

The existing `tests/fixtures/context/evaluation/v1.json` is development data.
Its cases and their paraphrases have informed implementation; relabelling them
as held-out cases cannot certify discovery or task quality.

Freeze the sampling and analysis plan before looking at answers. Use comparable
models, source revisions, permissions, effective windows and complete retrieval
loops in both conditions. Count errors, empty answers, cancellations, follow-ups
and missing counters. Record task-level scores, critical regressions, paired
differences, category breakdowns, disagreements and uncertainty. Select enough
independent tasks to assess the specification's two-percentage-point quality
margin; cumulative turns from one dialogue are not independent samples.
Skill discovery must reach 98% within two steps and source Recall@5 must reach 95%.
Any critical provenance, scope or permission failure blocks qualification.

Blind reviewers to the condition while scoring. Give them the exact synthetic
source revision, relevant prior dialogue, final answer and reproducible operation
results. Keep the label key separate. Do not discard unsuccessful runs after
inspection. Independent reviewers must resolve discrepancies and sign the report.

The current **29-pair development packet** is available at
`.cache/stage02/model-review-evidence/pairs.md`. Its `reviews.json` contains only
pending ratings; `key.json` identifies source/report hashes. It includes source
fixture evidence and preceding reported dialogue. Old reports do not preserve
every dispatched message, so the packet does not claim exact transport replay.
It is useful for diagnosing known failures, including the compacted R CRS type
check, and cannot replace the separately authored release corpus.

## Representative usability study

Recruit ten representative users who have not rehearsed the acceptance pack.
Use disposable profiles and synthetic projects. Explain the research purpose,
collect consent, and record anonymous participant IDs rather than personal data.
Keep the facilitator's scoring instructions out of the participant task sheet.

Give each participant these tasks without navigation hints:

1. Send a schema question about a synthetic object. Find exactly what was sent
   and distinguish that receipt from the currently available source inventory.
2. Add an instruction directly, correct it, and forget it. Demonstrate which
   scope it belongs to and explain any surviving original transcript text.
3. Identify whether memory processing leaves the device for the configured
   setup, and distinguish that from sending selected context to the assistant.

Record independently for each task: completion, assistance, incorrect conclusions,
elapsed time and observed confusion. An assisted completion does not pass the
without-assistance requirement. At least eight of ten participants must complete
all required understanding tasks without assistance. Preserve negative outcomes
and aggregate counts. The owner's seven acceptance observations stay separate.

Copy this table for actual observations; blanks are unknown, not failures or passes:

| Anonymous participant | Sent context found | Memory corrected/forgotten and scope identified | Processing destination identified | Assistance needed | Overall pass | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| P01 | | | | | | |
| P02 | | | | | | |
| P03 | | | | | | |
| P04 | | | | | | |
| P05 | | | | | | |
| P06 | | | | | | |
| P07 | | | | | | |
| P08 | | | | | | |
| P09 | | | | | | |
| P10 | | | | | | |

## Other release evidence

The earlier strict offline failure is preserved in
`context-stage02-followup-evidence.json`. The later 1.16.17 packaged process-tree
capture passes after eliminating route probes and observing ring submissions;
see [the runtime follow-up](context-stage02-offline-fix.md). Shared desktop services
outside the traced tree still need separately scoped native-platform evidence.

Opaque retained-provider internal occupancy and invoice reconciliation remain
unknown. Subscription token reports and estimated-price limits cannot certify
them. Obtain provider-visible invocation/billing evidence through an authorised
configuration; do not substitute mocked transport tests or inferred zero cost.
Normal-layout synthetic scale rendering now passes after bounded tab and console
rendering, with all original records retained. Production file ingestion, other
panel combinations and transient pre-GC peaks remain outside that measured scope.

Use [the closure checklist](context-stages-0-2.md) to record each measured boundary.
Mark stages complete only after every applicable requirement has its evidence.
