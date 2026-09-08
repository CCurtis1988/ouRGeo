# A Claude subscription as an AI provider

> **Status: shipped in 1.14.1.** Built straight through to the MCP bridge
> rather than in the phases below, at the user's direction, with settings
> isolation (`--setting-sources ""`) on. Two things the plan did not know:
> `--system-prompt-file` exists (undocumented in `--help`, verified working),
> and the chat panel's send gate asked `!isLocalProvider && !apiKey`, which
> refused every message from a provider that legitimately has no key —
> `requiresApiKey` now asks the right question. `withEarlierTurns` was added
> for a case the plan missed: a session starting mid-conversation.

## Context

`src/store/ai.ts` lists thirteen providers; every one of them is an **HTTP API
reached with a key the user pastes into Settings**. `sendMessage(opts)`
(`ai-client.ts:514`) dispatches to four transports, all of which speak HTTP
through `proxyFetch` → `electron/main/ai-proxy.ts`.

A Claude Pro/Max subscription is not an API key and cannot be turned into one.
What it *can* do is authenticate the **Claude Code CLI the user has already
installed and signed in to** — and that CLI has a headless mode (`-p`) whose
output is a stream of the same Anthropic Messages events our own Anthropic
transport already parses. So ouRGeo does not need access to anybody's credits:
it needs to be able to *ask the program on the user's machine* and read what
comes back.

**The line this plan does not cross.** ouRGeo must never read, copy, or reuse
the CLI's stored credentials — not `~/.claude/.credentials.json`, not the OS
keychain, not an OAuth token lifted from either — to call `api.anthropic.com`
itself. That is the thing that would actually be circumventing something. The
legitimate shape is the one below: spawn the user's own CLI, on the user's own
machine, at the user's own request, and let it do its own authentication. Every
design decision here follows from that.

## Verified, not assumed

Run against the installed CLI (`2.1.263`) while writing this plan, so the
phases below are engineering rather than hope:

| flag / fact | result |
|---|---|
| `--tools ""` | init event reports `"tools":[]` — every built-in tool (Bash, Read, Write, Edit, WebFetch…) gone |
| `--system-prompt <text>` | **replaces** the coding-agent prompt; ouRGeo's persona is the whole persona |
| `--output-format stream-json --include-partial-messages --verbose` | NDJSON; `stream_event.event` payloads are **verbatim Anthropic Messages streaming events** (`content_block_delta` / `text_delta`) |
| `--mcp-config '{"mcpServers":{"ourgeo":{"type":"http","url":"…"}}}'` | accepted; the server appears in the init event with a live status (`failed` against a dead port) |
| `--strict-mcp-config` | `mcp_servers` contains only ours |
| `--permission-prompts none` | anything that would prompt is denied rather than hanging a headless run |
| `claude auth status --json` | `{loggedIn, authMethod:"claude.ai", subscriptionType:"pro", email, orgName}` |
| `result` event | `total_cost_usd`, `usage.{input,output}_tokens`, `modelUsage[m].contextWindow`, `permission_denials`, `is_error`, `num_turns` |
| `rate_limit_event` | `unifiedWindows.five_hour.utilization` + `resetsAt`, and the same for `seven_day` |
| `--session-id <uuid>` / `--resume` | conversation continuity is the CLI's, not ours |
| `--bare` | **unusable here** — it says outright that OAuth and keychain are never read, i.e. it is the API-key path |

## The shape

Four pieces, three of which have a direct precedent in this repository.

### 1. `electron/main/claude-cli.ts` — the runner

Spawning belongs in main (`r-bridge.ts`, `knit.ts`, `terminal.ts` are the
precedent), and the IPC contract is `ai-proxy.ts`'s, line for line:
`claude:start` with a request id → `claude:chunk:<id>` / `claude:done:<id>` /
`claude:error:<id>`, plus `claude:abort`. Also `claude:detect` /
`claude:authStatus` / `claude:browse`, which are `r:detectInstallations` /
`r:getConfiguredPath` / `r:browseRscript` with a different binary.

Argument construction is a **pure function in its own module**
(`src/lib/ai-claude-args.ts`) so it can be pinned by a test the way the voice
services' request builders are — the same reasoning: every mistake here is a
process that exits with a message about a flag, and a builder that is exercised
only by launching Electron is one nobody exercises.

The invocation, and why each flag is there:

