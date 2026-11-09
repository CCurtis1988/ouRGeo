# Skills

How the assistant finds, loads, and writes skills. Plan and evidence:
`~/.claude/plans/i-feel-like-we-sleepy-ullman.md`, `docs/agent-skill-diagnosis.md`.

## Why it is built this way

A training study (2026-11) found the low scores were not about skill text. They
came from how skills reach the model:

- The model was never told which skills exist. `buildOurgeoCore`, meant to say,
  reached no model.
- Search could not see skill bodies.
- Opening one skill cost 2 of 6 lookups.
- A loaded skill was gone by the next turn.
- The skill gate never recognised its own guidance as delivered.

Opus, Sonnet and Haiku scored about the same overall. One sentence that told the model a
capability existed did more than any rewording of a skill.

Every mature harness (Hermes, Claude Code, Codex, Cursor) does the same few things,
and so does this:

- A short index of every skill is always in context.
- One load tool takes an enum of real names.
- The host attaches skills the user names.
- Each skill has a mode: auto, always or manual.

## Pieces

| File | Role |
|---|---|
| `lib/skills/format.ts`, `frontmatter.ts` | SKILL.md in and out, compatible with agentskills.io (Claude Code, Codex and Hermes files import as they are). Lenient YAML subset; no dependency. |
| `lib/skills/library.ts` | Every change as a pure function, with who may do what. |
| `lib/skills/stored.ts`, `lib/skills-persistence.ts` | `skills.json` (a preference file) and project-bundle records. Each entry is re-parsed on load, and a bad one is dropped on its own. |
| `store/skills.ts` | The one writer; `revision` is what readers subscribe to. |
| `lib/skills/catalog.ts` | The one list of every skill: built-in topics, plugin skills, user skills, project skills, with on/off and mode applied. Broker sources, routing, the catalog and the manager all read it. |
| `lib/skills/tools.ts` | `use_skill` (enum of catalog names) and `save_skill`. |
| `lib/skills/turn.ts` | Skills the host attaches at turn start. |
| `lib/skills/intent.ts` | `/name` and "use your X skill", the save request, the workflow digest. |
| `ai-skill-ourgeo.ts` topic `skills` | The built-in skill about skills: using one by name, saving a workflow, and what the Skill Manager controls. It is what the assistant reads when asked how skills work. |

## Rules

- **The prompt carries the catalog only.** Each skill is one line, `name: Use when …`,
  within 3% of the window, never under 300 tokens. Descriptions are dropped from the
  end before names. The catalog depends only on the library, so the system prompt is
  byte-constant per library state; the Claude CLI cache depends on that. Bodies
  arrive as attributed evidence through the broker, never as system text.
- **Off means absent.** A switched-off skill is gone from broker sources, routing,
  the catalog and the enum. Actions that need it (`contextPrerequisites`) are absent
  from discovery too.
- **Modes.**
  - `auto`: in the catalog, and routable at turn start.
  - `always`: attached every turn by the host.
  - `manual`: absent from the catalog and the enum, and attached only when the user
    names it. Its broker source is `hostOnly`: `context_search` never returns it, and
    only the host can load it. (P5 found Opus reaching a manual skill through search
    and following it unasked; `catalog.test.ts` pins this.)

  The keyword router obeys mode as well.
- **The host attaches skills so weak models need not choose.** In order: invoked,
  always, active in this chat. At most 4, 2500 tokens each, within half the remaining
  headroom (at most 6000). `activeSkills` is stored on the chat and survives reload.
- **Lookups.** Skill and action reads cost no lookups; the token allowance still
  applies. `broker.loadSkill` takes no prefetch slot.
- **Who may do what.** These were the maintainer's decisions:
  - The assistant saves skills without asking. They are marked agent-made, keep a
    full history, and are reviewed afterwards.
  - The assistant cannot switch skills on or off, change their mode, lock, delete or
    revert them, or edit a locked, built-in or plugin skill. It archives its own
    skills instead of deleting them.
  - Imports arrive off.
  - A project skill is on only if this device approved that exact text (a content
    hash), so a bundle cannot authorise itself.
- **Names.** Lower-case and hyphenated. Built-in and plugin names are reserved;
  imports are re-keyed (`name-2`). Stored skills are `skill:@user/<n>` or
  `skill:@project/<n>`; `@` cannot occur in a plugin id.
- **A save request is not a memory.** "Turn this into a skill" is checked before the
  memory hook, and goes to the model with a digest of this chat's requests and the R
  that ran. Earlier turns are otherwise re-sent without their tool calls.
- **Projects.** `ui.skills` is optional and written only when present. It is included
  in drafts, dirty tracking (text only) and reset, is a `skill` kind in the
  three-way merge, and is counted by revert.
