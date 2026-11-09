# The Environment panel

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

## The Environment panel (`src/lib/environments.ts`)

The panel shows R's environments, and R's own shape is not the one a user
thinks in. Seven rules reconcile them, and the pure ones live in one module so
they can be tested without a session.

- **An environment the user made is an object AND a place, and the user says
  which one the panel draws.** `myenv <- new.env()` puts an environment
  *inside* `.GlobalEnv`, which is where R keeps it and what `save()`, `rm()`
  and `ls(.GlobalEnv)` see; but it is usually made to *be* somewhere, and a
  place is a sibling of `.GlobalEnv`, not a row three levels into it.
  `EnvPlacement` is per environment: `promoted` (a group beside `.GlobalEnv`
  and no row — the default) or `child` (the row).
- **`placement` is NOT R's `parent`, and must never be labelled as if it
  were.** `new.env(parent = …)` sets the ENCLOSURE — where R keeps looking
  when a name is not found inside — and every environment ouRGeo creates has
  `.GlobalEnv` there, so they all behave identically. The New Environment form
  briefly offered "Child" and "Parent" for the *display* setting; a user made
  one of each, watched ouRGeo emit the same `new.env(parent = .GlobalEnv)`
  twice, and asked what the difference was. There isn't one, and there is no
  second kind worth offering: the only other sensible parent is `emptyenv()`,
  in which even `*` cannot be found. The form no longer asks; the menu says
  "Beside .GlobalEnv" / "Inside .GlobalEnv", which is what it does.
- **One listing or the other, never both.** An environment drawn twice is a
  panel inviting the user to wonder whether there are two of them, so
  `panelEnvironments` keeps the row XOR emits the group, and
  `treeEnvironments` — what the panel maps over — drops the child entries.
  They stay in the list `moveTargets`, `loadTargets` and the Export dropdown
  read, because a child environment is still somewhere objects go. The
  consequence to hold on to: **the row has to carry everything the group
  carries** (Export…, Show, Make Copy, Rename, Remove, Move To), or choosing
  "inside" would quietly cost the user the ability to export it or move it
  back. `placement-menu.ts` is that shared submenu, and `env-export.ts` the
  shared export, precisely so the two menus cannot drift.
- **What is lifted out is still in the file.** `save(list = …, envir =
  .GlobalEnv)` writes environments too, so `PanelEnv.hoisted` carries the names
  promotion dropped from the listing and `exportedNames` adds them back —
  otherwise the echoed `save()` named fewer objects than the file it wrote.
  `userOnlyView` filters `hoisted` by the same hidden set as `objects`, or
  exporting `.GlobalEnv` would name ouRGeo's own `server` environment that the
  file (written with `excludeSystem`) leaves out.
- **Working IN an environment is the answer to the wall R puts up**
  (`src/lib/working-env.ts`). R resolves a name outwards — the evaluation
  environment, its enclosure, the search path — and never into an environment
  sitting in `.GlobalEnv`. So the moment `x` is moved into `env2`, `x * a` at
  the prompt is an error, and `env2$x` / `with(env2, …)` are the only ways in.
  That is correct R and a wall for anyone who has just found environments.
  `setWorkingEnv` points `/r/execute` at the environment (`body$envir` →
  `resolve_env` → `eval(..., envir = eval_env)`), and since its enclosure is
  `.GlobalEnv` the user gets both: `x * a` is 6, exactly as `evalq(x * a,
  env2)`. The setting lives on `rClient` as well as the store because the
  console, the toolbox and the assistant all run R through `rClient.execute` —
  a tool writing its result into `.GlobalEnv` while the user works in `env2`
  would put the object where they are not looking. Switching echoes a runnable
  `evalq({ … }, env2)` rather than a sentence about one: no R command moves the
  prompt, so the honest echo is the thing ouRGeo now does to every command —
  and `evalq` is also the idiom the user needs outside ouRGeo, in a script or a
  chunk. It is shown ON the prompt, not in a menu, and `pruneWorkingEnv` (called from `setEnvironments`, the one
  choke point every refresh passes through) drops it when the environment goes
  away, rather than letting the next command fail with a name the panel no
  longer shows.