```
claude -p
  --output-format stream-json --include-partial-messages --verbose
  --input-format stream-json            # a message object, not an argv-length gamble
  --system-prompt <ouRGeo's prompt>     # replace, don't append
  --tools ""                            # no Bash, no Read, no Write, no WebFetch
  --permission-prompts none             # headless cannot answer a prompt
  --strict-mcp-config                   # phase 3; ignore the user's own MCP servers
  --model <alias>
  --session-id <uuid> | --resume <uuid>
  --setting-sources ""                  # verify: keep the user's CLAUDE.md and hooks out
```

`--tools ""` rather than `--disallowedTools` because an allowlist that starts
empty cannot be widened by a settings file we did not write. This matters more
than it looks: ouRGeo's whole audit story is that **everything the assistant
does appears in the R console**, and a CLI that can quietly `Bash` or `Write`
has stepped outside that. The `terminal` and `autoPilot` switches would become
decorative.

Killed on abort; a `powerSaveBlocker` for the life of the request, as raster
registration and `execute` already take (`src/lib/power-block.ts`).

### 2. `sendClaudeCli` in `ai-client.ts` — the transport

Honours `SendOptions` unchanged, which is the point: `AiChatPanel` gets no new
branch. It reads the NDJSON line stream through the existing `readLineStream`
(it already buffers across chunk boundaries, which is exactly the problem
here), and:

- `stream_event` with `content_block_delta` / `text_delta` → `onChunk`.
  **Thinking deltas are dropped**, not forwarded — `thinking_delta` and
  `signature_delta` arrive on the same channel and are not the answer.
- `result` → resolve with `result`, and `onUsage(input+output, contextWindow)`.
- `is_error` / `permission_denials` → a thrown error naming what was refused.
- Per-request console `info` entry, the rule `describeWebCall` and
  `describeVoiceCall` already follow: this leaves the machine, so it is written
  down where the user can see it.

### 3. Settings — `AiProviderSettings.tsx`

The provider has **no API-key field**, which is the whole selling point and
needs to be visible rather than merely true. In its place:

- the resolved binary (detected, or chosen with a file picker) and its version;
- the `claude auth status --json` answer rendered as *"Signed in as … · Pro"*,
  or *"Not signed in — run `claude auth login` in the terminal"* with a button
  that opens ouRGeo's own terminal panel at that command;
- a model picker over the CLI's aliases (`opus`, `sonnet`, `haiku`), not over
  `PROVIDER_MODELS` — the exact model behind an alias is the plan's business;
- **the honest paragraph**: this runs the Claude Code CLI you installed and
  signed in to; usage counts against that plan's limits, not against an API
  balance; ouRGeo never sees your credentials; whether your plan permits this
  use is between you and Anthropic's terms.

Detection has the macOS PATH problem the terminal section of `CLAUDE.md`
already documents (launchd gives a GUI app a minimal PATH, so `~/.local/bin`
and Homebrew are both invisible). Probe order: configured path → `PATH` →
`~/.local/bin/claude` → `~/.claude/local/claude` → npm global bin → Homebrew;
confirm with `--version` rather than with `existsSync`, because a stale shim is
the common failure.

Usage: the token bar is the wrong readout for a subscription. `rate_limit_event`
gives *"47% of your 5-hour window, resets 14:30"*, which is the number a
subscriber actually plans around. Feed it to a small variant of the existing
usage strip.

### 4. Tools — a loopback MCP bridge (`electron/main/claude-mcp.ts`)

This is the part that decides whether the provider is a chat box or ouRGeo's
assistant. The CLI owns its agent loop, so it will not hand us a tool call to
execute — it calls tools *it* can see. MCP is how it sees ours.

