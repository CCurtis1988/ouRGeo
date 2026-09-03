---
name: ourgeo-feature
description: House rules for writing code in the ouRGeo repository. Load before adding or changing a feature here — a new AI action group, a data connector, a toolbox tool, a panel, a dialog, or anything touching persistence, themes or generated R. Not for using the app; for changing it.
---

# Changing ouRGeo

Read **`docs/AGENTS.md`** first — it is the full list, and it is short enough to
read in one pass. This file is the part you need in your head while working.

## The rule everything serves

**Every GUI operation echoes its R to the console.** A feature that does
something invisibly is not finished. Prefer the path that emits readable R.

## Before you write

- Read the `CLAUDE.md` section for the subsystem. It records *why*, and a change
  that contradicts it is usually re-introducing the bug it describes.
- Read the neighbouring file. Matching it beats any general convention.
- Look for the helper first: `add-spatial-layer.ts`, `load-data-code.ts`,
  `map-export.ts`, `save-edits.ts`, `codegen-shared.ts` exist so the GUI and the
  assistant emit *identical* R.
- Ask whether it should be a **plugin** instead — connectors, toolbox tools and
  composed actions can be contributed at runtime. See `docs/AGENTS.md` §1.

## Per-task checklists

**A new AI action group** — `ai-actions/<group>.ts` → `GroupId` +
`GROUP_LABELS` in `ai-actions/types.ts` → spread into `ai-actions/registry.ts` →
the `prefixes` map in `registry.test.ts` → a behaviour test that runs
`validateArgs` *before* `action.run`. Nothing else needs editing; the tools,
the prompt index and the permissions dialog are all generated.

**A new data connector** — implement `ApiProvider` in
`src/lib/api-connectors/`, register it in that directory's `registry.ts`. If it
is a plain JSON REST API, write a declarative spec instead
(`api-connectors/declarative.ts`) and prove it with a test that compares its
generated R against a hand-written provider's.

**A new toolbox tool** — a pure data `ToolDef` in `components/toolbox/tools.ts`
or `tools-raster.ts`. Quote every value with `rVal` / `rStr` / `colList`.

**A new dialog** — `DialogId` + `DIALOG_IDS` + `DIALOG_LABELS` in
`src/store/ui.ts` (a test asserts all three agree), render it as a sibling in
`EditorLayout`, and add a `data-ourgeo-id` plus a `targets.ts` entry for
anything the assistant should point at.

**A new panel** — metadata in `lib/layout/panel-meta.ts`, renderer in
`lib/layout/panels.tsx`. Keep them separate: importing the component half from
a non-React module pulls in Monaco and breaks every node-environment test.

## Style, in one paragraph

Data objects plus at most one function. Discriminated unions over booleans.
Design tokens (`bg-geo-panel`), never a raw hex. Comments explain *why* and
record the failure that motivated the code. Error messages name the recovery
move. Action ids use a colon — a dot makes a valid R call, and a model once
told a user to run one.

## Gates

```bash
npm run typecheck   # the primary correctness check
npm run lint        # zero errors; the warning count must not rise
npm run test
```

For anything visual, drive the real app: `npm run build`, then the
**run-ourgeo** skill in this repo. A blank screenshot means the launch failed.

## Finishing

Not done when it works — done when it can be found. Update `CLAUDE.md` (the
reasoning), `README.md` (anything user-visible), `versionHistory.ts` (the
release note, and the app's version number), and the relevant `ourgeo_docs`
topic in `ai-skill-ourgeo.ts` — the assistant's knowledge is part of the
feature, not documentation of it.

Commit messages are sentence-case and feature-framed: *"AI assistant: a dropped
connection is not a data problem"*.
