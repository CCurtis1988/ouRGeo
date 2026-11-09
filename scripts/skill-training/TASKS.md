# Skill-training task format

Tasks are JSON arrays in `tests/fixtures/agent-skills/<split>/*.json`. Each task is
one user request to ouRGeo's AI assistant, run in a fresh workspace, graded by
code. Spec: `docs/agent-skill-training-spec.md` §5.

```json
{
  "id": "maps-colour-03",               // unique, kebab-case, domain prefix
  "domains": ["maps"],                    // coverage table rows (spec §5.1)
  "modules": ["action:map:setSymbology", "topic:maps"],  // surface keys most responsible
  "switches": { "autopilot": true, "web": false, "terminal": false },   // defaults shown
  "confirm": "approve",                   // how confirm-tier prompts are answered
  "fixture": {
    "r": "R code run before the turn (build every object the task needs)",
    "layers": ["objectName"],             // added to the map before the turn
    "documents": [{ "fileName": "a.Rmd", "content": "...", "language": "rmarkdown" }]
  },
  "turns": [{ "user": "What the user types." }],   // more turns = scripted follow-ups
  "graders": [ { "<type>": <spec> } ],    // ALL must pass
  "rules": { "max_retries": 1 },          // override default trace rules (rarely)
  "reference": { "steps": [...], "answer": "..." },  // oracle: must pass every grader
  "wrong":     { "steps": [...], "answer": "..." },  // plausible mistake: must FAIL
  "probe": { "tool": "run_ui_action", "where": "i.id === 'map:setSymbology'" }
}
```

## Fixture data

Only data reproducible offline from installed packages:
`sf::st_read(system.file("shape/nc.shp", package = "sf"), quiet = TRUE)` (100 NC
counties, NAD27/EPSG:4267; columns AREA PERIMETER CNTY_ CNTY_ID NAME FIPS FIPSNO
CRESS_ID BIR74 SID74 NWBIR74 BIR79 SID79 NWBIR79), points/lines built with
`sf::st_sample`/`sf::st_sfc` after `set.seed()`, rasters via
`terra::rast(system.file("ex/elev.tif", package = "terra"))`, data frames built
inline, `datasets::` (mtcars, iris, quakes — quakes has lat/long/depth/mag/stations).
Files the task needs are written by the fixture R into the working directory.

## Steps (reference / wrong)

`{ "r": "code" }` runs R · `{ "action": "map:addLayer", "params": {…} }` runs an
interface action · `{ "document": "full text" }` replaces the active tab ·
`{ "tool": "name", "input": {…}, "result": "…" }` records a call without running it.

## Graders

| type | spec | passes when |
|---|---|---|
| `r_state` | R predicate (use `envir = globalenv()` with `exists`) | TRUE after the episode |
| `app_state` | JS over `s` = `{ layers:[{name, envName, kind, visible, symbology:{fillColor, fillColorBinding:{column,scale}}, labels:{field, enabled}, opacity}], tabs:[{fileName, language, content}], theme, highlight, switches, workingDir }` | truthy |
| `tool_called` | `"name"` or `{ "name", "where": "JS over i (input)" }` | some call matches |
| `tool_not_called` | tool name | never called |
| `max_tool_calls` | number | at most N calls |
| `answer_regex` / `answer_not_regex` | regex, case-insensitive | final text matches / doesn't |
| `rubric` | `{ required: [claims], forbidden: [claims] }` | an LLM judge finds every required claim in the answer and no forbidden one. Only for what regex cannot check: whether an explanation is correct, or a step says why. Claims are short factual sentences. Never use it for a number, a name or anything a deterministic grader can check. |
| `numbers_grounded` | `true` | every number in prose came from a tool result |
| `no_unrun_claims` | `true` | no "I ran / the result is" without running R |
| `r_code_not_regex` | regex | no executed R matches |
| `knits` | tab fileName | the document knits in a clean R session |

Default trace rules on every task: no action id written as R, at most one retry
of a failing call, no invented tools or action ids.

Rules for good tasks: grade the OUTCOME, not one path to it (accept any route a
competent user would accept); never require wording; a wrong solution must be a
mistake a real model plausibly makes; numbers in graders must be computed from
the fixture, never guessed.
