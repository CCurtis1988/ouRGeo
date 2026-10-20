# Independent file-analysis models: implementation and validation

Implemented in ouRGeo 1.16.25. Document and image task selections are separate
from the chat model and reuse the selected provider’s existing connection and
credentials. Defaults retain the assistant route; explicit separate selections
are saved in local settings. The image setting verifies advertised Ollama vision
capability and reports unsupported routes without silently changing models.

On-demand document interpretation receives the selected, bounded source excerpt
and question. The assistant receives the source plus clearly attributed derived
analysis. Separate image interpretation receives an authorised rendition and
returns a textual finding to the assistant. Analysis calls use production source
authority, dispatch validation, cancellation and independent usage accounting.

Optional AI descriptions are off by default. Explicit import/rescan events can
queue bounded analysis after local indexing. Enabling the switch or reopening a
project never sweeps its existing library. Cancellation, workspace changes,
source revisions, access changes and route changes revoke pending work. Metadata
persists text, source revision, provider, model, creation time and coverage,
separately from deterministic extraction descriptions and user descriptions.
Changed content invalidates old interpretations; unchanged indexing retains them.

## Native acceptance

The built Linux application, version 1.16.25, passed the native acceptance driver
on 18 October 2026. The final built-app evidence is
`.cache/file-analysis-models/run-THYKIr/report.json`. Its isolated profile and self-authored Markdown,
PNG and linked-folder fixtures exercised the real renderer, source broker, main
IPC, restricted parser, provider transports and usage accounting. Model responses
and native picker results were deterministic loopback fixtures.

The check selected document and image models through Settings, retaining the
assistant model and connection. A production context search/read sent only the
selected excerpt and question to `document-specialist`; the assistant then
received both the original source and the attributed interpretation. The actual
authorised PNG rendition reached `vision-specialist`, with its SHA-256 verified,
while the assistant received a textual finding without image bytes. An
unsupported model was rejected during selection, and an unsupported active image
route returned a clear limitation without falling back to another specialist.

Background descriptions remained off by default. Explicitly enabling them and
importing a file generated a bounded description with provider/model, source
revision, time and coverage. A changed linked-file rescan regenerated its
description. Human descriptions survived, and saving/reopening retained the
settings and provenance without making further inference requests. The fixture
observed five assistant calls, four document calls, one vision call and no
unsupported-model inference; there were no renderer errors.

Earlier evidence: `.cache/file-analysis-models/run-KUdNLj/report.json`. Each run
also contains `requests.json` and settings/generated-description screenshots.
The same check also passed against the electron-builder Linux ASAR application
(`.cache/file-analysis-models/run-yXFWXI/report.json`). The package's renderer
entry matched the final production build. In that native run, 24
visible text samples on the new Settings page had a minimum computed foreground
contrast of 5.77:1 against their composited backgrounds in the current theme.
This verifies dispatch and persistence, rather than real-model comprehension.
Windows/macOS testing and native picker pointer interaction remain deferred.

## Automated checks

The full suite passed **2,809 tests in 281 suites**. The final model-ID bound
alignment (200 characters, matching portable provenance) also passed all 23
targeted task-selection, persistence, settings and inference tests. TypeScript
and the production build passed. ESLint reported **0 errors and 37 existing
warnings**. Source changes include a first-turn hydration guard: a turn waiting
for its initial task settings must not be cancelled by that hydration itself.

Runner and queue fixtures cover independent model accounting, no tools/history/
resumed sessions, bounded/redacted evidence, actual image requirements, no
fallback, source-policy rechecks, cancellation, serial processing and workspace
status privacy. Local logs are `.cache/task-models-final-tests.log`,
`.cache/task-models-boundary-tests.log` and `.cache/task-models-lint.log`.

Reproduce after the production build:

```sh
node scripts/check-file-analysis-models.mjs
# Optional: verify an unpacked electron-builder application.
node scripts/check-file-analysis-models.mjs --packaged dist/linux-unpacked/ourgeo
```

## Shared model catalogue (1.16.26)

Document analysis now uses the same provider/model catalogue as the chat picker
and Provider & model settings. Its **Available models** control combines saved
chat choices, custom IDs, file-analysis selections, shipped API/Claude aliases
and models discovered through the existing local server or ChatGPT account.
Duplicate IDs appear once within a provider. OpenAI API billing and a ChatGPT
subscription remain separate provider connections, including when they offer
the same model ID. Selecting an analysis model neither registers another
connection nor changes the assistant model, credentials or selected account.

The built Linux application passed the dedicated native catalogue scenario on
18 October 2026: `.cache/file-analysis-models/run-CUts98/report.json`. It selected
a saved custom chat model absent from the local server response without typing
its ID again, discovered server models before any manual refresh, and displayed
a duplicated server ID only once. Existing Claude custom IDs and the `opus`,
`sonnet` and `haiku` aliases were selectable. The same ID could be selected
independently under OpenAI API and the existing ChatGPT subscription, with
distinct provider labels. Native fixture counters recorded one ChatGPT status
request and one model-list request, with **zero sign-in, account-selection or
CLI-registration calls**. No inference requests or renderer errors occurred.
Screenshots in that evidence directory were visually reviewed.

The full existing native analysis scenario also passed against the final
1.16.26 build: `.cache/file-analysis-models/run-FSPxLI/report.json` (earlier
equivalent run: `.cache/file-analysis-models/run-oArwm8/report.json`). It retained independent
document/image dispatch, bounded evidence, source provenance, unsupported-route
handling, explicit background analysis, linked-file rescans and persistence
without inference on reopen. Its request counts remained five assistant, four
document and one image call, with zero unsupported-model calls. The 26 sampled
settings text elements had a minimum computed contrast of **5.77:1**; there
were no renderer errors.

The dedicated catalogue scenario also passed against the final Linux ASAR
package: `.cache/file-analysis-models/run-i9edAh/report.json`. It repeated all
catalogue checks, observed the same one status/one model-list request and zero
registration calls, and reported no inference requests or renderer errors.

The catalogue scenario uses synthetic existing-account status/model lists and
Claude installation status at the native IPC boundary. It verifies model
selection and absence of registration calls without signing into external
accounts or qualifying real-model interpretation. Windows/macOS testing remains
deferred.

The complete automated suite passed **2,819 tests in 284 suites**. After the
final signed-out subscription guidance regression test was added, all **41
focused catalogue, account, settings and registry tests** passed. Final
TypeScript and production builds passed. ESLint reported **0 errors and 36
existing warnings**, one fewer warning than the previous release.

Reproduce the additional scenario after building:

```sh
node scripts/check-file-analysis-models.mjs --shared-catalogue
node scripts/check-file-analysis-models.mjs --shared-catalogue --packaged dist/linux-unpacked/ourgeo
```
