# Writing code in ouRGeo

For anyone — a person or an agent — changing this repository. It is the house
style written down, so that a change made by a model reads like the code around
it rather than like a model wrote it.

If you are adding a capability **without** cloning the repo — from inside the
running app, through the AI assistant — you want plugins instead:
`ourgeo_docs({topic: "extending"})`, or [the plugin section of the
README](../README.md#extending-ourgeo).

---

## 0. The one rule everything else serves

**Every GUI operation echoes its R to the console.**

A button that filters a layer prints the `dplyr::filter()` it ran. That is what
makes a point-and-click session auditable, reproducible and editable outside
ouRGeo — and it is why the app is worth using rather than a wrapper around a
library. A feature that does something invisibly is not finished, however well
it works.

The corollary, for agents: prefer the path that emits R the user can read over
the one that gets the same result quietly.

---

## 1. Before you write anything

1. **Read `CLAUDE.md` for the subsystem you are touching.** It is long because
   it records *why*, not *what* — the failures that shaped each design. A change
   that contradicts one of those paragraphs is usually re-introducing the bug it
   describes.

2. **Read the neighbouring file before writing a new one.** The style here is
   dense and specific. Matching the file you are sitting next to matters more
   than any general convention, including ones you believe in.

3. **Search for the helper before writing one.** Five modules exist purely so
   the GUI and the assistant emit *identical* R:
   `add-spatial-layer.ts`, `load-data-code.ts`, `map-export.ts`,
   `save-edits.ts`, `codegen-shared.ts`. Re-deriving that R somewhere else is a
   bug, not duplication — the two copies drift, and the user gets different code
   from the dialog than from the assistant.

4. **Check whether it should be a plugin at all.** New connectors, new toolbox
   tools and new composed actions can all be contributed at runtime now. A
   change to the repository is for things the plugin surface cannot express, or
   for the plugin surface itself.

---

## 2. Shape

5. **Data objects plus at most one function.** `ToolDef`, `UiAction`,
   `ApiProvider`, `ThemeDef`, the markdown action catalog, the panel and toolbar
   registries — every extension point in the app is a pure data object with one
   escape-hatch function. That is what makes each surface enumerable, testable
   and documentable with no app running, and it is what made the plugin system
   cheap. Keep it.

6. **Discriminated unions over boolean flags.** `kind: 'vector' | 'raster'`, not
   `isRaster`. A third case then fails to compile everywhere it must be handled,
   instead of quietly taking the `false` branch.

7. **Pure functions where the DOM is not required.** `computeMdEdit`,
   `chunk-identity`, `roundtrip`, `layout/model.ts` — each is the logic of a
   feature with the framework removed, and each is tested without a browser. If
   a component is getting hard to test, the algorithm inside it wants to come
   out.

8. **Lift state out of a component the moment anything outside it needs to read
   or set it.** Dialog visibility moved to `src/store/ui.ts` when the assistant
   needed to open one; panel sizes moved to `src/store/layout.ts` when it needed
   to move one. Both were correct as `useState` right up until they were not.

9. **A registry that user content can extend must be LIVE.** Never
   `Object.keys(X)` captured at module load. The comment on `ParamDef.valuesAt`
   records what happens otherwise: an enum evaluated at import time could not
   contain a theme the assistant had just created, so `validateArgs` rejected
   the call before the handler that would have worked ever ran, and the model
   correctly concluded the feature was impossible. Use `valuesAt`, and mark an
   enum `lenient` when the action resolves other spellings itself.

10. **React cannot subscribe to a mutable registry.** The object identity never
    changes, so a component reading `actionList()` will not re-render. Subscribe
    to the store that carries the change signal (`usePluginRevision`,
    `useCustomThemeStore`) and call the list function.

---

## 3. Naming and ids

11. **Action ids use a colon: `map:addLayer`.** Dots are legal in R names, so
    `map.addLayer(object = "pts")` is a syntactically perfect R call — and a
    local model, asked for a tutorial, duly wrote one and told the user to run
    it. `action-code-guard.ts` catches the mistake from both directions; do not
    give it more work.

12. **Plugin contributions are namespaced by the plugin id** and can never
    shadow a shipped one. A contribution that tries is dropped, not preferred.

13. **`data-ourgeo-id` on anything the assistant may point at**, and catalogue
    it in `ai-actions/targets.ts`. A bidirectional test checks both ways, so a
    renamed button breaks the test rather than the tutorial.

---

## 4. Style

14. **Design tokens only.** `bg-geo-panel`, `text-geo-muted`, `border-geo-border`.
    Never a raw hex outside a theme definition — every theme overrides these at
    runtime, and a hard-coded colour is invisible until someone switches theme.

15. **Comments explain WHY, and record the failure that motivated the code.**
    This is the codebase's signature. Read the header of `chunk-identity.ts`,
    `persistence.ts`, or `transport-retry.ts`. A comment that restates the code
    is noise; a comment that says "this is a `write` and not a `merge` because
    the merge's read had not come back before the window was destroyed" is the
    reason the next person does not undo it.

16. **Error messages name the recovery move.** `theme.ts` is the model: a
    shipped theme refused by name, pointing at `theme:duplicate`; an unknown
    colour key answered with the valid list. "Invalid input" is not a message,
    it is a shrug.

17. **Contrast ≥ 4.5:1 for text.** It is the one failure a model cannot see, so
    it has to be checked rather than judged.

18. **British-English prose in user-facing text**, matching what is already
    there. Code identifiers stay as they are.

---

## 5. State and persistence

19. **Use `createJsonFileStore`** (`src/lib/persistence.ts`). It serialises
    writes per file, which is not optional: two overlapping writes to one path
    were observed leaving a *splice* of both payloads on disk, and an
    unparseable `theme.json` silently reverted the app to the default theme.

20. **Know which lifetime you are choosing.** Files under the app data directory
    fall into two groups:
    - **Kept between sessions** — `session.json`, `theme.json`, `layout.json`,
      `custom-themes.json`, `plugins.json`, `recent-projects.json`.
    - **Session-scoped**, deleted by the `will-quit` handler in
      `electron/main/index.ts` — `plots.json`, `spatial-layers.json`,
      `spatial-ui.json`, `console.json`, `object-tabs.json`.

    Adding a file to that delete list is a decision to state out loud, not a
    default. Adding a *preference* to it means the user re-does the work every
    launch.

21. **A flush on quit must be one round trip.** `merge` is a read-modify-write
    across two IPC calls, and the renderer is destroyed as soon as it calls
    `app:confirm-quit`. Use `write`, and `await` it.

22. **Never serialize base64 payloads into `session.json` or a `.ourgeoproj`.**
    Chunk outputs live in `src/store/chunks.ts` rather than on `TabState` for
    exactly this reason.

---

## 6. R

23. **A new R package dependency lands in three places**: the R Dependencies
    block in `CLAUDE.md`, the Requirements section in `README.md`, and a runtime
    check that names what to install. The user should never meet a raw
    `there is no package called 'x'`.

24. **Generated R is quoted, always.** A value the user typed becoming R code is
    the injection surface of this application. `rVal` / `rStr` in
    `components/toolbox/tools.ts` and `fillRTemplate` in
    `lib/plugins/contributions.ts` are the two places that do it; use them.

25. **R owns its own state.** The working directory is read back from R's
    `getwd()`, never assumed from what the picker was told to do. Anything R
    decides, ask R.

---

## 7. The AI surface

26. **A new action group touches five files**, in this order:
    `ai-actions/<group>.ts` (the actions) → `ai-actions/types.ts` (`GroupId` and
    `GROUP_LABELS`; the order there is the order the model reads the index) →
    `ai-actions/registry.ts` (import and spread) → the `prefixes` map in
    `registry.test.ts` → a behaviour test. Nothing in `ai-ui-tools.ts`,
    `AiChatPanel.tsx` or `AiPermissionsDialog.tsx` needs editing; those are all
    generated from the registry.

27. **Test an action through `validateArgs` first**, the way `run_ui_action`
    does. Calling `action.run` directly in a test hides exactly the class of bug
    that shipped once: the handler was correct and the boundary never let it
    run.

28. **Tiers**: `always` for reading and navigating, `autopilot` for anything
    touching R, disk or the user's data, `confirm` for anything destructive or
    hard to undo. Defaults live on the action; the user reassigns any of them.

29. **Never expose an API key, token or credential as an action parameter.** A
    test asserts this. Mentioning that a basemap needs one is fine; accepting one
    is not.

30. **Never give the assistant a way to close its own panel.** It can end the
    conversation it is having.

31. **The core prompt is a budget, not a place to add things.** Everything in
    `buildOurgeoCore()` is paid for on every request by every provider,
    including a local model with a 32k window. New material belongs in an
    `ourgeo_docs` topic unless the model cannot act correctly without knowing it
    up front.

---

## 8. Tests and gates

32. **`npm run typecheck` is the primary correctness gate.** Then `npm run lint`
    (zero errors; the warning count should not go up). Then `npm run test`.

33. **Test the pure function, not the component**, wherever the logic can be
    separated. Component tests opt into jsdom with a
    `// @vitest-environment jsdom` docblock at the top of the file.

34. **Watch what a test file imports.** `src/lib/layout/panel-meta.ts` and
    `panel-render.ts` exist as separate modules from `panels.tsx` because
    importing the component half pulls in Monaco, which touches `window` at
    import time and killed eight node-environment test files. If a node test
    suddenly fails with `ReferenceError: window is not defined`, an import path
    grew a React component on it.

35. **A test name is a claim in prose**, not a description of the code:
    "refuses a shipped theme and names the way out", not "returns error". Where a
    test exists because of a real incident, say so in a comment — several here
    carry the original bug report.

36. **Verify in the real app for anything visual.** `.claude/skills/run-ourgeo/`
    drives the built app with Playwright: `npm run build` first, then the driver.
    A screenshot that comes back blank means the launch failed, not that the
    change is invisible.

---

## 9. Finishing

A change is not done when it works. It is done when the next person — or the
next model — can find it.

37. **`CLAUDE.md`** — the architecture and the reasoning. If you made a
    non-obvious decision, this is where it goes. Match the surrounding voice:
    what it is, then why the obvious alternative was wrong.

38. **`README.md`** — anything user-visible: a feature, a requirement, a
    command, a new file format.

39. **`src/components/settings/versionHistory.ts`** — the release note, for a
    release. Versions are `a.b.c`: **`a` and `b` belong to the maintainer** and
    are the releases announced here, one entry each. Maintainer-announced patch
    releases may also have explicit history entries (the 1.16.0–1.16.3 series).
    **`c` is yours** — bump it
    in `package.json` with the work, once per coherent change rather than once
    per file, and do not add an entry for it. The running version is
    `package.json`'s, injected at build time (`__APP_VERSION__`); a patch bump
    needs no other edit. If a change feels release-sized, say so rather than
    bumping `b` yourself.

40. **The relevant `ourgeo_docs` topic** in `ai-skill-ourgeo.ts`. The
    assistant's knowledge is part of the feature, not documentation of it — a
    capability the model does not know about does not exist for most users.

41. **Commit messages are sentence-case and feature-framed**, naming the
    behaviour rather than the files:
    *"AI assistant: a dropped connection is not a data problem"*,
    *"Show R's working directory in the console header, and let it be changed there"*.

---

## 10. Never

42. Deep relative imports — use the `@/` alias.
43. `applyExternalContent` for an edit inside the editor; it does a whole-model
    `setValue` and destroys the cursor and the undo stack. Use `executeEdits`
    or `pushEditOperations`.
44. A native file dialog from an AI action — a picker the assistant cannot see
    or dismiss strands the tool call.
45. Widening a shared regex to fix one call site. The markdown slash menu opens
    on `/` through `CompletionResult.autoOpen` precisely because widening the
    `structural` regex would have popped the menu on `a/b`.
46. Silently swallowing an error the user needs to act on. `catch {}` is for
    genuinely optional work, and the codebase says so where it uses one.