- **The panel says how to reach an object, at the moment it becomes hard to
  reach.** Creating an environment echoes two comment lines naming `name$x`,
  `with(name, …)` and "Work in this environment"; the object menu carries
  **Copy To** beside **Move To** (same name, other environment, original kept),
  because setting an environment up to work in is usually copying, not moving.
- **The placement choice persists.** Stored sparse (only what was moved off the
  default) in `environment-preferences.json`, because an environment name
  outlives the session it was made in: open the same project tomorrow and
  `scratch` is `scratch` again. Icons say which listing you are looking at: a
  globe for `.GlobalEnv`, `Boxes` for a promoted group, a single `Box` on an
  environment's row.
- **Promotion is renderer-side, deliberately.** `!isSearchPath` is read in a
  dozen places to mean "an environment whose objects can be named directly in
  generated R" — dataset pickers, the toolbox, the AI's context block, the
  completion index. A user environment's objects cannot: they are
  `myenv$roads`. Promoting in `/env/list` would have quietly offered every one
  of them to every picker under a name that does not resolve.
- **The eye decides what you can act on, not just what you can see.**
  `userOnlyView` produces one list, and the tree, the Export dropdown, the Load
  targets and every **Move To** menu read it: with the filter on, `.GlobalEnv`
  and the user's own environments; with it off, the whole session, package
  environments included. The second filter in that function is the subtle one —
  a lifted-out group is still an OBJECT in its parent, so ouRGeo's own `server`
  environment (an environment in `.GlobalEnv`, correctly hidden while it was a
  row) comes straight back as a top-level group without it.

What the same pass fixed, all of it the same class of bug — the panel saying
one thing and R doing another:

- **`isSearchPath` was `grepl("^package:")`**, so `Autoloads` (and any
  `tools:*` entry) counted as a user environment: shown in the filtered panel,
  offered as a target for Load, and its objects listed in every dataset picker
  in the app. It is now "on the search path and not `.GlobalEnv`".
- **"Make Copy" on an environment made an ALIAS.** Environments are references,
  so `assign(new, get(old))` gives a second name for the same environment and
  the next edit through either shows up in both. `/env/duplicate` copies the
  contents (`list2env`), and the console echoes exactly that.
- **R's refusals never reached the user.** `error_response()` is HTTP 500 with
  `{success:false,error}` in the body, and axios REJECTS a 500 — so every
  caller that checked `res.success` never saw one. Creating an environment over
  a data frame, moving an object into a locked package environment, copying
  onto a name already taken: all silently did nothing. `RClient.ask()` returns
  the body for a refusal and still throws when there is no response at all,
  because that is a severed connection and `transport-retry.ts` is what knows
  the difference.
- **Export wrote ouRGeo's own functions into the user's `.RData`.** The panel's
  Export now passes `excludeSystem`, and `exportedNames` is the same set, so
  the `save(list = c(…), file = …, envir = …)` echoed to the console names
  exactly what the file holds. Several environments merge into one file, which
  no single R call does, so that case is a comment rather than a line that
  would not run.
- `/env/create` refuses a name that is not syntactic (`my env$x` is a parse
  error, so the environment would be reachable only through `get()`) and a name
  already in use, rather than overwriting a data frame with an environment.
- Searching by environment NAME still finds it. That was free when a user
  environment was a row; a promoted group would otherwise be the one thing in
  the panel search could not reach.

Right-clicking an environment gives **Export…** for any of them, plus **Make
Copy**, **Rename** and **Delete Environment** for the user's own — the last
three write to `.GlobalEnv`, and renaming `package:stats` is not a thing.
Delete is there because promotion took away the row that used to carry Remove.
