# ChatGPT and Claude subscription providers

> Design notes moved verbatim out of CLAUDE.md (2026-10-20). Rationale and history behind the code; CLAUDE.md keeps the summary.

### ChatGPT plan usage (`chatgpt-subscription.ts`, `ai-chatgpt-transport.ts`)

`openai-subscription` uses OpenAI's official **Sign in with ChatGPT** public-client
flow for open-source desktop apps. First registration uses `dynamic_agent_client`
and a persistent host ID; the callback's issued client ID, never the entrypoint
ID, is used for exchange, refresh and returning sign-in. PKCE, state and nonce
bind the callback to the attempt. The ID token's signature, issuer, audience,
expiry and nonce are verified before credentials can replace a registration.
Account registrations stay separate even when they have the same email.

Tokens remain in main, protected with Electron `safeStorage`; Linux's
`basic_text` backend is treated as unavailable. Without a keyring, credentials
last for this process only. `chatgpt-accounts.json` keeps the host/account/client
mapping; `chatgpt-session.bin` holds encrypted credentials. Both survive quit.
Their writes are serialised from one snapshot and replaced atomically in main:
the renderer's JSON store cannot own a credential it must never receive.
Rotating refreshes are serialised per registration. Temporary failures preserve
the grant; terminal refresh errors clear it. Sign-out stops requests and attempts
remote revocation, with a visible recovery message when it cannot be confirmed.

Main attaches the bearer token only to `POST https://api.openai.com/v1/responses`.
Each request is bound to the account selected at the start of the turn, so an
account change between tool calls cannot charge the next account. The account's
`/v1/models` catalog supplies the picker; no subscription model list is hardcoded.
Inference sets `store: false`, `stream: true`, supplies explicit history and groups
the existing tools under the `ourgeo` namespace. Tool execution still goes through
the panel's normal switches and permission tiers. Only `response.completed` is
success: usage-limit failures after streaming and interrupted answers are errors.
Completed output items and text/refusal done events are retained alongside
streamed deltas, with missing suffixes emitted once. The terminal output array
is merged with streamed items rather than replacing them: losing a streamed
function call silently ended the tool loop, and losing message items produced
empty replies. Reasoning-only and commentary-only completions now raise an error.
Visible assistant messages retain their `commentary`/`final_answer` phase in chat
history and replay; flattening that distinction can make later models stop at a
preamble. Raw reasoning items stay in the current tool loop only, never persisted.
There is no automatic switch to API billing, and voice transcription remains its
own service because this subscription route does not support the transcription API.