Main hosts a **loopback HTTP MCP server on 127.0.0.1**, bound to a random port
per request, guarded by a per-request bearer token, torn down when the child
exits. (Loopback servers are already the house pattern: the R server, and the
forum's PKCE redirect on 8788–8790.) It implements three JSON-RPC methods —
`initialize`, `tools/list`, `tools/call` — by hand rather than adding
`@modelcontextprotocol/sdk`; this repository has two runtime dependencies and
each one is a paragraph in `CLAUDE.md`, and three methods is not a dependency.

`tools/list` is **`SendOptions.tools` re-encoded**, so membership is decided
where it is already decided: Autopilot off means `execute_r_code` is absent
from the list rather than refused after the fact, which is the rule the web
tools set. `tools/call` round-trips to the renderer
(`claude:tool:<id>` → `onToolCall` → `claude:toolResult:<id>`), so
`AiChatPanel.runTool` runs unchanged — the confirm-tier modal, the
`action-code-guard` redirect, the console echo, all of it.

Two consequences to design for rather than discover:

- **The CLI may take many tool turns before it answers.** That is the same
  shape as the other transports' tool loops, but the wall-clock is longer and
  the abort path has to kill a child that is mid-tool-call.
- **A tool call blocks on a human** (the confirm modal). The MCP request holds
  the HTTP response open; a timeout must return a refusal the model can read,
  not a socket reset.

## Decisions worth recording

- **Not the Agent SDK.** `@anthropic-ai/claude-agent-sdk` still requires the
  CLI to be installed, so it buys a dependency and a version coupling in
  exchange for argument marshalling we can pin with a pure function.
- **Conversation state is the CLI's**, via `--session-id` on the first turn and
  `--resume` after. ouRGeo keeps its own transcript for display, and the two
  can diverge — editing or deleting a message in the panel does not edit the
  CLI's transcript. Clearing the chat mints a new uuid; that is the honest
  reset, and it is worth a sentence in the docs rather than a silent surprise.
- **`--setting-sources ""`** (verify) so the user's own `CLAUDE.md`, hooks and
  skills do not silently join ouRGeo's system prompt. A repo-level CLAUDE.md
  telling the agent to run the test suite has no business in a spatial IDE's
  chat panel.
- **Model aliases, not model ids.** `CONTEXT_SIZES` gets nothing new; the
  `result` event reports `contextWindow` per model, which is better than a
  table that goes stale.
- **The provider is "unavailable", not "misconfigured", with no CLI.** Same
  treatment as the terminal panel on an architecture with no pty prebuild: say
  which thing is missing and how to get it, do not offer a dead option.

## Phasing

Each phase is a commit with a patch bump.

0. **Spike** — mostly done above. What remains: `--setting-sources ""`, an
   `http`-type MCP server that actually answers, and behaviour when the CLI is
   signed out (the error shape drives the settings copy).
1. **Text-only provider, end to end.** `AiProvider` gains `claude-cli`; the
   runner, the transport, detection, the settings row, the console log. No
   tools — and the tool guidance in `ai-system-prompt.ts` must say so, or the
   assistant will offer to run R it cannot run.
2. **Usage and polish.** Rate-limit windows, model picker, auth status,
   sign-in affordance, abort, `powerSaveBlocker`.
3. **The MCP bridge.** Read-only tools first (`ourgeo_docs`,
   `list_ui_actions`, `read_document`) to prove the round trip, then the whole
   `SendOptions.tools` array including `execute_r_code` behind Autopilot and
   the confirm modal.
4. **Docs.** `CLAUDE.md` (the reasoning, especially the credentials line and
   `--tools ""`), `README.md`, the `ai` topic in `ai-skill-ourgeo.ts`,
   `versionHistory.ts`.

## Files

**New** — `electron/main/claude-cli.ts`, `electron/main/claude-mcp.ts`,
`src/lib/ai-claude-args.ts` + `.test.ts`, `src/lib/ai-claude-stream.ts` +
`.test.ts`, `src/components/settings/ClaudeCliSettings.tsx`.

**Modified** — `src/store/ai.ts` (`AiProvider`), `src/lib/ai-client.ts`
(`sendMessage` dispatch, `PROVIDER_LABELS`, `PROVIDER_MODELS`,
`sendClaudeCli`), `src/lib/ai-system-prompt.ts` (`buildToolGuidance` must state
this transport's tool situation), `src/components/settings/AiProviderSettings.tsx`,
`electron/main/index.ts` + `ipc.ts` (register), `electron/preload/index.ts` +
`types.d.ts`, `src/lib/ai-preferences-persistence.ts` (binary path, session
id), `CLAUDE.md`, `README.md`, `versionHistory.ts`.

**Not modified, deliberately** — `AiChatPanel.tsx`. If phase 3 needs to change
it, the bridge is wrong.

## Risks

- **Flag drift.** These are one CLI version's flags. `--version` is already
  read for the settings row; a startup check that the flags we depend on are
  present, and a specific message when they are not, beats a spawn that exits 1.
- **Terms.** ouRGeo runs the user's own CLI and stores no credential, which is
  the most defensible shape available, but it is not a licence to speak for
  Anthropic. The settings copy states what ouRGeo does and points the user at
  their own plan's terms; it must not claim endorsement, and the feature must
  not be marketed as "free Claude".
- **Windows.** `.cmd` shims need `shell: true` or an explicit `cmd /c`, which
  is the usual npm-on-Windows spawn trap; and the 8191-character command line
  is why the prompt goes through `--input-format stream-json` on stdin rather
  than argv.
- **Latency.** ~5.6 s to first token in the smoke test, against ~1 s for the
  direct API — process start, MCP handshake and the CLI's own setup. Worth
  saying in the settings copy rather than letting it read as a hang.