Official references: [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[accounts and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

### A Claude subscription as a provider (`ai-claude-args.ts`, `electron/main/claude-*.ts`)

The API providers use a key the user pastes into Settings. A Claude Pro/Max subscription is not a key and cannot be turned into
one — but it authenticates the **Claude Code CLI the user already installed**,
and `claude -p --output-format stream-json` wraps the *verbatim Anthropic
Messages streaming events* `sendAnthropic` already parses. So ouRGeo does not
need access to anybody's credits; it needs to ask the program on the machine.

- **The line this must never cross.** ouRGeo does not read, copy or reuse the
  CLI's stored credentials — not `~/.claude/.credentials.json`, not the OS
  keychain, not a token lifted from either — to call the API itself. It spawns
  the user's program and lets it authenticate. Nothing in this code should ever
  need to know what a Claude token looks like. `--bare` is therefore unusable
  here: it says outright that OAuth and keychain are never read, i.e. it is the
  API-key path.
- **`--tools ""`, not `--disallowedTools`.** Every built-in tool off — Bash,
  Read, Write, Edit, WebFetch. An allowlist that starts empty cannot be widened
  by a settings file ouRGeo did not write, and the whole audit story is that
  what the assistant does appears in the R console. A CLI that can quietly
  `Write` has stepped outside it, and the Autopilot, Web and Terminal switches
  become decorative. `--setting-sources ""` and `--strict-mcp-config` are the
  same argument for the user's own CLAUDE.md, hooks, skills and MCP servers: a
  repository instruction telling an agent to run the test suite has no business
  in a spatial IDE's chat panel.
- **The CLI owns the agent loop, so tools reach it over MCP.** It does not hand
  a tool call back to its caller; it calls tools *it* can see.
  `electron/main/claude-mcp.ts` is a loopback HTTP MCP server — three JSON-RPC
  methods, hand-written, because this repository has two runtime dependencies
  and each is a paragraph here. `tools/list` is `SendOptions.tools` re-encoded
  and `tools/call` round-trips to the renderer, so **`AiChatPanel.runTool` is
  untouched**: the same switches, the same confirm modal, the same console
  echo, decided in the same place. If a change to this provider needs to edit
  `AiChatPanel`, the bridge is wrong. Bound to 127.0.0.1 on a random port with
  a per-run bearer token, closed when the child exits.
- **A tool call can block on a human.** The confirm-tier modal holds the MCP
  request open; the timeout is ten minutes and returns a refusal the model can
  *read*, because "the user has not decided yet" is not a severed socket.
- **The CLI owns the transcript**, so continuity is `--session-id` then
  `--resume`, not the message array every other transport posts. Clearing the
  chat mints a new session — leaving it would resume a conversation the user
  just said to forget. `withEarlierTurns` covers the other direction: a session
  starting mid-conversation (the user switched provider) is handed a bounded
  catch-up block, or a follow-up would be answered by a model that had silently
  forgotten the question it follows.
- **The system prompt goes in a file and the user turn on stdin.** Both carry
  selected evidence and the current scope card, and Windows caps a command
  line at 32,767 characters. The MCP
  config is a file for a second reason: a `.cmd` shim has to be spawned through
  the shell on Windows, and a shell would have to quote a blob full of braces
  and quotes correctly on the one platform this repository cannot test.
- **The session context rides the USER turn, never the system prompt** — the
  one decision in this provider with a price tag on it. Claude Code caches the
  prompt prefix, and the system prompt is the front of it: change a byte and
  the whole conversation is re-sent as a cache WRITE. Measured on a trivial
  two-turn chat against CLI 2.1.263: resuming with an identical system prompt
  read 5,762 tokens from cache and cost $0.0014; resuming with one whose TAIL
  had changed read 0, wrote 5,874, and cost $0.0235 — **16× for the same
  question**. ouRGeo's session context changes with every console line, so the
  original shape paid the full price of the whole conversation on every turn.
  `SendOptions.sessionContext` is the split: `systemPrompt` is the same bytes
  every turn, and what moves is appended to the turn, where it extends the
  cached prefix instead of breaking it — and where the freshest state sits
  closest to the question. **Anything added to the system prompt for this
  provider must be constant, or it costs the conversation.**
- **The legacy delta implementation sent only changed sections** (`ai.lastSessionContext`, a
  `SentContext` rather than the block itself — see *What one turn actually
  says* below). The block stays in the CLI's transcript, so an identical
  listing costs its tokens again on every following turn — ten turns, ten
  copies of the same environment. This is historical behaviour: the broker
  caches repeated reads within a task, but its complete acknowledged cross-turn
  delivery ledger is still outstanding. No initial environment snapshot is sent.
- **The switch positions ride the turn too** (now `buildContextScopeCard`; previously `buildToolNaming` /
  `buildSwitchGuidance`, split out of `buildToolGuidance` in 1.15.3). They used
  to close the system prompt, which is its TAIL — so flipping Autopilot on
  part-way through a chat, which is simply how the panel is used, changed the
  cached prefix and re-sent the whole conversation as a cache write. The 16×
  turn above was not an edge case; it was what happened the moment anyone
  reached for a toggle. Every other transport still gets the combined block:
  they rebuild the prompt from the message array each request and have no
  prefix to protect.
- **The context bar reads the per-call `usage`, not the run's total.** A run's
  `result.usage` is the SUM over every API call the agent loop made, and each
  of those re-sends the conversation: a two-call run measured in=4,
  cache_read=6,680, cache_creation=6,862 — 13,546 "input tokens" — while the
  largest prompt actually sent was 6,864. The sum grows with the number of tool
  calls, so a long autopilot turn reported several times the window it was
  using and the bar pegged at 100%. `parseClaudeLine` therefore emits a
  `usage` event for `message_start` and `message_delta`, which arrive DURING
  the run — that is also what makes the bar move rather than jump once at the
  end — and `sendClaudeCli` keeps the last one rather than adding them up.
  Cached tokens count: caching changes what a token costs, not the space it
  occupies. The `result` event still supplies the window, since an alias
  resolves to a model only that run can name.
- **`requiresApiKey` is not `!isLocalProvider`.** This provider runs on the
  machine but is not a self-hosted server, and the chat panel's send gate asked
  the wrong question — it refused to send a single message while every other
  part of the provider worked, which is the failure that makes a whole feature
  look broken.
- **Detection probes concurrently.** Each miss is one CLI start-up, about a
  second; sequentially the settings row sat on "Looking for the Claude Code
  CLI…" for six seconds on a machine where it was installed. Candidates are
  confirmed by running `--version`, never by `existsSync` — a stale shim from
  an uninstalled npm global exists right up until you run it. macOS has the
  PATH problem the terminal section already documents.
- **Usage is a subscription window, not a token count.** `rate_limit_event`
  carries `five_hour.utilization` and `resetsAt`, which is what a subscriber
  plans around; `contextWindow` comes from the run's own `result` event rather
  than a table of ours that goes stale when an alias moves.
- **The settings copy says what this is.** No API key field, the resolved
  binary, `claude auth status --json` rendered as who is signed in and on what
  plan, and the plain sentence that usage counts against that plan and that
  whether it covers this use is between the user and Anthropic's terms. It must
  not claim endorsement, and the feature must not be sold as free Claude.
